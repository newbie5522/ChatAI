import {
  GatewayAdapterContext,
  copyResponseHeaders,
  gatewayJsonError,
  normalizeBaseUrl,
  withDuplex,
} from "./types";

const PERPLEXITY_FALLBACK_BASE = "https://api.perplexity.ai/v1";

function perplexityBaseUrl(baseUrl?: string) {
  const normalized = normalizeBaseUrl(baseUrl, PERPLEXITY_FALLBACK_BASE);
  if (normalized.endsWith("/v1")) return normalized;
  return `${normalized}/v1`;
}

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

type OpenAIImageContent = {
  type: "image_url";
  image_url: {
    url: string;
  };
};

type OpenAITextContent = {
  type: "text";
  text: string;
};

type PerplexityMessageContent =
  | string
  | Array<OpenAITextContent | OpenAIImageContent>;

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

function textPart(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isValidImageUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const url = value.trim();
  if (!url) return false;
  return (
    /^https:\/\/\S+$/i.test(url) ||
    /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(url)
  );
}

function cleanContent(content: unknown): PerplexityMessageContent | undefined {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return undefined;

  const parts: Array<OpenAITextContent | OpenAIImageContent> = [];
  for (const part of content) {
    const directText = textPart(part);
    if (directText) {
      parts.push({ type: "text", text: directText });
      continue;
    }

    if (!part || typeof part !== "object") continue;
    const item = part as {
      type?: unknown;
      text?: unknown;
      image_url?: unknown;
    };

    if (item.type === "text") {
      const text = textPart(item.text);
      if (text) parts.push({ type: "text", text });
      continue;
    }

    if (item.type === "image_url") {
      const imageUrl = item.image_url as { url?: unknown } | undefined;
      const url = imageUrl?.url;
      if (isValidImageUrl(url)) {
        parts.push({
          type: "image_url",
          image_url: { url: url.trim() },
        });
      }
    }
  }

  if (parts.length === 0) return undefined;
  const hasImage = parts.some((part) => part.type === "image_url");
  return hasImage
    ? parts
    : parts
        .map((part) => (part.type === "text" ? part.text : ""))
        .filter(Boolean)
        .join("\n");
}

function hasContent(content: PerplexityMessageContent | undefined) {
  if (typeof content === "string") return content.length > 0;
  return Array.isArray(content) && content.length > 0;
}

function cleanMessages(messages: unknown) {
  if (!Array.isArray(messages)) return [];

  const cleaned: Record<string, unknown>[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const item = message as Record<string, unknown>;
    const content = cleanContent(item.content);
    if (!hasContent(content)) continue;
    cleaned.push({
      ...item,
      content,
    });
  }
  return cleaned;
}

function sanitizeProviderError(message: string) {
  return message
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "[image]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\b[A-Za-z0-9+/]{120,}={0,2}\b/g, "[redacted]")
    .replace(
      /(authorization|api[_-]?key|x-api-key)(["'\s:=]+)([^"',\s}]+)/gi,
      "$1$2[redacted]",
    )
    .trim()
    .slice(0, 600);
}

async function providerErrorMessage(res: Response) {
  const fallback = `perplexity request failed (${res.status})`;
  const text = await res.text();
  if (!text) return fallback;

  try {
    const body = JSON.parse(text) as {
      error?: { message?: unknown };
      message?: unknown;
    };
    const message =
      typeof body.error?.message === "string"
        ? body.error.message
        : typeof body.message === "string"
        ? body.message
        : "";
    return sanitizeProviderError(message || fallback);
  } catch {
    return sanitizeProviderError(text) || fallback;
  }
}

export async function callPerplexitySonar(ctx: GatewayAdapterContext) {
  const baseUrl = perplexityBaseUrl(ctx.credential.baseUrl);
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

  if (!res.ok) {
    return gatewayJsonError(res.status, await providerErrorMessage(res));
  }

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: copyResponseHeaders(res),
  });
}
