import type { NextRequest } from "next/server";

import type { ProviderCredential } from "@/app/config/admin-store";
import type { CompanyModel } from "@/app/config/model-registry";

export interface GatewayAdapterContext {
  req: NextRequest;
  path: string;
  search: string;
  bodyText?: string;
  model: CompanyModel;
  credential: ProviderCredential;
}

export function normalizeBaseUrl(
  baseUrl: string | undefined,
  fallback: string,
) {
  const raw = (baseUrl || fallback).trim();
  const withProtocol = raw.startsWith("http") ? raw : `https://${raw}`;
  return withProtocol.endsWith("/")
    ? withProtocol.slice(0, withProtocol.length - 1)
    : withProtocol;
}

export function copyResponseHeaders(res: Response) {
  const headers = new Headers(res.headers);
  headers.delete("www-authenticate");
  headers.delete("content-encoding");
  headers.delete("OpenAI-Organization");
  headers.set("X-Accel-Buffering", "no");
  return headers;
}

export function gatewayJsonError(status: number, message: string) {
  return Response.json({ error: true, message }, { status });
}
