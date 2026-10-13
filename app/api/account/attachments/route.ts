import { randomUUID } from "crypto";

import mammoth from "mammoth";
import { NextRequest, NextResponse } from "next/server";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

import { requireAccount } from "@/app/config/account-auth";
import {
  createAttachmentAnalysisSession,
  deleteAttachmentAnalysisSessions,
} from "@/app/config/attachment-analysis-store";
import type {
  AttachmentKind,
  TransientChatAttachment,
} from "@/app/types/attachment";
import {
  buildDocumentChunks,
  buildTableProfile,
  estimateTableBytes,
  parseTableWorkbook,
} from "@/app/utils/attachment-analysis";

const MAX_FILE_COUNT = 4;
const MAX_TOTAL_SIZE = 50 * 1024 * 1024;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_TEXT_SIZE = 30 * 1024 * 1024;
const MAX_DOCUMENT_SIZE = 25 * 1024 * 1024;
const MAX_TEXT_CHARACTERS = 10_000_000;
const MAX_DIRECT_FILE_TEXT = 80_000;
const MAX_DIRECT_TOTAL_TEXT = 120_000;

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".log",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".html",
  ".css",
  ".xml",
  ".yaml",
  ".yml",
]);
const TABLE_EXTENSIONS = new Set([".csv", ".xls", ".xlsx"]);

const TEXT_MIME = new Set([
  "text/plain",
  "text/markdown",
  "application/json",
  "application/javascript",
  "text/javascript",
  "text/html",
  "text/css",
  "application/xml",
  "text/xml",
  "application/yaml",
  "text/yaml",
  "application/x-yaml",
]);

const DOCUMENT_MIME: Record<string, string[]> = {
  ".pdf": ["application/pdf"],
  ".docx": [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
};

const TABLE_MIME: Record<string, string[]> = {
  ".csv": ["text/csv", "application/csv", "text/plain"],
  ".xls": ["application/vnd.ms-excel"],
  ".xlsx": [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
};

class AttachmentError extends Error {}

function extensionOf(name: string) {
  return name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
}

function safeName(name: string) {
  return name.split(/[\\/]/).at(-1)?.trim() || "attachment";
}

function resolveKind(extension: string): AttachmentKind | undefined {
  if (extension in IMAGE_MIME) return "image";
  if (TABLE_EXTENSIONS.has(extension)) return "spreadsheet";
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  if (extension in DOCUMENT_MIME) return "document";
  return undefined;
}

function validMime(extension: string, mimeType: string) {
  const mime = mimeType.toLowerCase().trim();
  if (!mime || mime === "application/octet-stream") return true;
  if (extension in IMAGE_MIME) return IMAGE_MIME[extension] === mime;
  if (TEXT_EXTENSIONS.has(extension)) return TEXT_MIME.has(mime);
  if (extension in DOCUMENT_MIME)
    return DOCUMENT_MIME[extension].includes(mime);
  if (extension in TABLE_MIME) return TABLE_MIME[extension].includes(mime);
  return false;
}

function resolvedMime(extension: string, mimeType: string) {
  if (mimeType && mimeType !== "application/octet-stream") return mimeType;
  if (extension in IMAGE_MIME) return IMAGE_MIME[extension];
  if (extension in DOCUMENT_MIME) return DOCUMENT_MIME[extension][0];
  if (extension in TABLE_MIME) return TABLE_MIME[extension][0];
  return "text/plain";
}

function startsWithBytes(buffer: Buffer, bytes: number[]) {
  return bytes.every((byte, index) => buffer[index] === byte);
}

function includesAscii(buffer: Buffer, value: string) {
  return buffer.indexOf(Buffer.from(value, "utf8")) >= 0;
}

function isZip(buffer: Buffer) {
  return (
    startsWithBytes(buffer, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWithBytes(buffer, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWithBytes(buffer, [0x50, 0x4b, 0x07, 0x08])
  );
}

function decodeTextFile(buffer: Buffer) {
  if (buffer.length > 0) {
    const nulCount = buffer.reduce(
      (count, byte) => count + Number(byte === 0),
      0,
    );
    const controlCount = buffer.reduce(
      (count, byte) =>
        count +
        Number(byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d),
      0,
    );
    if (
      nulCount / buffer.length > 0.001 ||
      controlCount / buffer.length > 0.02
    ) {
      throw new AttachmentError("文件内容与扩展名不匹配。");
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new AttachmentError("文件内容无法解析。");
  }
}

function validateFileContent(extension: string, buffer: Buffer) {
  if (extension === ".png") {
    return startsWithBytes(
      buffer,
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    );
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return startsWithBytes(buffer, [0xff, 0xd8, 0xff]);
  }
  if (extension === ".webp") {
    return (
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }
  if (extension === ".pdf")
    return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if (extension === ".xls") {
    return startsWithBytes(
      buffer,
      [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
    );
  }
  if (extension === ".docx") {
    return (
      isZip(buffer) &&
      includesAscii(buffer, "[Content_Types].xml") &&
      includesAscii(buffer, "word/")
    );
  }
  if (extension === ".xlsx") {
    return (
      isZip(buffer) &&
      includesAscii(buffer, "[Content_Types].xml") &&
      includesAscii(buffer, "xl/")
    );
  }
  if (TEXT_EXTENSIONS.has(extension) || extension === ".csv") {
    decodeTextFile(buffer);
    return true;
  }
  return false;
}

function maxSizeFor(kind: AttachmentKind, extension: string) {
  if (kind === "image") return MAX_IMAGE_SIZE;
  if (kind === "text" || extension === ".csv") return MAX_TEXT_SIZE;
  return MAX_DOCUMENT_SIZE;
}

async function extractText(extension: string, buffer: Buffer) {
  if (TEXT_EXTENSIONS.has(extension)) return decodeTextFile(buffer);
  if (extension === ".pdf") return (await pdfParse(buffer)).text;
  if (extension === ".docx")
    return (await mammoth.extractRawText({ buffer })).value;
  return "";
}

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: true, message }, { status });
}

export async function POST(req: NextRequest) {
  const { account, response } = requireAccount(req);
  if (response) return response;
  if (!account) return errorResponse("请先登录。", 401);

  let formData: FormData;
  const createdAnalysisIds: string[] = [];
  try {
    formData = await req.formData();
  } catch {
    return errorResponse("文件内容无法解析。");
  }
  const files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File);
  if (files.length === 0) return errorResponse("请选择附件。");
  if (files.length > MAX_FILE_COUNT)
    return errorResponse("单次最多选择 4 个文件。");
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_SIZE) {
    return errorResponse("附件总大小超过 50 MB 限制。");
  }

  try {
    const validated = files.map((file) => {
      const name = safeName(file.name);
      const extension = extensionOf(name);
      const kind = resolveKind(extension);
      if (!kind || !validMime(extension, file.type)) {
        throw new AttachmentError("暂不支持该文件格式。");
      }
      if (file.size > maxSizeFor(kind, extension)) {
        throw new AttachmentError("文件大小超过限制。");
      }
      return { file, name, extension, kind };
    });

    let directCharacters = 0;
    const attachments: TransientChatAttachment[] = [];
    for (const item of validated) {
      const buffer = Buffer.from(await item.file.arrayBuffer());
      if (!validateFileContent(item.extension, buffer)) {
        throw new AttachmentError("文件内容与扩展名不匹配。");
      }
      const id = randomUUID();
      const mimeType = resolvedMime(item.extension, item.file.type);
      if (item.kind === "image") {
        attachments.push({
          id,
          name: item.name,
          mimeType,
          size: item.file.size,
          kind: item.kind,
          dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
        });
        continue;
      }

      if (item.kind === "spreadsheet") {
        let sheets;
        try {
          sheets = parseTableWorkbook(buffer, item.extension);
        } catch (error) {
          throw new AttachmentError(
            error instanceof Error ? error.message : "文件内容无法解析。",
          );
        }
        const profile = buildTableProfile(sheets);
        const analysisId = randomUUID();
        const session = createAttachmentAnalysisSession({
          id: analysisId,
          accountId: account.id,
          name: item.name,
          kind: item.kind,
          mode: "table_analysis",
          bytes: estimateTableBytes(sheets),
          tableProfile: profile,
          tableSheets: sheets,
        });
        if (!session)
          throw new AttachmentError("附件分析容量已满，请稍后重试。");
        createdAnalysisIds.push(analysisId);
        attachments.push({
          id,
          name: item.name,
          mimeType,
          size: item.file.size,
          kind: item.kind,
          analysisId,
          analysisMode: "table_analysis",
          analysisStatus: "indexed",
          rowCount: profile.rowCount,
          columnCount: profile.columnCount,
          sheetCount: profile.sheetCount,
          expiresAt: new Date(session.expiresAt).toISOString(),
        });
        continue;
      }

      const text = await extractText(item.extension, buffer);
      if (text.length > MAX_TEXT_CHARACTERS) {
        throw new AttachmentError(
          "文件文本内容超过当前分析上限，请拆分后重新上传。",
        );
      }
      const canUseDirect =
        text.length <= MAX_DIRECT_FILE_TEXT &&
        directCharacters + text.length <= MAX_DIRECT_TOTAL_TEXT;
      if (canUseDirect) {
        directCharacters += text.length;
        attachments.push({
          id,
          name: item.name,
          mimeType,
          size: item.file.size,
          kind: item.kind,
          text,
          truncated: false,
          analysisMode: "direct",
          analysisStatus: "ready",
        });
        continue;
      }

      const chunks = buildDocumentChunks(text);
      const analysisId = randomUUID();
      const session = createAttachmentAnalysisSession({
        id: analysisId,
        accountId: account.id,
        name: item.name,
        kind: item.kind,
        mode: "document_index",
        bytes: Buffer.byteLength(text, "utf8"),
        chunks,
      });
      if (!session) throw new AttachmentError("附件分析容量已满，请稍后重试。");
      createdAnalysisIds.push(analysisId);
      attachments.push({
        id,
        name: item.name,
        mimeType,
        size: item.file.size,
        kind: item.kind,
        analysisId,
        analysisMode: "document_index",
        analysisStatus: "indexed",
        chunkCount: chunks.length,
        expiresAt: new Date(session.expiresAt).toISOString(),
      });
    }

    return NextResponse.json({ error: false, attachments });
  } catch (error) {
    deleteAttachmentAnalysisSessions(account.id, createdAnalysisIds);
    return errorResponse(
      error instanceof AttachmentError ? error.message : "文件内容无法解析。",
    );
  }
}

export async function DELETE(req: NextRequest) {
  const { account, response } = requireAccount(req);
  if (response) return response;
  if (!account) return errorResponse("请先登录。", 401);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const analysisIds =
    typeof body === "object" &&
    body !== null &&
    "analysisIds" in body &&
    Array.isArray(body.analysisIds)
      ? body.analysisIds.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
  deleteAttachmentAnalysisSessions(account.id, analysisIds);
  return NextResponse.json({ error: false });
}

export const runtime = "nodejs";
