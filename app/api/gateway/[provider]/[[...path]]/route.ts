import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/app/api/auth";
import { getServerSideConfig } from "@/app/config/server";
import {
  appendUsageRecord,
  checkMonthlyQuota,
  estimateTokensFromBody,
  extractModelFromGatewayRequest,
} from "@/app/config/usage";
import {
  isProviderEnabled,
  isProviderModelEnabled,
} from "@/app/config/admin-store";
import {
  ANTHROPIC_BASE_URL,
  Anthropic,
  GEMINI_BASE_URL,
  ModelProvider,
  OPENAI_BASE_URL,
  PERPLEXITY_BASE_URL,
  ServiceProvider,
} from "@/app/constant";
import { cloudflareAIGatewayUrl } from "@/app/utils/cloudflare";

type GatewayProvider = "openai" | "google" | "perplexity" | "anthropic";

const PROVIDER_MODEL_MAP: Record<GatewayProvider, ModelProvider> = {
  openai: ModelProvider.GPT,
  google: ModelProvider.GeminiPro,
  perplexity: ModelProvider.Perplexity,
  anthropic: ModelProvider.Claude,
};

const SUPPORTED_PROVIDERS: GatewayProvider[] = [
  "openai",
  "google",
  "perplexity",
  "anthropic",
];

const PROVIDER_ADMIN_ID: Record<
  GatewayProvider,
  "openai" | "google" | "perplexity" | "anthropic"
> = {
  openai: "openai",
  google: "google",
  perplexity: "perplexity",
  anthropic: "anthropic",
};

function normalizeBaseUrl(baseUrl: string) {
  const normalized = baseUrl || "";
  const withProtocol = normalized.startsWith("http")
    ? normalized
    : `https://${normalized}`;

  return withProtocol.endsWith("/")
    ? withProtocol.slice(0, withProtocol.length - 1)
    : withProtocol;
}

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

function getProviderConfig(provider: GatewayProvider) {
  const serverConfig = getServerSideConfig();

  switch (provider) {
    case "openai":
      return {
        apiKey: serverConfig.apiKey,
        baseUrl: normalizeBaseUrl(serverConfig.baseUrl || OPENAI_BASE_URL),
        serviceProvider: ServiceProvider.OpenAI,
      };
    case "google":
      return {
        apiKey: serverConfig.googleApiKey,
        baseUrl: normalizeBaseUrl(serverConfig.googleUrl || GEMINI_BASE_URL),
        serviceProvider: ServiceProvider.Google,
      };
    case "perplexity":
      return {
        apiKey: serverConfig.perplexityApiKey,
        baseUrl: normalizeBaseUrl(
          serverConfig.perplexityBaseUrl || PERPLEXITY_BASE_URL,
        ),
        serviceProvider: ServiceProvider.Perplexity,
      };
    case "anthropic":
      return {
        apiKey: serverConfig.anthropicApiKey,
        baseUrl: normalizeBaseUrl(
          serverConfig.anthropicUrl || ANTHROPIC_BASE_URL,
        ),
        serviceProvider: ServiceProvider.Anthropic,
      };
  }
}

function buildHeaders(
  provider: GatewayProvider,
  apiKey: string,
  req: NextRequest,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };

  if (provider === "google") {
    headers["x-goog-api-key"] = apiKey;
  } else if (provider === "anthropic") {
    const serverConfig = getServerSideConfig();
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] =
      serverConfig.anthropicApiVersion ||
      req.headers.get("anthropic-version") ||
      Anthropic.Vision;
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const serverConfig = getServerSideConfig();
  if (provider === "openai" && serverConfig.openaiOrgId) {
    headers["OpenAI-Organization"] = serverConfig.openaiOrgId;
  }

  return headers;
}

async function getRequestBody(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  return req.text();
}

async function recordUsageSafely(
  input: Parameters<typeof appendUsageRecord>[0],
) {
  try {
    await appendUsageRecord(input);
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

  const providerConfig = getProviderConfig(provider);
  const bodyText = await getRequestBody(req);
  const model = extractModelFromGatewayRequest(provider, path, bodyText);
  const inputTokens = estimateTokensFromBody(bodyText);
  const authResult = auth(req, PROVIDER_MODEL_MAP[provider], model);

  if (authResult.error) {
    await recordUsageSafely({
      employeeId: authResult.employee?.id ?? "unknown",
      employeeName: authResult.employee?.name,
      provider: providerConfig.serviceProvider,
      model,
      inputTokens,
      outputTokens: 0,
      estimatedCost: 0,
      quotaUnits: 0,
      status: "auth_failed",
      httpStatus: 401,
      errorMessage: authResult.msg ?? "unauthorized",
      requestPath: path,
    });
    return gatewayError(provider, 401, authResult.msg ?? "unauthorized");
  }

  if (!isProviderEnabled(PROVIDER_ADMIN_ID[provider])) {
    await recordUsageSafely({
      employeeId: authResult.employee?.id ?? "unknown",
      employeeName: authResult.employee?.name,
      provider: providerConfig.serviceProvider,
      model,
      inputTokens,
      outputTokens: 0,
      estimatedCost: 0,
      quotaUnits: 0,
      status: "failed",
      httpStatus: 403,
      errorMessage: `${providerConfig.serviceProvider} provider is disabled`,
      requestPath: path,
    });

    return gatewayError(
      provider,
      403,
      `${providerConfig.serviceProvider} provider is disabled`,
    );
  }

  if (!isProviderModelEnabled(PROVIDER_ADMIN_ID[provider], model)) {
    await recordUsageSafely({
      employeeId: authResult.employee?.id ?? "unknown",
      employeeName: authResult.employee?.name,
      provider: providerConfig.serviceProvider,
      model,
      inputTokens,
      outputTokens: 0,
      estimatedCost: 0,
      quotaUnits: 0,
      status: "failed",
      httpStatus: 403,
      errorMessage: `${model} is disabled for ${providerConfig.serviceProvider}`,
      requestPath: path,
    });

    return gatewayError(
      provider,
      403,
      `${model} is disabled for ${providerConfig.serviceProvider}`,
    );
  }

  const quota = await checkMonthlyQuota(authResult.employee, inputTokens);
  if (!quota.allowed) {
    await recordUsageSafely({
      employeeId: authResult.employee?.id ?? "unknown",
      employeeName: authResult.employee?.name,
      provider: providerConfig.serviceProvider,
      model,
      inputTokens,
      outputTokens: 0,
      estimatedCost: 0,
      quotaUnits: 0,
      status: "quota_exceeded",
      httpStatus: 429,
      errorMessage: "monthly quota exceeded",
      requestPath: path,
    });

    return gatewayError(provider, 429, "monthly quota exceeded", quota);
  }

  if (!providerConfig.apiKey) {
    await recordUsageSafely({
      employeeId: authResult.employee?.id ?? "unknown",
      employeeName: authResult.employee?.name,
      provider: providerConfig.serviceProvider,
      model,
      inputTokens,
      outputTokens: 0,
      estimatedCost: 0,
      quotaUnits: 0,
      status: "failed",
      httpStatus: 500,
      errorMessage: `missing ${providerConfig.serviceProvider} provider api key`,
      requestPath: path,
    });

    return gatewayError(
      provider,
      500,
      `missing ${providerConfig.serviceProvider} provider api key`,
    );
  }

  const search = req.nextUrl.search || "";
  const fetchUrl = cloudflareAIGatewayUrl(
    `${providerConfig.baseUrl}/${path}${search}`,
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10 * 60 * 1000);

  try {
    console.log("[Gateway]", provider, path);
    const res = await fetch(fetchUrl, {
      method: req.method,
      body: bodyText,
      headers: buildHeaders(provider, providerConfig.apiKey, req),
      redirect: "manual",
      // @ts-ignore
      duplex: "half",
      signal: controller.signal,
    });

    await recordUsageSafely({
      employeeId: authResult.employee?.id ?? "unknown",
      employeeName: authResult.employee?.name,
      provider: providerConfig.serviceProvider,
      model,
      inputTokens,
      outputTokens: 0,
      estimatedCost: 0,
      quotaUnits: res.ok ? inputTokens : 0,
      status: res.ok ? "success" : "failed",
      httpStatus: res.status,
      errorMessage: res.ok ? undefined : res.statusText,
      requestPath: path,
    });

    const responseHeaders = new Headers(res.headers);
    responseHeaders.delete("www-authenticate");
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("OpenAI-Organization");
    responseHeaders.set("X-Accel-Buffering", "no");

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("[Gateway] request failed", provider, error);
    await recordUsageSafely({
      employeeId: authResult.employee?.id ?? "unknown",
      employeeName: authResult.employee?.name,
      provider: providerConfig.serviceProvider,
      model,
      inputTokens,
      outputTokens: 0,
      estimatedCost: 0,
      quotaUnits: 0,
      status: "failed",
      httpStatus: 502,
      errorMessage: error instanceof Error ? error.message : String(error),
      requestPath: path,
    });

    return gatewayError(
      provider,
      502,
      "gateway request failed",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

export const GET = handle;
export const POST = handle;

export const runtime = "nodejs";
