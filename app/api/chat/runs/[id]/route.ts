/**
 * /api/chat/runs/[id] — 更新 ResponseRun 状态
 *
 * PATCH /api/chat/runs/:id
 * Body: { status, errorCode?, errorMessage?, completedAt? }
 */

import { NextRequest, NextResponse } from "next/server";
import { getAccountFromRequest } from "@/app/config/account-auth";
import { getPrismaClient } from "@/app/repositories";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const account = getAccountFromRequest(req);
  if (!account) {
    return NextResponse.json(
      { error: true, message: "account login required" },
      { status: 401 },
    );
  }

  const runId = params.id;
  if (!runId) {
    return NextResponse.json(
      { error: true, message: "run id is required" },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: true, message: "invalid JSON body" },
      { status: 400 },
    );
  }

  const { status, errorCode, errorMessage } = body as Record<string, unknown>;

  const validStatuses = ["pending", "streaming", "completed", "failed", "aborted"];
  if (typeof status !== "string" || !validStatuses.includes(status)) {
    return NextResponse.json(
      { error: true, message: `status must be one of: ${validStatuses.join(", ")}` },
      { status: 400 },
    );
  }

  const prisma = getPrismaClient();

  // 验证 run 归属于当前账号（通过 Message.employeeId 确保租户隔离）
  const existing = await prisma.responseRun.findFirst({
    where: {
      id: runId,
      message: { employeeId: account.id },
    },
  });

  if (!existing) {
    return NextResponse.json(
      { error: true, message: "run not found or access denied" },
      { status: 404 },
    );
  }

  const updateData: Record<string, unknown> = { status };

  if (status === "completed" || status === "failed" || status === "aborted") {
    updateData.completedAt = new Date();
  }
  if (typeof errorCode === "string" && errorCode) {
    updateData.errorCode = errorCode;
  }
  if (typeof errorMessage === "string" && errorMessage) {
    updateData.errorMessage = errorMessage.slice(0, 500); // 截断过长错误信息
  }

  const updated = await prisma.responseRun.update({
    where: { id: runId },
    data: updateData,
  });

  return NextResponse.json({ error: false, run: updated });
}
