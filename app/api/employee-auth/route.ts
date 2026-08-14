import { NextRequest, NextResponse } from "next/server";
import md5 from "spark-md5";

import { getServerSideConfig } from "@/app/config/server";
import {
  hasEmployeeAccessControl,
  validateEmployeeAccessKey,
} from "@/app/config/employee";
import { checkRateLimit } from "@/app/api/lib/rate-limit";

const AUTH_RATE_LIMIT = { limit: 10, windowMs: 5 * 60 * 1000 }; // 10 attempts per 5 min per IP

function clientIp(req: NextRequest): string {
  return (
    req.ip ??
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown"
  );
}

async function getAccessKey(req: NextRequest) {
  try {
    const body = (await req.json()) as { accessKey?: string };
    return body.accessKey?.trim() ?? "";
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  // Brute-force protection: rate-limit by client IP
  const rl = checkRateLimit(`employee-auth:${clientIp(req)}`, AUTH_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, message: "请求过于频繁，请稍后再试" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)),
        },
      },
    );
  }

  const accessKey = await getAccessKey(req);
  const serverConfig = getServerSideConfig();

  if (hasEmployeeAccessControl()) {
    const validation = validateEmployeeAccessKey(accessKey);
    if (!validation.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: validation.reason ?? "wrong employee access key",
        },
        { status: 401 },
      );
    }

    return NextResponse.json({
      ok: true,
      employee: validation.employee,
    });
  }

  if (!serverConfig.needCode) {
    return NextResponse.json({ ok: true });
  }

  const hashedCode = md5.hash(accessKey).trim();
  if (serverConfig.codes.has(hashedCode)) {
    return NextResponse.json({
      ok: true,
      employee: {
        id: "legacy-code",
        name: "Legacy Access Code",
        status: "active",
      },
    });
  }

  return NextResponse.json(
    {
      ok: false,
      message: !accessKey ? "empty access code" : "wrong access code",
    },
    { status: 401 },
  );
}

export const runtime = "nodejs";
