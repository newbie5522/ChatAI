import { createHmac, timingSafeEqual } from "crypto";

import { NextRequest, NextResponse } from "next/server";

const ADMIN_COOKIE = "newbie_admin_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface AdminSessionPayload {
  role: "admin";
  exp: number;
}

function getAdminPassword() {
  return process.env.ADMIN_PASSWORD || "";
}

function getSessionSecret() {
  return process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD || "";
}

function base64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value: string) {
  return createHmac("sha256", getSessionSecret())
    .update(value)
    .digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function isAdminConfigured() {
  return !!getAdminPassword();
}

export function verifyAdminPassword(password: string) {
  const configuredPassword = getAdminPassword();
  if (!configuredPassword) return false;
  return safeEqual(password, configuredPassword);
}

export function createAdminSessionToken() {
  const payload: AdminSessionPayload = {
    role: "admin",
    exp: Date.now() + SESSION_TTL_MS,
  };
  const encodedPayload = base64Url(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyAdminSessionToken(token?: string) {
  if (!token || !getSessionSecret()) return false;

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return false;
  if (!safeEqual(sign(encodedPayload), signature)) return false;

  try {
    const payload = JSON.parse(
      fromBase64Url(encodedPayload),
    ) as AdminSessionPayload;
    return payload.role === "admin" && payload.exp > Date.now();
  } catch {
    return false;
  }
}

export function isAdminRequest(req: NextRequest) {
  return verifyAdminSessionToken(req.cookies.get(ADMIN_COOKIE)?.value);
}

export function requireAdmin(req: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      {
        error: true,
        message: "admin password is not configured",
      },
      { status: 503 },
    );
  }

  if (!isAdminRequest(req)) {
    return NextResponse.json(
      {
        error: true,
        message: "admin authentication required",
      },
      { status: 401 },
    );
  }
}

export function setAdminCookie(res: NextResponse, token: string) {
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearAdminCookie(res: NextResponse) {
  res.cookies.set(ADMIN_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
