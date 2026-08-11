import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { requireAccount } from "@/app/config/account-auth";
import {
  accountCanUseCompanyModel,
  getCompanyModelForRequest,
  selectProviderCredentialForModel,
} from "@/app/config/admin-store";
import type { ProviderCredential, SafeAccountRecord } from "@/app/config/admin-store";
import type {
  CompanyModel,
  ModelCategory,
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
import { callOpenAICompatibleVideo } from "../../adapters/openai-compatible-video";
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
  credential: ProviderCredential,
  category: ModelCategory,
): ((ctx: GatewayAdapterContext) => Promise<Response>) | undefined {
  if (credential.useCompatibleMode && category === "chat") {
    return callOpenAICompatibleChat;
  }
  if (credential.useCompatibleMode && category === "image") {
    return callOpenAIImages;
  }
  if (credential.useCompatibleMode && category === "video") {
    return callOpenAICompatibleVideo;
  }

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
    case "openai_compatible_video":
      return callOpenAICompatibleVideo;
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

function nonEmptyObjects(value: unknown) {
  return (
    Array.isArray(value) &&
    value.some((item) => {
      const record = objectValue(item);
      return !!record && Object.keys(record).length > 0;
    })
  );
}

function validOpenAIChat(value: unknown, stream: boolean) {
  const body = objectValue(value);
  const choicesValue = body?.choices;
  const choices = Array.isArray(choicesValue) ? choicesValue : [];
  return choices.some((choiceValue) => {
    const choice = objectValue(choiceValue);
    const message = objectValue(stream ? choice?.delta : choice?.message);
    return (
      nonEmptyText(message?.content) || nonEmptyObjects(message?.tool_calls)
    );
  });
}

function validAnthropic(value: unknown, stream: boolean) {
  const body = objectValue(value);
  if (stream) {
    const delta = objectValue(body?.delta);
    const block = objectValue(body?.content_block);
    return (
      nonEmptyText(delta?.text) ||
      block?.type === "tool_use" ||
      (body?.type === "content_block_start" && block?.type === "tool_use")
    );
  }
  const contentValue = body?.content;
  const content = Array.isArray(contentValue) ? contentValue : [];
  return content.some((partValue) => {
    const part = objectValue(partValue);
    return nonEmptyText(part?.text) || part?.type === "tool_use";
  });
}

function validGoogle(value: unknown) {
  if (Array.isArray(value)) return value.some(validGoogle);
  const body = objectValue(value);
  const candidatesValue = body?.candidates;
  const candidates = Array.isArray(candidatesValue) ? candidatesValue : [];
  return candidates.some((candidateValue) => {
    const candidate = objectValue(candidateValue);
    const content = objectValue(candidate?.content);
    const partsValue = content?.parts;
    const parts = Array.isArray(partsValue) ? partsValue : [];
    return parts.some((partValue) => {
      const part = objectValue(partValue);
      return nonEmptyText(part?.text) || !!objectValue(part?.functionCall);
    });
  });
}

function validImage(value: unknown) {
  const body = objectValue(value);
  const dataValue = body?.data;
  const data = Array.isArray(dataValue) ? dataValue : [];
  return data.some((itemValue) => {
    const item = objectValue(itemValue);
    return nonEmptyText(item?.url) || nonEmptyText(item?.b64_json);
  });
}

function validVideo(value: unknown) {
  const body = objectValue(value);
  if (!body) return false;
  if (nonEmptyText(body.video_url) || nonEmptyText(body.url)) return true;
  const output = objectValue(body.output);
  return (
    (body.status === "completed" || body.status === "succeeded") &&
    (nonEmptyText(output?.video_url) || nonEmptyText(output?.url))
  );
}

function hasValidJson(model: CompanyModel, value: unknown) {
  if (model.category === "image") return validImage(value);
  if (model.category === "video") return validVideo(value);
  if (model.endpointType === "anthropic_messages") {
    return validAnthropic(value, false);
  }
  if (
    model.endpointType === "google_generate_content" ||
    model.endpointType === "google_interactions"
  ) {
    return validGoogle(value);
  }
  return validOpenAIChat(value, false);
}

function hasValidStreamEvent(model: CompanyModel, data: string) {
  if (!data || data === "[DONE]") return false;
  try {
    const value: unknown = JSON.parse(data);
    if (model.endpointType === "anthropic_messages") {
      return validAnthropic(value, true);
    }
    if (
      model.endpointType === "google_generate_content" ||
      model.endpointType === "google_interactions"
    ) {
      return validGoogle(value);
    }
    return validOpenAIChat(value, true);
  } catch {
    return false;
  }
}

function inspectSseEvents(model: CompanyModel, text: string) {
  return text.split(/\r?\n\r?\n/).some((event) => {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    return hasValidStreamEvent(model, data);
  });
}

function trackedEventStream(
  res: Response,
  model: CompanyModel,
  requestId: string,
) {
  if (!res.body) return undefined;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let eventBuffer = "";
  let valid = false;
  let settled = false;
  const maxEventBuffer = 256 * 1024;

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
          eventBuffer += decoder.decode();
          valid = valid || inspectSseEvents(model, `${eventBuffer}\n\n`);
          await settle(valid ? "success" : "failed");
          controller.close();
          return;
        }

        eventBuffer += decoder.decode(chunk.value, { stream: true });
        if (eventBuffer.length > maxEventBuffer) {
          throw new Error("stream event was too large");
        }
        const events = eventBuffer.split(/\r?\n\r?\n/);
        eventBuffer = events.pop() ?? "";
        valid = valid || inspectSseEvents(model, events.join("\n\n"));
        controller.enqueue(chunk.value);
      } catch (error) {
        await settle("failed");
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
) {
  try {
    const value: unknown = await res.clone().json();
    if (hasValidJson(model, value)) {
      await confirmCategoryQuota(requestId, res.status);
    } else {
      await releaseCategoryQuota(
        requestId,
        "failed",
        "response did not contain valid content",
        res.status,
      );
    }
  } catch {
    await releaseCategoryQuota(
      requestId,
      "failed",
      "response could not be parsed",
      res.status,
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

  const adapter = adapterFor(
    companyModel.endpointType,
    credential,
    companyModel.category,
  );
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
    bodyText,
    model: companyModel,
    credential,
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
      return trackedEventStream(res, companyModel, requestId) ?? res;
    }
    if (contentType.includes("json")) {
      return validateJsonResponse(res, companyModel, requestId);
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
      "failed",
      "gateway request failed",
      502,
    );
    console.error("[Gateway] request failed");
    return gatewayError(provider, 502, "gateway request failed");
  }
}

export const GET = handle;
export const POST = handle;

export const runtime = "nodejs";
