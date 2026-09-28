/**
 * V2 数据仓储层
 * 封装 Prisma 操作，提供类型安全的数据访问接口
 */

import { PrismaClient } from '@prisma/client';
import type {
  Conversation,
  Message,
  Run,
  Attachment,
  Artifact,
  Usage,
} from '../types/v2-models';

export class ConversationRepository {
  constructor(private prisma: PrismaClient) {}

  async create(data: {
    employeeId: string;
    topic: string;
  }): Promise<Conversation> {
    return this.prisma.conversation.create({
      data,
    });
  }

  async findById(id: string): Promise<Conversation | null> {
    return this.prisma.conversation.findUnique({
      where: { id },
    });
  }

  async findByEmployeeId(employeeId: string): Promise<Conversation[]> {
    return this.prisma.conversation.findMany({
      where: {
        employeeId,
        deletedAt: null,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async update(id: string, data: { topic?: string }): Promise<Conversation> {
    return this.prisma.conversation.update({
      where: { id },
      data,
    });
  }

  async softDelete(id: string): Promise<Conversation> {
    return this.prisma.conversation.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}

export class MessageRepository {
  constructor(private prisma: PrismaClient) {}

  async create(data: {
    conversationId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    contentType?: 'text' | 'multimodal';
    parentId?: string;
  }): Promise<Message> {
    return this.prisma.message.create({
      data: {
        ...data,
        contentType: data.contentType || 'text',
      },
    });
  }

  async findById(id: string): Promise<Message | null> {
    return this.prisma.message.findUnique({
      where: { id },
    });
  }

  async findByConversationId(conversationId: string): Promise<Message[]> {
    return this.prisma.message.findMany({
      where: {
        conversationId,
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
      include: {
        runs: true,
        attachments: {
          include: {
            artifact: true,
          },
        },
      },
    });
  }

  async findChildren(parentId: string): Promise<Message[]> {
    return this.prisma.message.findMany({
      where: {
        parentId,
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async softDelete(id: string): Promise<Message> {
    return this.prisma.message.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}

export class RunRepository {
  constructor(private prisma: PrismaClient) {}

  async create(data: {
    messageId: string;
    requestId: string;
    model: string;
    providerName: string;
  }): Promise<Run> {
    return this.prisma.run.create({
      data: {
        ...data,
        status: 'pending',
      },
    });
  }

  async findById(id: string): Promise<Run | null> {
    return this.prisma.run.findUnique({
      where: { id },
    });
  }

  async findByRequestId(requestId: string): Promise<Run | null> {
    return this.prisma.run.findUnique({
      where: { requestId },
    });
  }

  async updateStatus(
    id: string,
    status: 'running' | 'completed' | 'failed' | 'cancelled',
    error?: { code: string; message: string },
  ): Promise<Run> {
    return this.prisma.run.update({
      where: { id },
      data: {
        status,
        completedAt: status === 'completed' || status === 'failed' || status === 'cancelled'
          ? new Date()
          : undefined,
        errorCode: error?.code,
        errorMessage: error?.message,
      },
    });
  }

  async findByMessageId(messageId: string): Promise<Run[]> {
    return this.prisma.run.findMany({
      where: { messageId },
      orderBy: { startedAt: 'desc' },
    });
  }
}

export class ArtifactRepository {
  constructor(private prisma: PrismaClient) {}

  async create(data: {
    storageKey: string;
    mimeType: string;
    size: number;
    checksum?: string;
  }): Promise<Artifact> {
    return this.prisma.artifact.create({
      data,
    });
  }

  async findById(id: string): Promise<Artifact | null> {
    return this.prisma.artifact.findUnique({
      where: { id },
    });
  }

  async findByStorageKey(storageKey: string): Promise<Artifact | null> {
    return this.prisma.artifact.findUnique({
      where: { storageKey },
    });
  }
}

export class AttachmentRepository {
  constructor(private prisma: PrismaClient) {}

  async create(data: {
    messageId: string;
    kind: 'upload' | 'image' | 'video' | 'audio';
    artifactId: string;
    name?: string;
    metadata?: Record<string, any>;
  }): Promise<Attachment> {
    return this.prisma.attachment.create({
      data,
    });
  }

  async findByMessageId(messageId: string): Promise<Attachment[]> {
    return this.prisma.attachment.findMany({
      where: { messageId },
      include: {
        artifact: true,
      },
    });
  }
}

export class UsageRepository {
  constructor(private prisma: PrismaClient) {}

  async create(data: {
    runId: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost: number;
  }): Promise<Usage> {
    return this.prisma.usage.create({
      data,
    });
  }

  async findByRunId(runId: string): Promise<Usage | null> {
    return this.prisma.usage.findUnique({
      where: { runId },
    });
  }

  async sumByEmployeeId(
    employeeId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{ totalTokens: number; totalCost: number }> {
    const result = await this.prisma.usage.aggregate({
      where: {
        run: {
          message: {
            conversation: {
              employeeId,
            },
          },
        },
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      _sum: {
        totalTokens: true,
        cost: true,
      },
    });

    return {
      totalTokens: result._sum.totalTokens || 0,
      totalCost: Number(result._sum.cost || 0),
    };
  }
}
