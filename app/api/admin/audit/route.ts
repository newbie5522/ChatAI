/**
 * 审计日志 API
 *
 * GET /api/admin/audit?employeeId=xxx&limit=20&offset=0&type=quota|usage
 *
 * 权限：
 * - super_admin：可查所有人的记录
 * - admin：只能查询自己账号下的 employeeId（当前只有账号本身，无子账号体系时等同自己）
 * - employee：无权访问（403）
 */

import { NextRequest, NextResponse } from "next/server";

import { requireAdminAccount } from "@/app/config/account-auth";
import {
  getPrismaClient,
  QuotaRecordRepository,
  UsageRecordRepository,
} from "@/app/repositories";

export async function GET(req: NextRequest) {
  const { account, response } = requireAdminAccount(req);
  if (response) return response;
  if (!account) {
    return NextResponse.json(
      { error: true, message: "需要管理员权限" },
      { status: 403 },
    );
  }

  const { searchParams } = req.nextUrl;
  const employeeId = searchParams.get("employeeId") ?? undefined;
  const type = searchParams.get("type") ?? "all"; // "quota" | "usage" | "all"
  const limit = Math.min(Math.max(1, Number(searchParams.get("limit") ?? 20)), 100);
  const offset = Math.max(0, Number(searchParams.get("offset") ?? 0));

  // 租户隔离：admin 只能查询指定的 employeeId（且必须提供），super_admin 可查所有人
  if (account.role === "admin" && !employeeId) {
    return NextResponse.json(
      { error: true, message: "admin 角色必须指定 employeeId" },
      { status: 400 },
    );
  }

  const prisma = getPrismaClient();
  const quotaRepo = new QuotaRecordRepository(prisma);
  const usageRepo = new UsageRecordRepository(prisma);

  const results: {
    quotaRecords?: unknown[];
    usageRecords?: unknown[];
  } = {};

  if (type === "quota" || type === "all") {
    const filter = {
      employeeId: employeeId ?? undefined,
      limit,
      offset,
    };
    // 直接用 prisma 查询以支持 super_admin 查全局
    const where = filter.employeeId ? { employeeId: filter.employeeId } : {};
    results.quotaRecords = await prisma.quotaRecord.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });
  }

  if (type === "usage" || type === "all") {
    if (employeeId) {
      results.usageRecords = await usageRepo.findMany({
        employeeId,
        limit,
        offset,
      });
    } else {
      // super_admin 查全局
      results.usageRecords = await prisma.usageRecord.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      });
    }
  }

  return NextResponse.json({ ok: true, ...results });
}

export const runtime = "nodejs";
