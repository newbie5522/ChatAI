import { NextRequest, NextResponse } from "next/server";

import { requireAccount } from "@/app/config/account-auth";
import { getPrismaClient, AttachmentRepository } from "@/app/repositories";

// GET /api/account/attachments/:id — 查询附件状态
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { account, response } = requireAccount(req);
  if (response) return response;
  if (!account)
    return NextResponse.json(
      { error: true, message: "请先登录。" },
      { status: 401 },
    );

  const attachmentRepo = new AttachmentRepository(getPrismaClient());
  const attachment = await attachmentRepo.findById(params.id, account.id);
  if (!attachment)
    return NextResponse.json(
      { error: true, message: "not found" },
      { status: 404 },
    );

  return NextResponse.json({ error: false, attachment });
}

export const runtime = "nodejs";
