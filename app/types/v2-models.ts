/**
 * V2 数据模型类型定义
 * 对应 Prisma schema，提供前端类型安全
 */

export type ConversationStatus = "active" | "archived" | "deleted";

export interface Conversation {
  id: string;
  employeeId: string;
  topic: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

export type MessageRole = "user" | "assistant" | "system";
export type MessageContentType = "text" | "multimodal";

export interface Message {
  id: string;
  conversationId: string;
  parentId?: string | null;
  role: MessageRole;
  content: string;
  contentType: MessageContentType;
  createdAt: Date;
  deletedAt?: Date | null;
}

export type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface Run {
  id: string;
  messageId: string;
  requestId: string;
  status: RunStatus;
  model: string;
  providerName: string;
  startedAt: Date;
  completedAt?: Date | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export type AttachmentKind = "upload" | "image" | "video" | "audio";

export interface Attachment {
  id: string;
  messageId: string;
  kind: AttachmentKind;
  artifactId: string;
  name?: string | null;
  metadata?: Record<string, any> | null;
  createdAt: Date;
}

export interface Artifact {
  id: string;
  storageKey: string;
  mimeType: string;
  size: number;
  checksum?: string | null;
  createdAt: Date;
}

export interface Usage {
  id: string;
  runId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  createdAt: Date;
}

// 前端扩展类型：包含关联数据的完整消息
export interface MessageWithRuns extends Message {
  runs: Run[];
  attachments: Attachment[];
}

export interface ConversationWithMessages extends Conversation {
  messages: MessageWithRuns[];
}
