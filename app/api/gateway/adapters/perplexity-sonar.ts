import { PERPLEXITY_BASE_URL } from "@/app/constant";

import {
  GatewayAdapterContext,
  copyResponseHeaders,
  normalizeBaseUrl,
} from "./types";

export async function callPerplexitySonar(ctx: GatewayAdapterContext) {
  const baseUrl = normalizeBaseUrl(ctx.credential.baseUrl, PERPLEXITY_BASE_URL);
  const path = ctx.path || "chat/completions";

  const res = await fetch(`${baseUrl}/${path}${ctx.search}`, {
    method: ctx.req.method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ctx.credential.apiKey}`,
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
