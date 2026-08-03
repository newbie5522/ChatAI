import "server-only";

import type { AttachmentKind } from "@/app/types/attachment";
import type {
  DocumentChunk,
  TableProfile,
  TableSheetData,
} from "@/app/utils/attachment-analysis";

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

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
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
  sessions.set(session.id, session);
  cleanup(now);
  return sessions.get(session.id);
}

export function readAttachmentAnalysisSession(
  accountId: string,
  analysisId: string,
) {
  cleanup();
  const session = sessions.get(analysisId);
  if (!session || session.accountId !== accountId) return undefined;
  session.lastAccessedAt = Date.now();
  cleanup();
  return sessions.get(analysisId);
}

export function deleteAttachmentAnalysisSessions(
  accountId: string,
  analysisIds: string[],
) {
  cleanup();
  analysisIds.forEach((analysisId) => {
    const session = sessions.get(analysisId);
    if (session?.accountId === accountId) sessions.delete(analysisId);
  });
  cleanup();
}

export const ATTACHMENT_ANALYSIS_TTL_MS = SESSION_TTL_MS;
