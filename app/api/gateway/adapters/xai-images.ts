import {
  GatewayAdapterContext,
  copyResponseHeaders,
  gatewayJsonError,
  normalizeBaseUrl,
} from "./types";

const XAI_FALLBACK_BASE = "https://api.x.ai/v1";

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
  const res = await fetch(`${baseUrl}/images/generations`, {
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

  if (!res.ok) {
    console.error(
      `[XAIImages] upstream error ${res.status} ${res.statusText} model=${ctx.model.model}`,
    );
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: copyResponseHeaders(res),
    });
  }

  // Issue #15: 验证响应内容有效性
  const json = await res.json();
  const data = Array.isArray(json?.data) ? json.data.filter((item: any) => item?.url || item?.b64_json) : [];
  
  if (data.length === 0) {
    console.error(
      `[XAIImages] EMPTY_RESPONSE: HTTP 200 but no valid media content model=${ctx.model.model} json=${JSON.stringify(json)}`,
    );
    return new Response(
      JSON.stringify({
        error: {
          message: "Provider returned empty response",
          code: "EMPTY_RESPONSE",
          provider: "xai",
          model: ctx.model.model,
        },
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  console.log(`[XAIImages] success model=${ctx.model.model} data.length=${data.length}`);
  return Response.json({ ...json, data }, { status: 200 });
}
