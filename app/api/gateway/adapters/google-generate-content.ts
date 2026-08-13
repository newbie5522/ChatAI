import {
  GatewayAdapterContext,
  copyResponseHeaders,
  normalizeBaseUrl,
  withDuplex,
} from "./types";

const GEMINI_FALLBACK_BASE = "https://generativelanguage.googleapis.com";

function geminiBaseRoot(baseUrl?: string) {
  return normalizeBaseUrl(baseUrl, GEMINI_FALLBACK_BASE).replace(
    /\/v1(?:beta)?$/,
    "",
  );
}

export async function callGoogleGenerateContent(ctx: GatewayAdapterContext) {
  const baseUrl = geminiBaseRoot(ctx.credential.baseUrl);
  const path =
    ctx.path || `models/${ctx.model.model}:streamGenerateContent`;

  const res = await fetch(
    `${baseUrl}/${path}${ctx.search}`,
    withDuplex({
      method: ctx.req.method,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": ctx.credential.apiKey,
      },
      body: ctx.bodyText,
      redirect: "manual",
    }),
  );

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: copyResponseHeaders(res),
  });
}
