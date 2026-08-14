import { NextRequest, NextResponse } from "next/server";

import {
  authenticateAccount,
  getVisibleCompanyModelsForAccount,
  toSafeAccount,
  toSessionUser,
} from "@/app/config/admin-store";
import {
  createAccountSessionToken,
  isAccountSessionConfigured,
  setAccountCookie,
} from "@/app/config/account-auth";
import { checkRateLimit } from "@/app/api/lib/rate-limit";

const LOGIN_RATE_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 }; // 10 attempts per 15 min per IP

async function readBody(req: NextRequest) {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  // Brute-force protection: rate-limit by client IP
  const ip =
    req.ip ??
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown";
  const rl = checkRateLimit(`login:${ip}`, LOGIN_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: true, message: "请求过于频繁，请稍后再试" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)),
        },
      },
    );
  }

  if (!isAccountSessionConfigured()) {
    return NextResponse.json(
      { error: true, message: "登录服务尚未配置会话密钥" },
      { status: 503 },
    );
  }

  const body = await readBody(req);
  const username =
    typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!username || !password) {
    return NextResponse.json(
      { error: true, message: "请输入账号和密码" },
      { status: 400 },
    );
  }

  const account = authenticateAccount(username, password);
  if (!account) {
    return NextResponse.json(
      { error: true, message: "账号或密码错误" },
      { status: 401 },
    );
  }

  const safeAccount = toSafeAccount(account);
  const token = createAccountSessionToken(account.id);
  if (!token) {
    return NextResponse.json(
      { error: true, message: "登录服务尚未配置会话密钥" },
      { status: 503 },
    );
  }

  const res = NextResponse.json({
    error: false,
    authenticated: true,
    user: toSessionUser(safeAccount),
    models: getVisibleCompanyModelsForAccount(safeAccount),
  });
  setAccountCookie(res, token);
  return res;
}

export const runtime = "nodejs";
