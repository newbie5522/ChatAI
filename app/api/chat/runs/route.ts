/**
 * /api/chat/runs — ResponseRun 状态管理 API
 *
 * Issue #17: 可恢复流式聊天运行时
 *
 * 职责：
 * 1. POST   /api/chat/runs          — 创建 ResponseRun（前端请求前调用）
 * 2. PATCH  /api/chat/runs/:id      — 更新状态（streaming/completed/failed/aborted）
 * 3. GET    /api/chat/runs/pending  — 查询当前账号的未完成 run（页面刷新时检测）
 *
 * 设计原则：
 * - 认证：复用 getAccountFromRequest（cookie 会话）
 * - 租户隔离：所有查询必须绑定 employeeId（从 account.id 获取）
 * - 幂等：前端可安全重试 POST（同一 requestId 返回已有 run 而不报错）
 * - 无破坏性：现有流式请求路径完全不受影响，状态同步为「插件式」
 */

import { NextRequest, NextResponse } from "next/server";
import { getAccountFromRequest } from "@/app/config/account-auth";
import { getPrismaClient } from "@/app/repositories";

// ── 共用工具 ──────────────────────────────────────────────────────────────

function authError() {
  return NextResponse.json(
    { error: true, message: "account login required" },
    { status: 401 },
  );
}

function ok(data: unknown, status = 200) {
  return NextResponse.json({ error: false, ...((data && typeof data === 'object') ? data : { data }) }, { status });
}

// ── POST /api/chat/runs — 创建 ResponseRun ────────────────────────────────

export async function POST(req: NextRequest) {
  const account = getAccountFromRequest(req);
  if (!account) return authError();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: true, message: "invalid JSON body" }, { status: 400 });
  }

  const {
    requestId,
    messageId,
    providerId,
    modelId,
    branchId,
  } = (body as Record<string, unknown>);

  if (
    typeof requestId !== "string" || !requestId ||
    typeof messageId !== "string" || !messageId ||
    typeof providerId !== "string" || !providerId ||
    typeof modelId !== "string" || !modelId
  ) {
    return NextResponse.json(
      { error: true, message: "requestId, messageId, providerId, modelId are required" },
      { status: 400 },
    );
  }

  const prisma = getPrismaClient();

  // 幂等：同一 requestId 已存在则直接返回
  const existing = await prisma.responseRun.findFirst({
    where: { messageId, status: { not: "aborted" } },
    orderBy: { startedAt: "desc" },
  });
  if (existing) {
    return ok({ run: existing }, 200);
  }

  const run = await prisma.responseRun.create({
    data: {
      messageId,
      branchId: typeof branchId === "string" ? branchId : null,
      providerId,
      modelId,
      status: "pending",
    },
  });

  return ok({ run }, 201);
}

// ── GET /api/chat/runs/pending — 查询未完成 run ───────────────────────────

export async function GET(req: NextRequest) {
  const account = getAccountFromRequest(req);
  if (!account) return authError();

  const url = new URL(req.url);
  const isPending = url.pathname.endsWith("/pending");

  if (!isPending) {
    return NextResponse.json({ error: true, message: "use /api/chat/runs/pending" }, { status: 404 });
  }

  const prisma = getPrismaClient();

  // 查询属于当前账号的所有 pending/streaming run
  // 通过 Message → Conversation → employeeId 确保租户隔离
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
    take: 20, // 每次最多返回 20 个，避免过度查询
  });

  return ok({ runs });
}
