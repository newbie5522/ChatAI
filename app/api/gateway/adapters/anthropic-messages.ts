import { Anthropic, ANTHROPIC_BASE_URL } from "@/app/constant";

import {
  GatewayAdapterContext,
  copyResponseHeaders,
  normalizeBaseUrl,
} from "./types";

export async function callAnthropicMessages(ctx: GatewayAdapterContext) {
  const baseUrl = normalizeBaseUrl(ctx.credential.baseUrl, ANTHROPIC_BASE_URL);
  const path = ctx.path || Anthropic.ChatPath;

  const res = await fetch(`${baseUrl}/${path}${ctx.search}`, {
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
    // @ts-ignore
    duplex: "half",
  });

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: copyResponseHeaders(res),
  });
}
