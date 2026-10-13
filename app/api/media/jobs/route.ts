import { NextRequest, NextResponse } from "next/server";
import { requireAccount } from "@/app/config/account-auth";
import { getPrismaClient, MediaJobRepository } from "@/app/repositories";
import type { CreateMediaJobInput } from "@/app/types/v2-models";

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: true, message }, { status });
}

/**
 * POST /api/media/jobs — 创建媒体生成任务
 */
export async function POST(req: NextRequest) {
  const { account, response } = requireAccount(req);
  if (response) return response;
  if (!account) return errorResponse("请先登录。", 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse("请求体格式错误。");
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).kind !== "string" ||
    typeof (body as Record<string, unknown>).prompt !== "string" ||
    typeof (body as Record<string, unknown>).modelId !== "string" ||
    typeof (body as Record<string, unknown>).providerId !== "string"
  ) {
    return errorResponse("缺少必要参数：kind、prompt、modelId、providerId。");
  }

  const data = body as Record<string, unknown>;
  const kind = data.kind as string;
  if (kind !== "image" && kind !== "video") {
    return errorResponse("kind 必须为 image 或 video。");
  }

  const input: CreateMediaJobInput = {
    employeeId: account.id,
    messageId: typeof data.messageId === "string" ? data.messageId : undefined,
    kind,
    prompt: data.prompt as string,
    modelId: data.modelId as string,
    providerId: data.providerId as string,
    expiresAt:
      typeof data.expiresAt === "string"
        ? new Date(data.expiresAt)
        : undefined,
  };

  try {
    const repo = new MediaJobRepository(getPrismaClient());
    const job = await repo.create(input);
    return NextResponse.json({ error: false, job }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/media/jobs]", err);
    return errorResponse("创建任务失败，请稍后重试。", 500);
  }
}

/**
 * GET /api/media/jobs?status=pending — 查询未完成任务（刷新恢复用）
 */
export async function GET(req: NextRequest) {
  const { account, response } = requireAccount(req);
  if (response) return response;
  if (!account) return errorResponse("请先登录。", 401);

  try {
    const repo = new MediaJobRepository(getPrismaClient());
    const jobs = await repo.findPending(account.id);
    return NextResponse.json({ error: false, jobs });
  } catch (err) {
    console.error("[GET /api/media/jobs]", err);
    return errorResponse("查询任务失败，请稍后重试。", 500);
  }
}

export const runtime = "nodejs";
