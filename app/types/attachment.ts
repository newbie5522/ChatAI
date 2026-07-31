export type AttachmentKind = "image" | "text" | "document" | "spreadsheet";

export interface ChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: AttachmentKind;
  text?: string;
  dataUrl?: string;
  truncated?: boolean;
}

export interface AttachmentUploadResponse {
  error: boolean;
  message?: string;
  attachments?: ChatAttachment[];
}
