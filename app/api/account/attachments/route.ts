import { randomUUID } from "crypto";

import mammoth from "mammoth";
import { NextRequest, NextResponse } from "next/server";
import pdfParse from "pdf-parse";
import * as XLSX from "xlsx";

import { requireAccount } from "@/app/config/account-auth";
import type {
  AttachmentKind,
  TransientChatAttachment,
} from "@/app/types/attachment";
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

class AttachmentError extends Error {}

function extensionOf(name: string) {
  return name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
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
  if (extension in DOCUMENT_MIME)
    return DOCUMENT_MIME[extension].includes(mime);
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
  if (extension === ".pdf") {
    return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  }
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
  if (TEXT_EXTENSIONS.has(extension)) {
    decodeTextFile(buffer);
    return true;
  }
  return false;
}

function truncateText(text: string, limit: number) {
  if (text.length <= limit) return { text, truncated: false };
  if (limit <= 0) return { text: "", truncated: true };
  const suffix = `\n${ATTACHMENT_TRUNCATION_MARKER}`;
  if (suffix.length >= limit) {
    return {
      text: ATTACHMENT_TRUNCATION_MARKER.slice(0, limit),
      truncated: true,
    };
  }
  return {
    text: `${text.slice(0, limit - suffix.length)}${suffix}`,
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
  if (TEXT_EXTENSIONS.has(extension)) return decodeTextFile(buffer);
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
    return errorResponse("文件内容无法解析。");
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
    return errorResponse("附件总大小超过限制。");
  }

  try {
    const validated = files.map((file) => {
      const name = safeName(file.name);
      const extension = extensionOf(name);
      const kind = resolveKind(extension);
      if (!kind || !validMime(extension, file.type)) {
        throw new AttachmentError("暂不支持该文件格式。");
      }
      if (file.size > MAX_FILE_SIZE) {
        throw new AttachmentError("文件大小超过限制。");
      }
      return { file, name, extension, kind };
    });

    let extractedCharacters = 0;
    const attachments: TransientChatAttachment[] = [];

    for (const item of validated) {
      const buffer = Buffer.from(await item.file.arrayBuffer());
      if (!validateFileContent(item.extension, buffer)) {
        throw new AttachmentError("文件内容与扩展名不匹配。");
      }

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
      error instanceof AttachmentError ? error.message : "文件内容无法解析。",
    );
  }
}

export const runtime = "nodejs";
