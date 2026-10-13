import { NextRequest, NextResponse } from "next/server";
import { requireAccount } from "@/app/config/account-auth";
import { getServerSideConfig } from "@/app/config/server";
import { getPrismaClient, MediaJobRepository } from "@/app/repositories";

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: true, message }, { status });
}

interface RouteContext {
  params: { id: string };
}

/**
 * GET /api/media/jobs/:id/result — 从 Cloudflare KV 读取产物内容
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
    if (job.status !== "completed") {
      return NextResponse.json(
        { error: false, status: job.status, ready: false },
        { status: 202 },
      );
    }
    if (!job.storageKey) {
      return errorResponse("任务已完成但产物存储键缺失。", 500);
    }

    const serverConfig = getServerSideConfig();
    const kvUrl = `https://api.cloudflare.com/client/v4/accounts/${serverConfig.cloudflareAccountId}/storage/kv/namespaces/${serverConfig.cloudflareKVNamespaceId}/values/${encodeURIComponent(job.storageKey)}`;
    const kvRes = await fetch(kvUrl, {
      headers: {
        Authorization: `Bearer ${serverConfig.cloudflareKVApiKey}`,
      },
    });

    if (!kvRes.ok) {
      return errorResponse("读取产物失败，请稍后重试。", 502);
    }

    return new Response(kvRes.body, {
      status: kvRes.status,
      headers: {
        "Content-Type":
          kvRes.headers.get("content-type") ?? "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    console.error("[GET /api/media/jobs/:id/result]", err);
    return errorResponse("获取产物失败，请稍后重试。", 500);
  }
}

export const runtime = "nodejs";
