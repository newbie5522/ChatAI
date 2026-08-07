import {
  GatewayAdapterContext,
  copyResponseHeaders,
  gatewayJsonError,
  normalizeBaseUrl,
} from "./types";

const XAI_FALLBACK_BASE = "https://api.x.ai";

function promptFromBody(bodyText?: string) {
  if (!bodyText) return "";

  try {
    const value: unknown = JSON.parse(bodyText);
    if (!value || typeof value !== "object") return "";
    const body = value as Record<string, unknown>;
    const prompt = body.prompt;
    return typeof prompt === "string" ? prompt.trim() : "";
  } catch {
    return "";
  }
}

export async function callXAIImages(
  ctx: GatewayAdapterContext,
): Promise<Response> {
  const prompt = promptFromBody(ctx.bodyText);
  if (!prompt) {
    return gatewayJsonError(400, "image prompt is required");
  }

  const baseUrl = normalizeBaseUrl(ctx.credential.baseUrl, XAI_FALLBACK_BASE);
  const res = await fetch(`${baseUrl}/v1/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ctx.credential.apiKey}`,
    },
    body: JSON.stringify({
      model: ctx.model.model,
      prompt,
      response_format: "url",
      n: 1,
    }),
    redirect: "manual",
  });

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: copyResponseHeaders(res),
  });
}
