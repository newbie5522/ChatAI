import { NextRequest, NextResponse } from "next/server";
import { getServerSideConfig } from "@/app/config/server";
import { requireAccount } from "@/app/config/account-auth";
import { randomBytes } from "crypto";

const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB

const ALLOWED_CONTENT_TYPES = [
  "application/json",
  "text/plain",
  "text/html",
  "image/",
];

function isAllowedContentType(ct: string | null): boolean {
  if (!ct) return true; // allow missing content-type
  const base = ct.split(";")[0].trim().toLowerCase();
  return ALLOWED_CONTENT_TYPES.some(
    (allowed) =>
      allowed.endsWith("/") ? base.startsWith(allowed) : base === allowed,
  );
}

/** Generate a random 32-byte hex ID */
function generateId(): string {
  return randomBytes(16).toString("hex");
}

/** Validate that id is a 32-char hex string or UUID */
function isValidId(id: string): boolean {
  return /^[0-9a-f]{32}$/i.test(id) || /^[0-9a-f-]{36}$/i.test(id);
}

async function handle(req: NextRequest) {
  // Require authenticated account
  const { response: authError } = requireAccount(req);
  if (authError) return authError;

  const serverConfig = getServerSideConfig();
  const storeUrl = () =>
    `https://api.cloudflare.com/client/v4/accounts/${serverConfig.cloudflareAccountId}/storage/kv/namespaces/${serverConfig.cloudflareKVNamespaceId}`;
  const storeHeaders = () => ({
    Authorization: `******`
  });

  if (req.method === "POST") {
    // Content-type whitelist
    const contentType = req.headers.get("content-type");
    if (!isAllowedContentType(contentType)) {
      return NextResponse.json(
        { error: true, msg: "Unsupported content type" },
        { status: 415 },
      );
    }

    // Body size limit
    const clonedBody = await req.text();
    if (new TextEncoder().encode(clonedBody).length > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: true, msg: "Request body too large (max 5 MB)" },
        { status: 413 },
      );
    }

    // Use random, unguessable ID instead of content hash
    const id = generateId();
    const body: {
      key: string;
      value: string;
      expiration_ttl?: number;
    } = {
      key: id,
      value: clonedBody,
    };
    try {
      const ttl = parseInt(serverConfig.cloudflareKVTTL as string);
      if (ttl > 60) {
        body["expiration_ttl"] = ttl;
      }
    } catch (e) {
      console.error(e);
    }
    const res = await fetch(`${storeUrl()}/bulk`, {
      headers: {
        ...storeHeaders(),
        "Content-Type": "application/json",
      },
      method: "PUT",
      body: JSON.stringify([body]),
    });
    const result = await res.json();
    console.log("save data", result);
    if (result?.success) {
      return NextResponse.json(
        { code: 0, id, result },
        { status: res.status },
      );
    }
    return NextResponse.json(
      { error: true, msg: "Save data error" },
      { status: 400 },
    );
  }

  if (req.method === "GET") {
    const id = req?.nextUrl?.searchParams?.get("id");
    if (!id || !isValidId(id)) {
      return NextResponse.json(
        { error: true, msg: "Invalid or missing id" },
        { status: 400 },
      );
    }
    const res = await fetch(`${storeUrl()}/values/${id}`, {
      headers: storeHeaders(),
      method: "GET",
    });
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  }

  return NextResponse.json(
    { error: true, msg: "Invalid request" },
    { status: 400 },
  );
}

export const POST = handle;
export const GET = handle;

export const runtime = "nodejs";
