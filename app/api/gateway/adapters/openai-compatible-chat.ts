import type { ModelProvider } from "@/app/config/model-registry";

import {
  GatewayAdapterContext,
  copyResponseHeaders,
  gatewayJsonError,
  normalizeBaseUrl,
} from "./types";

const PROVIDER_COMPATIBLE_BASE_URLS: Record<ModelProvider, string | undefined> =
  {
    openai: "https://api.openai.com/v1",
    xai: "https://api.x.ai/v1",
    deepseek: "https://api.deepseek.com/v1",
    qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    mistral: "https://api.mistral.ai/v1",
    zhipu: "https://open.bigmodel.cn/api/paas/v4",
    anthropic: undefined,
    google: undefined,
    perplexity: undefined,
  };

const FORWARDED_FIELDS = [
  "messages",
  "stream",
  "tools",
  "tool_choice",
  "temperature",
  "top_p",
  "max_tokens",
  "response_format",
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

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isUsableContent(content: unknown) {
  if (isNonEmptyText(content)) return true;

  if (Array.isArray(content)) {
    return content.some((part) => {
      if (typeof part === "string") return isNonEmptyText(part);
      if (!part || typeof part !== "object") return false;
      const item = part as {
        type?: string;
        text?: unknown;
        image_url?: unknown;
      };
      if (item.type === "text") return isNonEmptyText(item.text);
      if (item.type === "image_url") {
        const imageUrl = item.image_url as { url?: unknown } | undefined;
        return isNonEmptyText(imageUrl?.url);
      }
      return false;
    });
  }

  return false;
}

function cleanMessages(messages: unknown) {
  if (!Array.isArray(messages)) return [];

  return messages
    .map((message) => {
      if (!message || typeof message !== "object") return undefined;
      const item = message as Record<string, unknown>;
      return isUsableContent(item.content) ? item : undefined;
    })
    .filter((message): message is Record<string, unknown> => !!message);
}

export async function callOpenAICompatibleChat(
  ctx: GatewayAdapterContext,
): Promise<Response> {
  const { bodyText } = ctx;
  const input = requestBody(bodyText);
  if (!input) {
    return gatewayJsonError(400, "invalid JSON request body");
  }

  const messages = cleanMessages(input.messages);
  if (messages.length === 0) {
    return gatewayJsonError(400, "message content is required");
  }

  const fallback = PROVIDER_COMPATIBLE_BASE_URLS[ctx.credential.provider];
  const rawBaseUrl = (ctx.credential.baseUrl || "").trim();
  if (!rawBaseUrl && !fallback) {
    return gatewayJsonError(
      500,
      "该服务商官方不支持 OpenAI 兼容接口，请在管理后台填写中转商后端地址",
    );
  }
  const endpoint = `${normalizeBaseUrl(rawBaseUrl, fallback ?? "")}/chat/completions`;

  const body: Record<string, unknown> = {
    model: ctx.model.model,
    messages,
  };
  for (const field of FORWARDED_FIELDS) {
    if (field !== "messages" && input[field] !== undefined) {
      body[field] = input[field];
    }
  }

  const shouldStream = input.stream === true;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: shouldStream ? "text/event-stream" : "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${ctx.credential.apiKey}`,
    },
    body: JSON.stringify(body),
    redirect: "manual",
  });

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: copyResponseHeaders(res),
  });
}
