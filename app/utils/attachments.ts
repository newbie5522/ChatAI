import type {
  StoredAttachmentMetadata,
  TransientChatAttachment,
} from "../types/attachment";

export function buildAttachmentContext(attachments: TransientChatAttachment[]) {
  return attachments
    .filter((attachment) => !attachment.analysisId)
    .map(
      (attachment) =>
        `[附件开始]\n文件名：${attachment.name}\n文件类型：${
          attachment.mimeType
        }\n内容：\n${
          attachment.text ??
          (attachment.kind === "image" ? "图片附件，无文本内容。" : "")
        }\n[附件结束]`,
    )
    .join("\n\n");
}

export function toStoredAttachmentMetadata(
  attachment: TransientChatAttachment,
): StoredAttachmentMetadata {
  const {
    id,
    name,
    mimeType,
    size,
    kind,
    truncated,
    analysisMode,
    rowCount,
    columnCount,
    sheetCount,
    chunkCount,
    mediaId,
    width,
    height,
    previewAvailable,
  } = attachment;
  return {
    id,
    name,
    mimeType,
    size,
    kind,
    truncated,
    analysisMode,
    rowCount,
    columnCount,
    sheetCount,
    chunkCount,
    mediaId,
    width,
    height,
    previewAvailable,
  };
}

export function formatAttachmentSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
