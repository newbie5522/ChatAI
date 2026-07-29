import { NextRequest, NextResponse } from "next/server";

import { requireAccount } from "@/app/config/account-auth";
import {
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
  checkMonthlyQuota,
  estimateTokensFromBody,
  extractModelFromGatewayRequest,
  extractPromptFromBody,
} from "@/app/config/usage";

import { callAnthropicMessages } from "../../adapters/anthropic-messages";
import { callGoogleGenerateContent } from "../../adapters/google-generate-content";
import { callGoogleImage } from "../../adapters/google-image";
import { callGoogleInteractions } from "../../adapters/google-interactions";
import { callOpenAIImages } from "../../adapters/openai-images";
import { callOpenAIResponses } from "../../adapters/openai-responses";
import { callPerplexitySonar } from "../../adapters/perplexity-sonar";
import type { GatewayAdapterContext } from "../../adapters/types";

type GatewayProvider = "openai" | "google" | "perplexity" | "anthropic";

const SUPPORTED_PROVIDERS: GatewayProvider[] = [
  "openai",
  "google",
  "perplexity",
  "anthropic",
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

function accountCanUseModel(account: SafeAccountRecord, model: CompanyModel) {
  if (account.role === "admin" || account.role === "super_admin") return true;
  if (model.adminOnly || model.legacy || model.deprecated) return false;

  return (
    account.allowedModelIds.includes(model.id) ||
    account.allowedCategories.includes(model.category)
  );
}

function modelBlockedReason(model?: CompanyModel) {
  if (!model) return "model is not in NewbieChat company catalog";
  if (!model.enabled) return "model is disabled";
  if (!model.verified) return "model is not verified";
  if (model.endpointType === "not_implemented") {
    return "model adapter is not implemented";
  }
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
      return async () => callOpenAIImages();
    case "anthropic_messages":
      return callAnthropicMessages;
    case "google_interactions":
      return callGoogleInteractions;
    case "google_generate_content":
      return callGoogleGenerateContent;
    case "google_image":
      return async () => callGoogleImage();
    case "perplexity_sonar":
      return callPerplexitySonar;
    case "not_implemented":
    default:
      return undefined;
  }
}

async function recordUsageSafely(
  account: SafeAccountRecord | null,
  model: CompanyModel | undefined,
  input: {
    provider: string;
    modelName: string;
    bodyText?: string;
    inputTokens: number;
    quotaUnits: number;
    status: "success" | "failed" | "blocked";
    httpStatus?: number;
    errorMessage?: string;
    requestPath?: string;
  },
) {
  try {
    const promptContent = extractPromptFromBody(input.bodyText);
    await appendUsageRecord({
      accountId: account?.id ?? "unknown",
      username: account?.username ?? "unknown",
      role: account?.role ?? "anonymous",
      provider: model?.provider ?? input.provider,
      modelId: model?.id ?? "",
      model: model?.model ?? input.modelName,
      category: model?.category ?? "chat",
      promptPreview: promptContent.slice(0, 300),
      promptContent,
      inputTokens: input.inputTokens,
      quotaUnits: input.quotaUnits,
      status: input.status,
      httpStatus: input.httpStatus,
      errorMessage: input.errorMessage,
      requestPath: input.requestPath,
    });
  } catch (error) {
    console.error("[Gateway] failed to record usage", error);
  }
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
  if (!path) {
    return gatewayError(provider, 400, "missing provider api path");
  }

  const bodyText = await getRequestBody(req);
  const modelName = extractModelFromGatewayRequest(provider, path, bodyText);
  const inputTokens = estimateTokensFromBody(bodyText);
  const requestPath = path;
  const { account, response } = requireAccount(req);

  if (response) {
    await recordUsageSafely(null, undefined, {
      provider,
      modelName,
      bodyText,
      inputTokens,
      quotaUnits: 0,
      status: "blocked",
      httpStatus: 401,
      errorMessage: "account login required",
      requestPath,
    });
    return response;
  }
  if (!account) {
    return gatewayError(provider, 401, "account login required");
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
      quotaUnits: 0,
      status: "blocked",
      httpStatus: 403,
      errorMessage: blockedReason,
      requestPath,
    });
    return gatewayError(provider, 403, blockedReason);
  }

  if (!accountCanUseModel(account, companyModel)) {
    await recordUsageSafely(account, companyModel, {
      provider,
      modelName,
      bodyText,
      inputTokens,
      quotaUnits: 0,
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
      quotaUnits: 0,
      status: "blocked",
      httpStatus: 403,
      errorMessage: "no verified provider credential is available",
      requestPath,
    });
    return gatewayError(
      provider,
      403,
      "no verified provider credential is available",
    );
  }

  const quotaUnits = inputTokens;
  const quota = await checkMonthlyQuota(account, quotaUnits);
  if (!quota.allowed) {
    await recordUsageSafely(account, companyModel, {
      provider,
      modelName,
      bodyText,
      inputTokens,
      quotaUnits,
      status: "blocked",
      httpStatus: 429,
      errorMessage: "monthly quota exceeded",
      requestPath,
    });
    return gatewayError(provider, 429, "monthly quota exceeded", quota);
  }

  const adapter = adapterFor(companyModel.endpointType);
  if (!adapter) {
    await recordUsageSafely(account, companyModel, {
      provider,
      modelName,
      bodyText,
      inputTokens,
      quotaUnits: 0,
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
    await recordUsageSafely(account, companyModel, {
      provider,
      modelName,
      bodyText,
      inputTokens,
      quotaUnits: res.ok ? quotaUnits : 0,
      status: res.ok ? "success" : "failed",
      httpStatus: res.status,
      errorMessage: res.ok ? undefined : res.statusText,
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
      quotaUnits: 0,
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
