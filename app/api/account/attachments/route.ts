import { randomUUID } from "crypto";

import mammoth from "mammoth";
import { NextRequest, NextResponse } from "next/server";
import pdfParse from "pdf-parse";
import * as XLSX from "xlsx";

import { requireAccount } from "@/app/config/account-auth";
import type { AttachmentKind, ChatAttachment } from "@/app/types/attachment";
import { ATTACHMENT_TRUNCATION_MARKER } from "@/app/utils/attachments";

const MAX_FILE_COUNT = 4;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_SIZE = 20 * 1024 * 1024;
const MAX_FILE_TEXT = 50_000;
const MAX_TOTAL_TEXT = 100_000;

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".csv",
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

const TEXT_MIME = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/csv",
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

const SPREADSHEET_MIME: Record<string, string[]> = {
  ".xls": ["application/vnd.ms-excel"],
  ".xlsx": [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
};

function extensionOf(name: string) {
  const match = name.toLowerCase().match(/\.[^.]+$/);
  return match?.[0] ?? "";
}

function safeName(name: string) {
  return name.split(/[\\/]/).at(-1)?.trim() || "attachment";
}

function resolveKind(extension: string): AttachmentKind | undefined {
  if (extension in IMAGE_MIME) return "image";
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  if (extension in DOCUMENT_MIME) return "document";
  if (extension in SPREADSHEET_MIME) return "spreadsheet";
  return undefined;
}

function validMime(extension: string, mimeType: string) {
  const mime = mimeType.toLowerCase().trim();
  if (!mime || mime === "application/octet-stream") return true;
  if (extension in IMAGE_MIME) return IMAGE_MIME[extension] === mime;
  if (TEXT_EXTENSIONS.has(extension)) return TEXT_MIME.has(mime);
  if (extension in DOCUMENT_MIME) {
    return DOCUMENT_MIME[extension].includes(mime);
  }
  if (extension in SPREADSHEET_MIME) {
    return SPREADSHEET_MIME[extension].includes(mime);
  }
  return false;
}

function resolvedMime(extension: string, mimeType: string) {
  if (mimeType && mimeType !== "application/octet-stream") return mimeType;
  if (extension in IMAGE_MIME) return IMAGE_MIME[extension];
  if (extension in DOCUMENT_MIME) return DOCUMENT_MIME[extension][0];
  if (extension in SPREADSHEET_MIME) return SPREADSHEET_MIME[extension][0];
  return "text/plain";
}

function truncateText(text: string, limit: number) {
  if (text.length <= limit) return { text, truncated: false };
  const suffix = `\n${ATTACHMENT_TRUNCATION_MARKER}`;
  return {
    text: `${text.slice(0, Math.max(0, limit - suffix.length))}${suffix}`,
    truncated: true,
  };
}

function spreadsheetText(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    return `工作表：${name}\n${XLSX.utils.sheet_to_csv(sheet, {
      blankrows: false,
    })}`;
  }).join("\n\n");
}

async function extractText(extension: string, buffer: Buffer) {
  if (TEXT_EXTENSIONS.has(extension)) return buffer.toString("utf8");
  if (extension === ".pdf") return (await pdfParse(buffer)).text;
  if (extension === ".docx") {
    return (await mammoth.extractRawText({ buffer })).value;
  }
  if (extension === ".xls" || extension === ".xlsx") {
    return spreadsheetText(buffer);
  }
  return "";
}

function errorResponse(message: string) {
  return NextResponse.json({ error: true, message }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const { account, response } = requireAccount(req);
  if (response) return response;
  if (!account) {
    return NextResponse.json(
      { error: true, message: "请先登录。" },
      { status: 401 },
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return errorResponse("附件上传请求格式无效。");
  }

  const files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File);
  if (files.length === 0) return errorResponse("请选择附件。");
  if (files.length > MAX_FILE_COUNT) {
    return errorResponse("单次最多选择 4 个文件。");
  }

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > MAX_TOTAL_SIZE) {
    return errorResponse("单次附件总大小不能超过 20 MB。");
  }

  try {
    const validated = files.map((file) => {
      const name = safeName(file.name);
      const extension = extensionOf(name);
      const kind = resolveKind(extension);
      if (!kind || !validMime(extension, file.type)) {
        throw new Error("暂不支持该文件格式。");
      }
      if (file.size > MAX_FILE_SIZE) {
        throw new Error(`文件“${name}”不能超过 10 MB。`);
      }
      return { file, name, extension, kind };
    });

    let extractedCharacters = 0;
    const attachments: ChatAttachment[] = [];

    for (const item of validated) {
      const buffer = Buffer.from(await item.file.arrayBuffer());
      const mimeType = resolvedMime(item.extension, item.file.type);
      if (item.kind === "image") {
        attachments.push({
          id: randomUUID(),
          name: item.name,
          mimeType,
          size: item.file.size,
          kind: item.kind,
          dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
        });
        continue;
      }

      const perFile = truncateText(
        await extractText(item.extension, buffer),
        MAX_FILE_TEXT,
      );
      const remaining = Math.max(0, MAX_TOTAL_TEXT - extractedCharacters);
      const totalLimited = truncateText(perFile.text, remaining);
      extractedCharacters += totalLimited.text.length;
      attachments.push({
        id: randomUUID(),
        name: item.name,
        mimeType,
        size: item.file.size,
        kind: item.kind,
        text: totalLimited.text,
        truncated: perFile.truncated || totalLimited.truncated,
      });
    }

    return NextResponse.json({ error: false, attachments });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "附件解析失败。",
    );
  }
}

export const runtime = "nodejs";
