import { createHmac, timingSafeEqual } from "crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  AccountRole,
  SafeAccountRecord,
  findAccountById,
  toSafeAccount,
} from "./admin-store";

const ACCOUNT_COOKIE = "newbie_account_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface AccountSessionPayload {
  accountId: string;
  exp: number;
}

function getSessionSecret() {
  return process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD || "newbiechat";
}

function base64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value: string) {
  return createHmac("sha256", getSessionSecret()).update(value).digest("hex");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function shouldUseSecureSessionCookie() {
  return process.env.ADMIN_COOKIE_SECURE === "1";
}

export function createAccountSessionToken(accountId: string) {
  const payload: AccountSessionPayload = {
    accountId,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const encodedPayload = base64Url(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyAccountSessionToken(token?: string) {
  if (!token) return null;

  const [encodedPayload, signature] = token.split(".");
  if (
    !encodedPayload ||
    !signature ||
    !safeEqual(signature, sign(encodedPayload))
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      fromBase64Url(encodedPayload),
    ) as AccountSessionPayload;
    if (!payload.accountId || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function getAccountFromRequest(req: NextRequest) {
  const payload = verifyAccountSessionToken(
    req.cookies.get(ACCOUNT_COOKIE)?.value,
  );
  if (!payload) return null;

  const account = findAccountById(payload.accountId);
  if (!account || account.status !== "active") return null;
  return toSafeAccount(account);
}

export function isAdminRole(role?: AccountRole) {
  return role === "admin" || role === "super_admin";
}

export function requireAccount(req: NextRequest) {
  const account = getAccountFromRequest(req);
  if (!account) {
    return {
      account: null,
      response: NextResponse.json(
        { error: true, message: "account login required" },
        { status: 401 },
      ),
    };
  }

  return { account, response: null };
}

export function requireAdminAccount(req: NextRequest) {
  const { account, response } = requireAccount(req);
  if (response) return { account: null, response };

  if (!isAdminRole(account?.role)) {
    return {
      account: null,
      response: NextResponse.json(
        { error: true, message: "admin role required" },
        { status: 403 },
      ),
    };
  }

  return { account: account as SafeAccountRecord, response: null };
}

export function setAccountCookie(res: NextResponse, token: string) {
  res.cookies.set(ACCOUNT_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureSessionCookie(),
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearAccountCookie(res: NextResponse) {
  res.cookies.set(ACCOUNT_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureSessionCookie(),
    path: "/",
    maxAge: 0,
  });
}

export function canManageRole(
  actor: SafeAccountRecord,
  targetRole: AccountRole,
) {
  if (actor.role === "super_admin") return true;
  return actor.role === "admin" && targetRole === "employee";
}
