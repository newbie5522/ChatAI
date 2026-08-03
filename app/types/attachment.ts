export type AttachmentKind = "image" | "text" | "document" | "spreadsheet";
export type AttachmentAnalysisMode =
  | "direct"
  | "document_index"
  | "table_analysis";
export type AttachmentAnalysisStatus = "ready" | "indexed";

export interface StoredAttachmentMetadata {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: AttachmentKind;
  truncated?: boolean;
  analysisMode?: AttachmentAnalysisMode;
  rowCount?: number;
  columnCount?: number;
  sheetCount?: number;
  chunkCount?: number;
}

export interface TransientChatAttachment extends StoredAttachmentMetadata {
  text?: string;
  dataUrl?: string;
  analysisId?: string;
  analysisStatus?: AttachmentAnalysisStatus;
  expiresAt?: string;
}

export interface AttachmentUploadResponse {
  error: boolean;
  message?: string;
  attachments?: TransientChatAttachment[];
}

export interface AttachmentContextItem {
  analysisId: string;
  name: string;
  mode: Exclude<AttachmentAnalysisMode, "direct">;
  content: string;
  coverage: string;
}

export interface AttachmentContextResponse {
  error: boolean;
  message?: string;
  contexts?: AttachmentContextItem[];
}
