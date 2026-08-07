import { Anthropic } from "@/app/constant";

import {
  GatewayAdapterContext,
  copyResponseHeaders,
  normalizeBaseUrl,
  withDuplex,
} from "./types";

const ANTHROPIC_FALLBACK_BASE = "https://api.anthropic.com/v1";

export async function callAnthropicMessages(ctx: GatewayAdapterContext) {
  const baseUrl = normalizeBaseUrl(ctx.credential.baseUrl, ANTHROPIC_FALLBACK_BASE);
  const path = ctx.path || "messages";

  const res = await fetch(
    `${baseUrl}/${path}${ctx.search}`,
    withDuplex({
      method: ctx.req.method,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ctx.credential.apiKey,
        "anthropic-version":
          ctx.credential.apiVersion ||
          ctx.req.headers.get("anthropic-version") ||
          Anthropic.Vision,
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
