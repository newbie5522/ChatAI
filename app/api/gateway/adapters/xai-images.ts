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
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: copyResponseHeaders(res),
    });
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    console.error(`[XAIImages] response is not valid JSON model=${ctx.model.model}`);
    return Response.json(
      { error: true, message: "image provider returned a non-JSON response" },
      { status: 502 },
    );
  }

  if (json && typeof json === "object" && (json as any).error) {
    const errMsg =
      typeof (json as any).error === "string"
        ? (json as any).error
        : (json as any).error?.message ?? "upstream image error";
    console.error(`[XAIImages] upstream error in 200 body model=${ctx.model.model} error=${errMsg}`);
    return Response.json({ error: true, message: errMsg }, { status: 502 });
  }

  const data = Array.isArray((json as any)?.data) ? (json as any).data : [];
  if (data.length === 0) {
    console.error(`[XAIImages] empty data array model=${ctx.model.model}`);
    return Response.json(
      { error: true, message: "image provider returned an empty response" },
      { status: 502 },
    );
  }

  return Response.json(json, { status: 200 });
}
