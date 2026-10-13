import "server-only";
import {
  ARCHIVE_TTL_MS,
  saveAnalysisArchive,
  readAnalysisArchive,
  deleteAnalysisArchive,
} from "./attachment-analysis-archive";

import type { AttachmentKind } from "@/app/types/attachment";
import type {
  DocumentChunk,
  TableProfile,
  TableSheetData,
} from "@/app/utils/attachment-analysis";
import { getPrismaClient } from "@/app/repositories";

export type StoredAnalysisMode = "document_index" | "table_analysis";

export interface AttachmentAnalysisSession {
  id: string;
  accountId: string;
  name: string;
  kind: AttachmentKind;
  mode: StoredAnalysisMode;
  createdAt: number;
  lastAccessedAt: number;
  expiresAt: number;
  bytes: number;
  chunks?: DocumentChunk[];
  tableProfile?: TableProfile;
  tableSheets?: TableSheetData[];
}

declare global {
  var newbieAttachmentAnalysisStore:
    | Map<string, AttachmentAnalysisSession>
    | undefined;
}

const SESSION_TTL_MS = ARCHIVE_TTL_MS;
const MAX_PER_ACCOUNT = 5;
const MAX_GLOBAL = 30;
const MAX_BYTES = 256 * 1024 * 1024;

const sessions =
  globalThis.newbieAttachmentAnalysisStore ??
  new Map<string, AttachmentAnalysisSession>();
globalThis.newbieAttachmentAnalysisStore = sessions;

function removeOldest(candidates: AttachmentAnalysisSession[]) {
  const oldest = candidates.sort(
    (left, right) => left.lastAccessedAt - right.lastAccessedAt,
  )[0];
  if (oldest) sessions.delete(oldest.id);
}

function cleanup(now = Date.now()) {
  sessions.forEach((session, id) => {
    if (session.expiresAt <= now) sessions.delete(id);
  });

  const byAccount = new Map<string, AttachmentAnalysisSession[]>();
  sessions.forEach((session) => {
    byAccount.set(session.accountId, [
      ...(byAccount.get(session.accountId) ?? []),
      session,
    ]);
  });
  byAccount.forEach((accountSessions) => {
    while (accountSessions.length > MAX_PER_ACCOUNT) {
      removeOldest(accountSessions);
      accountSessions.splice(
        accountSessions.findIndex((session) => !sessions.has(session.id)),
        1,
      );
    }
  });

  while (sessions.size > MAX_GLOBAL) removeOldest([...sessions.values()]);
  let totalBytes = [...sessions.values()].reduce(
    (total, session) => total + session.bytes,
    0,
  );
  while (totalBytes > MAX_BYTES && sessions.size > 0) {
    const before = sessions.size;
    removeOldest([...sessions.values()]);
    if (sessions.size === before) break;
    totalBytes = [...sessions.values()].reduce(
      (total, session) => total + session.bytes,
      0,
    );
  }
}

export function createAttachmentAnalysisSession(
  input: Omit<
    AttachmentAnalysisSession,
    "createdAt" | "lastAccessedAt" | "expiresAt"
  >,
) {
  const now = Date.now();
  cleanup(now);
  const session: AttachmentAnalysisSession = {
    ...input,
    createdAt: now,
    lastAccessedAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  saveAnalysisArchive(session);
  sessions.set(session.id, session);
  cleanup(now);
  return session;
}

export function readAttachmentAnalysisSession(
  accountId: string,
  analysisId: string,
): AttachmentAnalysisSession | undefined {
  cleanup();
  const session =
    sessions.get(analysisId) ?? readAnalysisArchive(accountId, analysisId);
  if (session) {
    if (session.accountId !== accountId) return undefined;
    session.lastAccessedAt = Date.now();
    cleanup();
    return session;
  }
  return undefined;
}

// DB fallback（#18）：内存和本地文件都 miss 时，从 Attachment 表查询
export async function readAttachmentAnalysisSessionWithFallback(
  accountId: string,
  analysisId: string,
): Promise<AttachmentAnalysisSession | undefined> {
  const session = readAttachmentAnalysisSession(accountId, analysisId);
  if (session) return session;

  try {
    const prisma = getPrismaClient();
    const attachment = await prisma.attachment.findFirst({
      where: { storageKey: analysisId, employeeId: accountId, status: "ready" },
    });
    if (attachment) {
      // 尝试从本地磁盘归档路径恢复（storageKey 即 analysisId）
      const archived = readAnalysisArchive(accountId, attachment.storageKey);
      if (archived) {
        archived.lastAccessedAt = Date.now();
        sessions.set(archived.id, archived);
        return archived;
      }
    }
  } catch {
    // DB 不可用时静默降级，不影响现有逻辑
  }

  return undefined;
}

export function deleteAttachmentAnalysisSessions(
  accountId: string,
  analysisIds: string[],
) {
  cleanup();
  analysisIds.forEach((analysisId) => {
    deleteAnalysisArchive(accountId, analysisId);
    const session = sessions.get(analysisId);
    if (session?.accountId === accountId) sessions.delete(analysisId);
  });
  cleanup();
}

export const ATTACHMENT_ANALYSIS_TTL_MS = SESSION_TTL_MS;
