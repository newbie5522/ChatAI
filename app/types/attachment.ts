export type AttachmentKind = "image" | "text" | "document" | "spreadsheet";

export interface StoredAttachmentMetadata {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: AttachmentKind;
  truncated?: boolean;
}

export interface TransientChatAttachment extends StoredAttachmentMetadata {
  text?: string;
  dataUrl?: string;
}

export interface AttachmentUploadResponse {
  error: boolean;
  message?: string;
  attachments?: TransientChatAttachment[];
}
