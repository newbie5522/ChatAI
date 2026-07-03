import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/app/api/auth";
import { getServerSideConfig } from "@/app/config/server";
import {
  GEMINI_BASE_URL,
  ModelProvider,
  OPENAI_BASE_URL,
  PERPLEXITY_BASE_URL,
  ServiceProvider,
} from "@/app/constant";
import { cloudflareAIGatewayUrl } from "@/app/utils/cloudflare";

type GatewayProvider = "openai" | "google" | "perplexity";

const PROVIDER_MODEL_MAP: Record<GatewayProvider, ModelProvider> = {
  openai: ModelProvider.GPT,
  google: ModelProvider.GeminiPro,
  perplexity: ModelProvider.Perplexity,
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
  }
}

function buildHeaders(provider: GatewayProvider, apiKey: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };

  if (provider === "google") {
    headers["x-goog-api-key"] = apiKey;
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const serverConfig = getServerSideConfig();
  if (provider === "openai" && serverConfig.openaiOrgId) {
    headers["OpenAI-Organization"] = serverConfig.openaiOrgId;
  }

  return headers;
}

async function handle(
  req: NextRequest,
  { params }: { params: { provider: string; path?: string[] } },
) {
  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" }, { status: 200 });
  }

  const provider = params.provider.toLowerCase() as GatewayProvider;
  if (!["openai", "google", "perplexity"].includes(provider)) {
    return gatewayError(params.provider, 404, "unsupported gateway provider");
  }

  const authResult = auth(req, PROVIDER_MODEL_MAP[provider]);
  if (authResult.error) {
    return gatewayError(provider, 401, authResult.msg ?? "unauthorized");
  }

  const path = params.path?.join("/") ?? "";
  if (!path) {
    return gatewayError(provider, 400, "missing provider api path");
  }

  const providerConfig = getProviderConfig(provider);
  if (!providerConfig.apiKey) {
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
      body: req.body,
      headers: buildHeaders(provider, providerConfig.apiKey),
      redirect: "manual",
      // @ts-ignore
      duplex: "half",
      signal: controller.signal,
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

export const runtime = "edge";
