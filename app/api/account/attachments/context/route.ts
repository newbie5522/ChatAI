import { NextRequest, NextResponse } from "next/server";

import { requireAccount } from "@/app/config/account-auth";
import { readAttachmentAnalysisSession } from "@/app/config/attachment-analysis-store";
import type { AttachmentContextItem } from "@/app/types/attachment";
import {
  buildCombinedTableSummary,
  buildTableAnalysisContext,
  selectDocumentChunks,
} from "@/app/utils/attachment-analysis";

const DEFAULT_QUERY = "请完整分析这些附件，并总结关键数据、异常和可执行结论。";

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: true, message }, { status });
}

export async function POST(req: NextRequest) {
  const { account, response } = requireAccount(req);
  if (response) return response;
  if (!account) return errorResponse("请先登录。", 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse("附件分析请求无效。");
  }
  if (typeof body !== "object" || body === null) {
    return errorResponse("附件分析请求无效。");
  }
  const query =
    "query" in body && typeof body.query === "string" && body.query.trim()
      ? body.query.trim()
      : DEFAULT_QUERY;
  const analysisIds =
    "analysisIds" in body && Array.isArray(body.analysisIds)
      ? [
          ...new Set(
            body.analysisIds.filter(
              (value): value is string => typeof value === "string",
            ),
          ),
        ]
      : [];
  if (analysisIds.length === 0 || analysisIds.length > 4) {
    return errorResponse("附件分析请求无效。");
  }

  const sessions = analysisIds.map((analysisId) =>
    readAttachmentAnalysisSession(account.id, analysisId),
  );
  if (sessions.some((session) => !session)) {
    return errorResponse("附件分析内容已过期，请重新上传文件。", 410);
  }
  const availableSessions = sessions.filter(
    (session): session is NonNullable<typeof session> => Boolean(session),
  );
  const tableSessions = availableSessions.filter(
    (session) => session.mode === "table_analysis" && session.tableProfile,
  );
  const combinedTableSummary = buildCombinedTableSummary(
    tableSessions.map((session) => ({
      name: session.name,
      profile: session.tableProfile!,
    })),
  );

  const contexts: AttachmentContextItem[] = availableSessions.map(
    (session, sessionIndex) => {
      if (session.mode === "document_index" && session.chunks) {
        const selected = selectDocumentChunks(session.chunks, query);
        const content = [
          `[文档索引内容开始]`,
          `文件名: ${session.name}`,
          ...selected.map(
            (chunk) =>
              `[分段 ${chunk.index + 1}${
                chunk.headingHint ? ` · ${chunk.headingHint}` : ""
              }]\n${chunk.text}`,
          ),
          `[文档索引内容结束]`,
        ]
          .join("\n\n")
          .slice(0, 120_000);
        return {
          analysisId: session.id,
          name: session.name,
          mode: session.mode,
          content,
          coverage: `已从 ${session.chunks.length} 个分段中选择 ${selected.length} 个相关分段。`,
        };
      }

      if (
        session.mode === "table_analysis" &&
        session.tableProfile &&
        session.tableSheets
      ) {
        const tableContext = buildTableAnalysisContext(
          session.name,
          session.tableSheets,
          session.tableProfile,
          query,
        );
        return {
          analysisId: session.id,
          name: session.name,
          mode: session.mode,
          content:
            sessionIndex ===
              availableSessions.findIndex(
                (item) => item.mode === "table_analysis",
              ) && combinedTableSummary
              ? `${combinedTableSummary}\n\n${tableContext.content}`.slice(
                  0,
                  140_000,
                )
              : tableContext.content,
          coverage: `统计基于全部 ${session.tableProfile.rowCount.toLocaleString(
            "zh-CN",
          )} 行，并附带 ${tableContext.relevantRowCount} 行相关记录。`,
        };
      }

      throw new Error("invalid attachment analysis session");
    },
  );

  return NextResponse.json({ error: false, contexts });
}

export const runtime = "nodejs";
