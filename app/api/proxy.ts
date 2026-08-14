import { NextRequest, NextResponse } from "next/server";
import { blockLegacyProviderApiInEmployeeMode } from "@/app/api/auth";
import { requireAccount } from "@/app/config/account-auth";

/**
 * Validate that the target URL is safe to forward to (SSRF prevention).
 * Returns true only for public http/https URLs.
 */
export function isSafeTargetUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  // Only http and https allowed
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  // Reject URLs with embedded credentials
  if (parsed.username || parsed.password) {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();

  // Reject loopback / link-local / local hostnames
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname.endsWith(".local")
  ) {
    return false;
  }

  // Reject IPv6 loopback/ULA (fc00::/7)
  if (hostname.startsWith("[")) {
    const ipv6 = hostname.slice(1, -1).toLowerCase();
    if (ipv6 === "::1" || ipv6.startsWith("fc") || ipv6.startsWith("fd")) {
      return false;
    }
  }

  // Reject RFC-1918 / reserved IPv4 ranges
  const ipv4Match = hostname.match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
  );
  if (ipv4Match) {
    const a = Number(ipv4Match[1]);
    const b = Number(ipv4Match[2]);
    if (
      a === 10 || // 10.0.0.0/8
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
      (a === 192 && b === 168) || // 192.168.0.0/16
      (a === 169 && b === 254) || // 169.254.0.0/16 (link-local / cloud metadata)
      a === 127 || // 127.0.0.0/8
      a === 0 // 0.0.0.0/8
    ) {
      return false;
    }
  }

  return true;
}

export async function handle(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  console.log("[Proxy Route] params ", params);

  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" }, { status: 200 });
  }

  // Require authenticated account for all proxy requests
  const { response: authError } = requireAccount(req);
  if (authError) return authError;

  const legacyProviderBlock = blockLegacyProviderApiInEmployeeMode();
  if (legacyProviderBlock) {
    return legacyProviderBlock;
  }

  // remove path params from searchParams
  req.nextUrl.searchParams.delete("path");
  req.nextUrl.searchParams.delete("provider");

  const subpath = params.path.join("/");
  const baseUrl = req.headers.get("x-base-url");

  // Validate target URL to prevent SSRF
  if (!baseUrl || !isSafeTargetUrl(baseUrl)) {
    return NextResponse.json(
      { error: "Invalid or disallowed target URL" },
      { status: 400 },
    );
  }

  const fetchUrl = `${baseUrl}/${subpath}?${req.nextUrl.searchParams.toString()}`;

  // Strip hop-by-hop, identifying, and sensitive response-leak headers
  const skipHeaders = [
    "connection",
    "host",
    "origin",
    "referer",
    "cookie",
    "set-cookie",
  ];
  const headers = new Headers(
    Array.from(req.headers.entries()).filter((item) => {
      if (
        item[0].indexOf("x-") > -1 ||
        item[0].indexOf("sec-") > -1 ||
        skipHeaders.includes(item[0])
      ) {
        return false;
      }
      return true;
    }),
  );

  const controller = new AbortController();
  const fetchOptions: RequestInit = {
    headers,
    method: req.method,
    body: req.body,
    // to fix #2485: https://stackoverflow.com/questions/55920957/cloudflare-worker-typeerror-one-time-use-body
    redirect: "manual",
    // @ts-ignore
    duplex: "half",
    signal: controller.signal,
  };

  const timeoutId = setTimeout(
    () => {
      controller.abort();
    },
    10 * 60 * 1000,
  );

  try {
    const res = await fetch(fetchUrl, fetchOptions);
    // to prevent browser prompt for credentials
    const newHeaders = new Headers(res.headers);
    newHeaders.delete("www-authenticate");
    newHeaders.delete("set-cookie");
    // to disable nginx buffering
    newHeaders.set("X-Accel-Buffering", "no");

    // The latest version of the OpenAI API forced the content-encoding to be "br" in json response
    // So if the streaming is disabled, we need to remove the content-encoding header
    // Because Vercel uses gzip to compress the response, if we don't remove the content-encoding header
    // The browser will try to decode the response with brotli and fail
    newHeaders.delete("content-encoding");

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: newHeaders,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
