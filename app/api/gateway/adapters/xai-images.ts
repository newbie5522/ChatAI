import {
  GatewayAdapterContext,
  copyResponseHeaders,
  gatewayJsonError,
} from "./types";

const XAI_IMAGES_ENDPOINT = "https://api.x.ai/v1/images/generations";

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

  const res = await fetch(XAI_IMAGES_ENDPOINT, {
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
