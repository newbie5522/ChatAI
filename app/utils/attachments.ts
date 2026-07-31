import type { ChatAttachment } from "../types/attachment";

export const ATTACHMENT_TRUNCATION_MARKER = "内容已截断。";

export function buildAttachmentContext(attachments: ChatAttachment[]) {
  return attachments
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

export function formatAttachmentSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
