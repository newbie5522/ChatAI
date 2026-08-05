import { PERPLEXITY_BASE_URL } from "@/app/constant";

import {
  GatewayAdapterContext,
  copyResponseHeaders,
  gatewayJsonError,
  normalizeBaseUrl,
  withDuplex,
} from "./types";

const FORWARDED_FIELDS = [
  "messages",
  "stream",
  "temperature",
  "top_p",
  "max_tokens",
  "presence_penalty",
  "frequency_penalty",
  "tools",
  "tool_choice",
] as const;

function requestBody(bodyText?: string) {
  if (!bodyText) return undefined;

  try {
    const value: unknown = JSON.parse(bodyText);
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function textFromContent(content: unknown) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part.trim();
      if (!part || typeof part !== "object") return "";
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? text.trim() : "";
    })
    .filter(Boolean)
    .join("\n");
}

function cleanMessages(messages: unknown) {
  if (!Array.isArray(messages)) return [];

  const cleaned: Record<string, unknown>[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const item = message as Record<string, unknown>;
    const content = textFromContent(item.content);
    if (!content) continue;
    cleaned.push({
      ...item,
      content,
    });
  }
  return cleaned;
}

export async function callPerplexitySonar(ctx: GatewayAdapterContext) {
  const baseUrl = normalizeBaseUrl(ctx.credential.baseUrl, PERPLEXITY_BASE_URL);
  const path = ctx.path || "chat/completions";
  const { bodyText } = ctx;
  const input = requestBody(bodyText);
  if (!input) {
    return gatewayJsonError(400, "invalid JSON request body");
  }

  const messages = cleanMessages(input.messages);
  if (messages.length === 0) {
    return gatewayJsonError(400, "message content is required");
  }

  const body: Record<string, unknown> = {
    model: ctx.model.model,
    messages,
  };
  for (const field of FORWARDED_FIELDS) {
    if (field !== "messages" && input[field] !== undefined) {
      body[field] = input[field];
    }
  }

  const res = await fetch(
    `${baseUrl}/${path}${ctx.search}`,
    withDuplex({
      method: ctx.req.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.credential.apiKey}`,
      },
      body: JSON.stringify(body),
      redirect: "manual",
    }),
  );

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: copyResponseHeaders(res),
  });
}
