/**
 * 额度余额 API
 *
 * GET /api/account/quota — 查询当前员工的余额
 *
 * 认证：requireAccount（已登录员工即可访问）
 */

import { NextRequest, NextResponse } from "next/server";

import { requireAccount } from "@/app/config/account-auth";
import { getPrismaClient, QuotaRecordRepository } from "@/app/repositories";

export async function GET(req: NextRequest) {
  const { account, response } = requireAccount(req);
  if (response) return response;
  if (!account) {
    return NextResponse.json(
      { error: true, message: "account login required" },
      { status: 401 },
    );
  }

  const prisma = getPrismaClient();
  const quotaRepo = new QuotaRecordRepository(prisma);
  const balance = await quotaRepo.getCurrentBalance(account.id);

  return NextResponse.json({
    ok: true,
    employeeId: account.id,
    balance,
  });
}

export const runtime = "nodejs";
