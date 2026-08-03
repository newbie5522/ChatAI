import { PERPLEXITY_BASE_URL } from "@/app/constant";

import {
  GatewayAdapterContext,
  copyResponseHeaders,
  normalizeBaseUrl,
  withDuplex,
} from "./types";

export async function callPerplexitySonar(ctx: GatewayAdapterContext) {
  const baseUrl = normalizeBaseUrl(ctx.credential.baseUrl, PERPLEXITY_BASE_URL);
  const path = ctx.path || "chat/completions";

  const res = await fetch(
    `${baseUrl}/${path}${ctx.search}`,
    withDuplex({
      method: ctx.req.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.credential.apiKey}`,
      },
      body: ctx.bodyText,
      signal: ctx.signal,
      redirect: "manual",
    }),
  );

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: copyResponseHeaders(res),
  });
}
