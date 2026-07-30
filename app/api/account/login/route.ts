import { NextRequest, NextResponse } from "next/server";

import {
  authenticateAccount,
  getVisibleCompanyModelsForAccount,
  toSafeAccount,
  toSessionUser,
} from "@/app/config/admin-store";
import {
  createAccountSessionToken,
  setAccountCookie,
} from "@/app/config/account-auth";

async function readBody(req: NextRequest) {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const username =
    typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!username || !password) {
    return NextResponse.json(
      { error: true, message: "username and password are required" },
      { status: 400 },
    );
  }

  const account = authenticateAccount(username, password);
  if (!account) {
    return NextResponse.json(
      { error: true, message: "invalid username or password" },
      { status: 401 },
    );
  }

  const safeAccount = toSafeAccount(account);
  const res = NextResponse.json({
    error: false,
    authenticated: true,
    user: toSessionUser(safeAccount),
    models: getVisibleCompanyModelsForAccount(safeAccount),
  });
  setAccountCookie(res, createAccountSessionToken(account.id));
  return res;
}

export const runtime = "nodejs";
