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
  checkCategoryQuota,
  estimateTokensFromBody,
  extractModelFromGatewayRequest,
  extractPromptFromBody,
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
    {
      error: true,
      provider,
      message,
      details,
    },
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

async function recordUsageSafely(
  account: SafeAccountRecord,
  model: CompanyModel | undefined,
  input: {
    provider: string;
    modelName: string;
    bodyText?: string;
    inputTokens: number;
    usageUnits: number;
    status: "success" | "failed" | "blocked";
    httpStatus?: number;
    errorMessage?: string;
    requestPath?: string;
  },
) {
  try {
    const promptContent = sanitizePromptForLog(
      extractPromptFromBody(input.bodyText),
    );
    await appendUsageRecord({
      accountId: account.id,
      username: account.username,
      role: account.role,
      provider: model?.provider ?? input.provider,
      modelId: model?.id ?? "",
      model: model?.model ?? input.modelName,
      category: model?.category ?? "chat",
      promptPreview: promptContent.slice(0, 300),
      promptContent,
      inputTokens: input.inputTokens,
      usageUnits: input.usageUnits,
      status: input.status,
      httpStatus: input.httpStatus,
      errorMessage: input.errorMessage,
      requestPath: input.requestPath,
    });
  } catch (error) {
    console.error("[Gateway] failed to record usage", error);
  }
}

const RESPONSE_SAMPLE_LIMIT = 2 * 1024 * 1024;

function hasValidResponseContent(
  category: CompanyModel["category"],
  text: string,
) {
  const sample = text.trim();
  if (!sample) return false;

  if (category === "image") {
    return /"(?:b64_json|url|data)"\s*:\s*"[^"]+/i.test(sample);
  }
  if (category === "video") {
    return /"(?:url|video|data)"\s*:\s*"[^"]+/i.test(sample);
  }

  return (
    /"(?:content|text|output_text|reasoning_content)"\s*:\s*"[^"]+/i.test(
      sample,
    ) || /"tool_calls"\s*:\s*\[\s*\{/i.test(sample)
  );
}

function trackedResponse(
  res: Response,
  account: SafeAccountRecord,
  model: CompanyModel,
  input: {
    provider: string;
    modelName: string;
    bodyText?: string;
    inputTokens: number;
    requestPath?: string;
  },
) {
  if (!res.body) return undefined;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let sample = "";
  let settled = false;

  const finalize = async (valid: boolean, errorMessage?: string) => {
    if (settled) return;
    settled = true;
    await recordUsageSafely(account, model, {
      ...input,
      usageUnits: valid ? 1 : 0,
      status: valid ? "success" : "failed",
      httpStatus: res.status,
      errorMessage,
    });
  };

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          if (sample.length < RESPONSE_SAMPLE_LIMIT) {
            sample += decoder.decode();
          }
          const valid = hasValidResponseContent(model.category, sample);
          await finalize(
            valid,
            valid ? undefined : "response did not contain valid content",
          );
          controller.close();
          return;
        }

        if (sample.length < RESPONSE_SAMPLE_LIMIT) {
          sample += decoder
            .decode(chunk.value, { stream: true })
            .slice(0, RESPONSE_SAMPLE_LIMIT - sample.length);
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        await finalize(
          false,
          error instanceof Error ? error.message : String(error),
        );
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
      await finalize(false, "request canceled");
    },
  });

  return new Response(body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
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
  if (!account) {
    return gatewayError(provider, 401, "account login required");
  }

  const bodyText = await getRequestBody(req);
  const modelName = extractModelFromGatewayRequest(provider, path, bodyText);
  const inputTokens = estimateTokensFromBody(bodyText);
  const requestPath = path;
  if (!modelName) {
    await recordUsageSafely(account, undefined, {
      provider,
      modelName: "",
      bodyText,
      inputTokens,
      usageUnits: 0,
      status: "blocked",
      httpStatus: 400,
      errorMessage: "model is required",
      requestPath,
    });
    return gatewayError(provider, 400, "model is required");
  }

  const companyModel = getCompanyModelForRequest(
    provider as ModelProvider,
    modelName,
  );
  const blockedReason = modelBlockedReason(companyModel);

  if (blockedReason || !companyModel) {
    await recordUsageSafely(account, companyModel, {
      provider,
      modelName,
      bodyText,
      inputTokens,
      usageUnits: 0,
      status: "blocked",
      httpStatus: 403,
      errorMessage: blockedReason,
      requestPath,
    });
    return gatewayError(provider, 403, blockedReason);
  }

  if (!accountCanUseCompanyModel(account, companyModel)) {
    await recordUsageSafely(account, companyModel, {
      provider,
      modelName,
      bodyText,
      inputTokens,
      usageUnits: 0,
      status: "blocked",
      httpStatus: 403,
      errorMessage: "account is not allowed to use this model",
      requestPath,
    });
    return gatewayError(
      provider,
      403,
      "account is not allowed to use this model",
    );
  }

  const credential = selectProviderCredentialForModel(companyModel);
  if (!credential) {
    await recordUsageSafely(account, companyModel, {
      provider,
      modelName,
      bodyText,
      inputTokens,
      usageUnits: 0,
      status: "blocked",
      httpStatus: 403,
      errorMessage: "no provider credential is available",
      requestPath,
    });
    return gatewayError(provider, 403, "no provider credential is available");
  }

  const quota = await checkCategoryQuota(account, companyModel.category);
  if (!quota.allowed) {
    await recordUsageSafely(account, companyModel, {
      provider,
      modelName,
      bodyText,
      inputTokens,
      usageUnits: 0,
      status: "blocked",
      httpStatus: 429,
      errorMessage: "monthly category quota exceeded",
      requestPath,
    });
    return gatewayError(
      provider,
      429,
      "monthly category quota exceeded",
      quota,
    );
  }

  const adapter = adapterFor(companyModel.endpointType);
  if (!adapter) {
    await recordUsageSafely(account, companyModel, {
      provider,
      modelName,
      bodyText,
      inputTokens,
      usageUnits: 0,
      status: "blocked",
      httpStatus: 501,
      errorMessage: "model adapter is not implemented",
      requestPath,
    });
    return gatewayError(provider, 501, "model adapter is not implemented");
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
      await recordUsageSafely(account, companyModel, {
        provider,
        modelName,
        bodyText,
        inputTokens,
        usageUnits: 0,
        status: "failed",
        httpStatus: res.status,
        errorMessage: res.statusText,
        requestPath,
      });
      return res;
    }

    const tracked = trackedResponse(res, account, companyModel, {
      provider,
      modelName,
      bodyText,
      inputTokens,
      requestPath,
    });
    if (tracked) return tracked;

    await recordUsageSafely(account, companyModel, {
      provider,
      modelName,
      bodyText,
      inputTokens,
      usageUnits: 0,
      status: "failed",
      httpStatus: res.status,
      errorMessage: "response did not contain a body",
      requestPath,
    });
    return res;
  } catch (error) {
    console.error("[Gateway] request failed", provider, error);
    await recordUsageSafely(account, companyModel, {
      provider,
      modelName,
      bodyText,
      inputTokens,
      usageUnits: 0,
      status: "failed",
      httpStatus: 502,
      errorMessage: error instanceof Error ? error.message : String(error),
      requestPath,
    });

    return gatewayError(
      provider,
      502,
      "gateway request failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export const GET = handle;
export const POST = handle;

export const runtime = "nodejs";
