import {
  GatewayAdapterContext,
  copyResponseHeaders,
  gatewayJsonError,
} from "./types";

const PROVIDER_ENDPOINTS = {
  xai: "https://api.x.ai/v1/chat/completions",
  deepseek: "https://api.deepseek.com/chat/completions",
  qwen: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
  mistral: "https://api.mistral.ai/v1/chat/completions",
  zhipu: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
} as const;

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

export async function callOpenAICompatibleChat(
  ctx: GatewayAdapterContext,
): Promise<Response> {
  if (!(ctx.model.provider in PROVIDER_ENDPOINTS)) {
    return gatewayJsonError(500, "unsupported OpenAI-compatible provider");
  }

  const input = requestBody(ctx.bodyText);
  if (!input) {
    return gatewayJsonError(400, "invalid JSON request body");
  }

  const body: Record<string, unknown> = {
    model: ctx.model.model,
  };
  for (const field of FORWARDED_FIELDS) {
    if (input[field] !== undefined) {
      body[field] = input[field];
    }
  }

  const provider = ctx.model.provider as keyof typeof PROVIDER_ENDPOINTS;
  const res = await fetch(PROVIDER_ENDPOINTS[provider], {
    method: "POST",
    headers: {
      Accept: "application/json",
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
