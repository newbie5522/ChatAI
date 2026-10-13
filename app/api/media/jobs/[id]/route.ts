import { NextRequest, NextResponse } from "next/server";
import { requireAccount } from "@/app/config/account-auth";
import { getPrismaClient, MediaJobRepository } from "@/app/repositories";

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: true, message }, { status });
}

interface RouteContext {
  params: { id: string };
}

/**
 * GET /api/media/jobs/:id — 查询单个任务
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  const { account, response } = requireAccount(req);
  if (response) return response;
  if (!account) return errorResponse("请先登录。", 401);

  const { id } = params;
  if (!id) return errorResponse("缺少任务 ID。");

  try {
    const repo = new MediaJobRepository(getPrismaClient());
    const job = await repo.findById(id, account.id);
    if (!job) return errorResponse("任务不存在或无权访问。", 404);
    return NextResponse.json({ error: false, job });
  } catch (err) {
    console.error("[GET /api/media/jobs/:id]", err);
    return errorResponse("查询任务失败，请稍后重试。", 500);
  }
}

/**
 * PATCH /api/media/jobs/:id — 取消任务
 * body: { action: "cancel" }
 */
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { account, response } = requireAccount(req);
  if (response) return response;
  if (!account) return errorResponse("请先登录。", 401);

  const { id } = params;
  if (!id) return errorResponse("缺少任务 ID。");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse("请求体格式错误。");
  }

  const action =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).action
      : undefined;

  if (action !== "cancel") {
    return errorResponse("不支持的操作，目前仅支持 action: cancel。");
  }

  try {
    const repo = new MediaJobRepository(getPrismaClient());
    const job = await repo.cancel(id, account.id);
    return NextResponse.json({ error: false, job });
  } catch (err) {
    if (err instanceof Error) {
      if (
        err.message === "MediaJob not found or access denied" ||
        err.message === "Cannot cancel a finished job"
      ) {
        return errorResponse(err.message, 400);
      }
    }
    console.error("[PATCH /api/media/jobs/:id]", err);
    return errorResponse("取消任务失败，请稍后重试。", 500);
  }
}

export const runtime = "nodejs";
