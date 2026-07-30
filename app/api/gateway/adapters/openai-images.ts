import { OPENAI_BASE_URL } from "@/app/constant";

import {
  GatewayAdapterContext,
  copyResponseHeaders,
  gatewayJsonError,
  normalizeBaseUrl,
} from "./types";

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object") {
        const item = part as { type?: string; text?: unknown };
        if (item.type && item.type !== "text") return "";
        return typeof item.text === "string" ? item.text : "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function promptFromMessages(messages: unknown) {
  if (!Array.isArray(messages)) return "";

  const userMessages = messages
    .filter(
      (message) =>
        message &&
        typeof message === "object" &&
        (message as { role?: string }).role === "user",
    )
    .map((message) =>
      textFromContent((message as { content?: unknown }).content),
    )
    .filter(Boolean);

  return userMessages.at(-1) ?? "";
}

function extractPrompt(bodyText?: string) {
  if (!bodyText) return "";

  try {
    const body = JSON.parse(bodyText) as Record<string, unknown>;
    return (
      textFromContent(body.prompt).trim() ||
      textFromContent(body.input).trim() ||
      promptFromMessages(body.messages).trim()
    );
  } catch {
    return "";
  }
}

function normalizedImageData(json: any) {
  const data = Array.isArray(json?.data)
    ? json.data
        .map((item: any) => {
          const b64_json = item?.b64_json;
          const url = item?.url;
          if (typeof b64_json === "string" && b64_json) return { b64_json };
          if (typeof url === "string" && url) return { url };
          return undefined;
        })
        .filter(Boolean)
    : [];

  return {
    created: json?.created ?? Math.floor(Date.now() / 1000),
    data,
  };
}

export async function callOpenAIImages(
  ctx: GatewayAdapterContext,
): Promise<Response> {
  const prompt = extractPrompt(ctx.bodyText);
  if (!prompt) {
    return gatewayJsonError(400, "image prompt is required");
  }

  const baseUrl = normalizeBaseUrl(ctx.credential.baseUrl, OPENAI_BASE_URL);
  const res = await fetch(`${baseUrl}/v1/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ctx.credential.apiKey}`,
      ...(ctx.credential.orgId
        ? { "OpenAI-Organization": ctx.credential.orgId }
        : {}),
    },
    body: JSON.stringify({
      model: ctx.model.model,
      prompt,
      n: 1,
      size: "1024x1024",
    }),
  });

  if (!res.ok) {
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: copyResponseHeaders(res),
    });
  }

  const json = await res.json();
  return Response.json(normalizedImageData(json), { status: 200 });
}
