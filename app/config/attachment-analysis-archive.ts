import "server-only";
import { createHash, randomUUID } from "crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import path from "path";
import type { AttachmentAnalysisSession } from "./attachment-analysis-store";

export const ARCHIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;

export class AttachmentArchiveError extends Error {}
function isMissing(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
function removeFile(file: string) {
  try {
    unlinkSync(file);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

function directory() {
  return path.join(
    path.dirname(
      process.env.NEWBIE_ADMIN_CONFIG_PATH ||
        path.join(process.cwd(), ".data", "newbiechat-admin.json"),
    ),
    "attachment-analysis",
  );
}

function filename(accountId: string, id: string) {
  const key = createHash("sha256")
    .update(JSON.stringify([accountId, id]))
    .digest("hex");
  return path.join(directory(), `${key}.json`);
}

export function saveAnalysisArchive(session: AttachmentAnalysisSession) {
  const root = directory();
  mkdirSync(root, { recursive: true });
  let total = 0;
  for (const name of readdirSync(root)) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const file = path.join(root, name);
    try {
      const stat = statSync(file);
      if (!stat.isFile()) continue;
      if (Date.now() - stat.mtimeMs >= ARCHIVE_TTL_MS) removeFile(file);
      else total += stat.size;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  const content = JSON.stringify(session);
  if (total + Buffer.byteLength(content) > MAX_ARCHIVE_BYTES)
    throw new Error("文档存储空间已满，请联系管理员清理过期数据。");
  const file = filename(session.accountId, session.id);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, file);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function readAnalysisArchive(
  accountId: string,
  id: string,
): AttachmentAnalysisSession | undefined {
  const file = filename(accountId, id);
  let stored: unknown;
  try {
    stored = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (isMissing(error)) return;
    throw new AttachmentArchiveError(
      "文档索引无法读取，请重新上传文件或联系管理员。",
    );
  }
  if (
    typeof stored !== "object" ||
    stored === null ||
    !("mode" in stored) ||
    (stored.mode !== "document_index" && stored.mode !== "table_analysis")
  )
    throw new AttachmentArchiveError("文档索引格式无效，请重新上传文件。");
  const session = stored as AttachmentAnalysisSession;
  if (session.accountId !== accountId || session.id !== id) return;
  if (!Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) {
    removeFile(file);
    return;
  }
  if (
    typeof session.name !== "string" ||
    (session.mode === "document_index" &&
      (!Array.isArray(session.chunks) ||
        session.chunks.some(
          (chunk) =>
            !chunk ||
            typeof chunk.text !== "string" ||
            typeof chunk.searchableText !== "string",
        ))) ||
    (session.mode === "table_analysis" &&
      (!Array.isArray(session.tableSheets) ||
        !session.tableProfile ||
        !Array.isArray(session.tableProfile.columns)))
  )
    throw new AttachmentArchiveError("文档索引内容不完整，请重新上传文件。");
  return session;
}

export function deleteAnalysisArchive(accountId: string, id: string) {
  const file = filename(accountId, id);
  removeFile(file);
}
