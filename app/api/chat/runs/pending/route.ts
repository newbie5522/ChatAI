/**
 * /api/chat/runs/pending — 查询当前账号的未完成 ResponseRun
 *
 * GET /api/chat/runs/pending
 * 返回 status in [pending, streaming] 的 run 列表
 * 前端页面加载时调用，检测是否有需要恢复的对话
 */

import { NextRequest, NextResponse } from "next/server";
import { getAccountFromRequest } from "@/app/config/account-auth";
import { getPrismaClient } from "@/app/repositories";

export async function GET(req: NextRequest) {
  const account = getAccountFromRequest(req);
  if (!account) {
    return NextResponse.json(
      { error: true, message: "account login required" },
      { status: 401 },
    );
  }

  const prisma = getPrismaClient();

  const runs = await prisma.responseRun.findMany({
    where: {
      status: { in: ["pending", "streaming"] },
      message: {
        employeeId: account.id,
      },
    },
    include: {
      message: {
        select: {
          id: true,
          conversationId: true,
          employeeId: true,
        },
      },
    },
    orderBy: { startedAt: "desc" },
    take: 20,
  });

  return NextResponse.json({ error: false, runs });
}
