import { NextResponse } from "next/server";

import { clearAccountCookie } from "@/app/config/account-auth";

export async function POST() {
  const res = NextResponse.json({
    error: false,
    authenticated: false,
  });
  clearAccountCookie(res);
  return res;
}

export const runtime = "nodejs";
