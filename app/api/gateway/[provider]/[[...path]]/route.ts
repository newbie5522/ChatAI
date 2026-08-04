import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { requireAccount } from "@/app/config/account-auth";
import {
  accountCanUseCompanyModel,
  getCompanyModelForRequest,
  selectProviderCredentialForModel,
} from "@/app/config/admin-store";
import type { SafeAccountRecord } from "@/app/config/admin-store";
import type {
  CompanyModel,
  ModelEndpointType,
  ModelProvider,
} from "@/app/config/model-registry";
import {
  appendUsageRecord,
  confirmCategoryQuota,
  estimateTokensFromBody,
  extractModelFromGatewayRequest,
  extractPromptFromBody,
  releaseCategoryQuota,
  reserveCategoryQuota,
  sanitizePromptForLog,
} from "@/app/config/usage";

import { callAnthropicMessages } from "../../adapters/anthropic-messages";
import { callGoogleGenerateContent } from "../../adapters/google-generate-content";
import { callGoogleImage } from "../../adapters/google-image";
import { callGoogleInteractions } from "../../adapters/google-interactions";
import { callOpenAIImages } from "../../adapters/openai-images";
import { callOpenAICompatibleChat } from "../../adapters/openai-compatible-chat";
import { callOpenAIResponses } from "../../adapters/openai-responses";
import { callPerplexitySonar } from "../../adapters/perplexity-sonar";
import type { GatewayAdapterContext } from "../../adapters/types";
import { callXAIImages } from "../../adapters/xai-images";

type GatewayProvider = ModelProvider;

const SUPPORTED_PROVIDERS: GatewayProvider[] = [
  "openai",
  "google",
  "perplexity",
  "anthropic",
  "xai",
  "deepseek",
  "qwen",
  "mistral",
  "zhipu",
];

function gatewayError(
  provider: string,
  status: number,
  message: string,
  details?: unknown,
) {
  return NextResponse.json(
    { error: true, provider, message, details },
    { status },
  );
}

async function getRequestBody(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  return req.text();
}

function modelBlockedReason(model?: CompanyModel) {
  if (!model) return "model is not in NewbieChat company catalog";
  if (!model.enabled) return "model is disabled";
  if (model.endpointType === "not_implemented") {
    return "model adapter is not implemented";
  }
  if (model.legacy) return "model is legacy";
  if (model.deprecated) return "model is deprecated";
  return "";
}

function adapterFor(
  endpointType: ModelEndpointType,
): ((ctx: GatewayAdapterContext) => Promise<Response>) | undefined {
  switch (endpointType) {
    case "openai_responses":
      return callOpenAIResponses;
    case "openai_images":
      return callOpenAIImages;
    case "anthropic_messages":
      return callAnthropicMessages;
    case "google_interactions":
      return callGoogleInteractions;
    case "google_generate_content":
      return callGoogleGenerateContent;
    case "google_image":
      return callGoogleImage;
    case "perplexity_sonar":
      return callPerplexitySonar;
    case "openai_compatible_chat":
      return callOpenAICompatibleChat;
    case "xai_images":
      return callXAIImages;
    case "not_implemented":
    default:
      return undefined;
  }
}

function usageFields(
  account: SafeAccountRecord,
  model: CompanyModel | undefined,
  input: {
    provider: string;
    modelName: string;
    bodyText?: string;
    inputTokens: number;
    requestPath?: string;
  },
) {
  const promptContent = sanitizePromptForLog(
    extractPromptFromBody(input.bodyText),
  );
  return {
    accountId: account.id,
    username: account.username,
    role: account.role,
    provider: model?.provider ?? input.provider,
    modelId: model?.id ?? "",
    model: model?.model ?? input.modelName,
    category: model?.category ?? ("chat" as const),
    promptPreview: promptContent.slice(0, 300),
    promptContent,
    inputTokens: input.inputTokens,
    requestPath: input.requestPath,
  };
}

async function recordBlockedUsage(
  account: SafeAccountRecord,
  model: CompanyModel | undefined,
  input: {
    provider: string;
    modelName: string;
    bodyText?: string;
    inputTokens: number;
    httpStatus: number;
    errorMessage: string;
    requestPath?: string;
    requestId?: string;
  },
) {
  try {
    await appendUsageRecord({
      ...usageFields(account, model, input),
      requestId: input.requestId,
      usageUnits: 0,
      quotaUnits: 0,
      status: "blocked",
      httpStatus: input.httpStatus,
      errorMessage: input.errorMessage,
    });
  } catch {
    console.error("[Gateway] usage record failed");
  }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasImageInput(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasImageInput);
  const record = objectValue(value);
  if (!record) return false;

  const imageUrl = objectValue(record.image_url);
  if (nonEmptyText(imageUrl?.url)) return true;

  const inlineData =
    objectValue(record.inlineData) ?? objectValue(record.inline_data);
  if (
    nonEmptyText(inlineData?.data) &&
    nonEmptyText(inlineData?.mimeType ?? inlineData?.mime_type)
  ) {
    return true;
  }

  const source = objectValue(record.source);
  if (
    record.type === "image" &&
    source?.type === "base64" &&
    nonEmptyText(source.media_type) &&
    nonEmptyText(source.data)
  ) {
    return true;
  }

  return Object.values(record).some(hasImageInput);
}

function requestHasImageInput(bodyText?: string) {
  if (!bodyText) return false;
  try {
    const value: unknown = JSON.parse(bodyText);
    return hasImageInput(value);
  } catch {
    return false;
  }
}

function modelSupportsImageInput(model: CompanyModel) {
  if (model.category === "image") {
    return (
      model.capabilities?.imageEditing === true ||
      model.capabilities?.referenceImages === true
    );
  }
  if (model.category === "video") {
    return model.capabilities?.imageToVideo === true;
  }
  return model.capabilities?.vision === true;
}

function unsupportedImageInputMessage(model: CompanyModel) {
  return model.category === "image"
    ? "当前模型官方接口暂未接入参考图生图。"
    : "当前模型官方接口暂未接入图片输入。";
}

function validImageCount(value: unknown) {
  const body = objectValue(value);
  const dataValue = body?.data;
  const data = Array.isArray(dataValue) ? dataValue : [];
  return data.filter((itemValue) => {
    const item = objectValue(itemValue);
    return nonEmptyText(item?.url) || nonEmptyText(item?.b64_json);
  }).length;
}

function trackedEventStream(
  res: Response,
  requestId: string,
  signal: AbortSignal,
) {
  if (!res.body) return undefined;
  const reader = res.body.getReader();
  let settled = false;

  const settle = async (status: "success" | "failed" | "canceled") => {
    if (settled) return;
    settled = true;
    if (status === "success") {
      await confirmCategoryQuota(requestId, res.status);
    } else {
      await releaseCategoryQuota(
        requestId,
        status,
        status === "canceled"
          ? "request canceled"
          : "response did not contain valid content",
        res.status,
      );
    }
  };

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          await settle("success");
          controller.close();
          return;
        }

        controller.enqueue(chunk.value);
      } catch (error) {
        await settle(signal.aborted ? "canceled" : "failed");
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        await settle("canceled");
      }
    },
  });

  return new Response(body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

async function validateJsonResponse(
  res: Response,
  model: CompanyModel,
  requestId: string,
  signal: AbortSignal,
) {
  try {
    const value: unknown = await res.clone().json();
    if (signal.aborted) {
      await releaseCategoryQuota(
        requestId,
        "canceled",
        "request canceled",
        499,
      );
      return res;
    }
    if (model.category === "image") {
      const usageUnits = validImageCount(value);
      if (usageUnits > 0) {
        await confirmCategoryQuota(requestId, res.status, usageUnits);
      } else {
        await releaseCategoryQuota(
          requestId,
          "failed",
          "image response did not contain valid data",
          res.status,
        );
      }
    } else {
      await confirmCategoryQuota(requestId, res.status, 1);
    }
  } catch {
    await releaseCategoryQuota(
      requestId,
      signal.aborted ? "canceled" : "failed",
      signal.aborted ? "request canceled" : "response could not be parsed",
      signal.aborted ? 499 : res.status,
    );
  }
  return res;
}

async function handle(
  req: NextRequest,
  { params }: { params: { provider: string; path?: string[] } },
) {
  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" }, { status: 200 });
  }

  const provider = params.provider.toLowerCase() as GatewayProvider;
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    return gatewayError(params.provider, 404, "unsupported gateway provider");
  }

  const path = params.path?.join("/") ?? "";
  const { account, response } = requireAccount(req);
  if (response) return response;
  if (!account) return gatewayError(provider, 401, "account login required");

  const bodyText = await getRequestBody(req);
  const modelName = extractModelFromGatewayRequest(provider, path, bodyText);
  const inputTokens = estimateTokensFromBody(bodyText);
  const baseUsage = {
    provider,
    modelName,
    bodyText,
    inputTokens,
    requestPath: path,
  };

  if (!modelName) {
    await recordBlockedUsage(account, undefined, {
      ...baseUsage,
      httpStatus: 400,
      errorMessage: "model is required",
    });
    return gatewayError(provider, 400, "model is required");
  }

  const companyModel = getCompanyModelForRequest(provider, modelName);
  const blockedReason = modelBlockedReason(companyModel);
  if (blockedReason || !companyModel) {
    await recordBlockedUsage(account, companyModel, {
      ...baseUsage,
      httpStatus: 403,
      errorMessage: blockedReason,
    });
    return gatewayError(provider, 403, blockedReason);
  }

  const credential = selectProviderCredentialForModel(companyModel);
  if (!credential) {
    const message = "no provider credential is available";
    await recordBlockedUsage(account, companyModel, {
      ...baseUsage,
      httpStatus: 403,
      errorMessage: message,
    });
    return gatewayError(provider, 403, message);
  }

  if (!accountCanUseCompanyModel(account, companyModel)) {
    const message = "account is not allowed to use this model";
    await recordBlockedUsage(account, companyModel, {
      ...baseUsage,
      httpStatus: 403,
      errorMessage: message,
    });
    return gatewayError(provider, 403, message);
  }

  if (
    requestHasImageInput(bodyText) &&
    !modelSupportsImageInput(companyModel)
  ) {
    const message = unsupportedImageInputMessage(companyModel);
    await recordBlockedUsage(account, companyModel, {
      ...baseUsage,
      httpStatus: 400,
      errorMessage: message,
    });
    return gatewayError(provider, 400, message);
  }

  const adapterBodyText = bodyText;

  const adapter = adapterFor(companyModel.endpointType);
  if (!adapter) {
    const message = "model adapter is not implemented";
    await recordBlockedUsage(account, companyModel, {
      ...baseUsage,
      httpStatus: 501,
      errorMessage: message,
    });
    return gatewayError(provider, 501, message);
  }

  const requestId = randomUUID();
  const reservation = await reserveCategoryQuota(account, {
    ...usageFields(account, companyModel, baseUsage),
    requestId,
  });
  if (!reservation.allowed) {
    const message = "monthly category quota exceeded";
    await recordBlockedUsage(account, companyModel, {
      ...baseUsage,
      requestId,
      httpStatus: 429,
      errorMessage: message,
    });
    return gatewayError(provider, 429, message, reservation);
  }

  const adapterContext: GatewayAdapterContext = {
    req,
    path,
    search: req.nextUrl.search || "",
    bodyText: adapterBodyText,
    model: companyModel,
    credential,
    signal: req.signal,
  };

  try {
    const res = await adapter(adapterContext);
    if (!res.ok) {
      await releaseCategoryQuota(
        requestId,
        "failed",
        "provider returned an HTTP error",
        res.status,
      );
      return res;
    }
    if (!res.body) {
      await releaseCategoryQuota(
        requestId,
        "failed",
        "response did not contain a body",
        res.status,
      );
      return res;
    }

    const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("text/event-stream")) {
      return trackedEventStream(res, requestId, req.signal) ?? res;
    }
    if (contentType.includes("json")) {
      return validateJsonResponse(res, companyModel, requestId, req.signal);
    }

    await releaseCategoryQuota(
      requestId,
      "failed",
      "unsupported response content type",
      res.status,
    );
    return res;
  } catch {
    await releaseCategoryQuota(
      requestId,
      req.signal.aborted ? "canceled" : "failed",
      req.signal.aborted ? "request canceled" : "gateway request failed",
      req.signal.aborted ? 499 : 502,
    );
    if (!req.signal.aborted) console.error("[Gateway] request failed");
    return gatewayError(
      provider,
      req.signal.aborted ? 499 : 502,
      req.signal.aborted ? "request canceled" : "gateway request failed",
    );
  }
}

export const GET = handle;
export const POST = handle;

export const runtime = "nodejs";
