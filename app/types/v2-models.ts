/**
 * V2 数据模型类型定义
 * 直接复用 Prisma 生成的类型，避免手写类型与 schema 脱节
 * （曾出现手写 role: string 与 Prisma enum 类型不兼容导致构建失败，
 *   故改为从 @prisma/client 派生，schema 是唯一事实源）
 */

import type {
  Conversation as PrismaConversation,
  Message as PrismaMessage,
  Run as PrismaRun,
  Attachment as PrismaAttachment,
  Artifact as PrismaArtifact,
  Usage as PrismaUsage,
  MessageRole,
  MessageContentType,
  RunStatus,
  AttachmentKind,
} from '@prisma/client';

export type { MessageRole, MessageContentType, RunStatus, AttachmentKind };

export type Conversation = PrismaConversation;
export type Message = PrismaMessage;
export type Run = PrismaRun;
export type Attachment = PrismaAttachment;
export type Artifact = PrismaArtifact;
export type Usage = PrismaUsage;

// 前端扩展类型：包含关联数据的完整消息
export interface MessageWithRuns extends Message {
  runs: Run[];
  attachments: Attachment[];
}

export interface ConversationWithMessages extends Conversation {
  messages: MessageWithRuns[];
}
