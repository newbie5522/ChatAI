/**
 * V2 数据模型类型定义
 * 
 * 这些类型与 Prisma schema 保持一致，用于应用层
 */

// ============================================================================
// 核心实体类型
// ============================================================================

export interface Employee {
  id: string;
  name: string;
  role: "user" | "admin" | "super-admin";
  createdAt: Date;
  updatedAt: Date;
}

export interface Conversation {
  id: string;
  employeeId: string;
  topic: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface Message {
  id: string;
  conversationId: string;
  employeeId: string;
  role: "user" | "assistant" | "system";
  createdAt: Date;
  deletedAt: Date | null;
  parts: MessagePart[];
}

export interface MessagePart {
  id: string;
  messageId: string;
  type: "text" | "image_url" | "audio_url" | "tool_call" | "tool_result";
  content: string; // JSON string
  order: number;
  createdAt: Date;
}

export interface ResponseRun {
  id: string;
  messageId: string;
  branchId: string | null;
  providerId: string;
  modelId: string;
  status: "pending" | "streaming" | "completed" | "failed" | "aborted";
  startedAt: Date;
  completedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface Branch {
  id: string;
  conversationId: string;
  parentMessageId: string | null;
  name: string | null;
  createdAt: Date;
}

export interface ToolCall {
  id: string;
  responseRunId: string;
  name: string;
  arguments: string; // JSON string
  result: string | null; // JSON string
  status: "pending" | "completed" | "failed";
  createdAt: Date;
  completedAt: Date | null;
}

export interface UsageRecord {
  id: string;
  employeeId: string;
  responseRunId: string | null;
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number;
  costAmount: number; // 单位：元
  createdAt: Date;
}

export interface QuotaRecord {
  id: string;
  employeeId: string;
  type: "reserve" | "confirm" | "release";
  amount: number;
  balance: number;
  referenceId: string | null;
  createdAt: Date;
}

// ============================================================================
// MessagePart 内容类型（content 字段的 JSON 结构）
// ============================================================================

export interface TextPartContent {
  text: string;
}

export interface ImageUrlPartContent {
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
}

export interface AudioUrlPartContent {
  audio_url: string;
}

export interface ToolCallPartContent {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResultPartContent {
  tool_call_id: string;
  content: string;
}

export type MessagePartContent =
  | TextPartContent
  | ImageUrlPartContent
  | AudioUrlPartContent
  | ToolCallPartContent
  | ToolResultPartContent;

// ============================================================================
// 创建/更新输入类型
// ============================================================================

export interface CreateConversationInput {
  employeeId: string;
  topic: string;
}

export interface CreateMessageInput {
  conversationId: string;
  employeeId: string;
  role: "user" | "assistant" | "system";
  parts: {
    type: MessagePart["type"];
    content: string;
    order: number;
  }[];
}

export interface CreateResponseRunInput {
  messageId: string;
  branchId?: string;
  providerId: string;
  modelId: string;
}

export interface UpdateResponseRunInput {
  status?: ResponseRun["status"];
  completedAt?: Date;
  errorCode?: string;
  errorMessage?: string;
}

export interface CreateUsageRecordInput {
  employeeId: string;
  responseRunId?: string;
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  costAmount: number;
}

export interface ReserveQuotaInput {
  employeeId: string;
  amount: number;
  referenceId: string;
}

export interface ConfirmQuotaInput {
  employeeId: string;
  amount: number;
  referenceId: string;
}

export interface ReleaseQuotaInput {
  employeeId: string;
  amount: number;
  referenceId: string;
}

// ============================================================================
// 查询过滤类型
// ============================================================================

export interface ConversationFilter {
  employeeId: string;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}

export interface MessageFilter {
  conversationId: string;
  employeeId: string;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}

export interface UsageRecordFilter {
  employeeId: string;
  startDate?: Date;
  endDate?: Date;
  providerId?: string;
  modelId?: string;
  limit?: number;
  offset?: number;
}
