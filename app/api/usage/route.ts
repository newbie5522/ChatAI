import { NextRequest, NextResponse } from "next/server";

import { requireAccount } from "@/app/config/account-auth";
import {
  getAccountUsageSummary,
  getMonthKey,
  listAccountUsageRecords,
} from "@/app/config/usage";

async function handle(req: NextRequest) {
  const { account, response } = requireAccount(req);
  if (response) return response;
  if (!account) {
    return NextResponse.json(
      { error: true, message: "account login required" },
      { status: 401 },
    );
  }

  const month = req.nextUrl.searchParams.get("month") || getMonthKey();
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 100);
  const safeLimit = Number.isFinite(limit)
    ? Math.min(Math.max(Math.floor(limit), 1), 500)
    : 100;

  const [summary, records] = await Promise.all([
    getAccountUsageSummary(account, month),
    listAccountUsageRecords(account.id, month, safeLimit),
  ]);

  return NextResponse.json({
    error: false,
    account: {
      id: account.id,
      username: account.username,
      name: account.name,
    },
    summary,
    records,
  });
}

export const GET = handle;
export const POST = handle;

export const runtime = "nodejs";
