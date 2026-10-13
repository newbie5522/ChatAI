/**
 * V2 数据访问层 - Repository 模式
 * 
 * 所有方法强制绑定 employeeId，确保租户隔离
 */

import { PrismaClient } from "@prisma/client";
import type {
  Conversation,
  Message,
  ResponseRun,
  UsageRecord,
  QuotaRecord,
  Attachment,
  MediaJob,
  MediaJobStatus,
  CreateAttachmentInput,
  CreateMediaJobInput,
  CreateConversationInput,
  CreateMessageInput,
  CreateResponseRunInput,
  UpdateResponseRunInput,
  CreateUsageRecordInput,
  ReserveQuotaInput,
  ConfirmQuotaInput,
  ReleaseQuotaInput,
  ConversationFilter,
  MessageFilter,
  UsageRecordFilter,
} from "../types/v2-models";

// 全局 Prisma 实例（单例）
let prisma: PrismaClient | null = null;

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

// ============================================================================
// ConversationRepository
// ============================================================================

export class ConversationRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * 创建对话（必须绑定 employeeId）
   */
  async create(input: CreateConversationInput): Promise<Conversation> {
    return this.prisma.conversation.create({
      data: {
        employeeId: input.employeeId,
        topic: input.topic,
      },
    });
  }

  /**
   * 查询对话列表（强制租户隔离）
   */
  async findMany(filter: ConversationFilter): Promise<Conversation[]> {
    return this.prisma.conversation.findMany({
      where: {
        employeeId: filter.employeeId,
        deletedAt: filter.includeDeleted ? undefined : null,
      },
      orderBy: { updatedAt: "desc" },
      take: filter.limit,
      skip: filter.offset,
    });
  }

  /**
   * 按 ID 查询对话（强制租户隔离）
   */
  async findById(
    conversationId: string,
    employeeId: string,
  ): Promise<Conversation | null> {
    return this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        employeeId: employeeId,
      },
    });
  }

  /**
   * 软删除对话
   */
  async softDelete(
    conversationId: string,
    employeeId: string,
  ): Promise<Conversation> {
    // 先验证所有权
    const conversation = await this.findById(conversationId, employeeId);
    if (!conversation) {
      throw new Error("Conversation not found or access denied");
    }

    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * 更新对话主题
   */
  async updateTopic(
    conversationId: string,
    employeeId: string,
    topic: string,
  ): Promise<Conversation> {
    // 先验证所有权
    const conversation = await this.findById(conversationId, employeeId);
    if (!conversation) {
      throw new Error("Conversation not found or access denied");
    }

    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { topic },
    });
  }
}

// ============================================================================
// MessageRepository
// ============================================================================

export class MessageRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * 创建消息（带 MessagePart）
   */
  async create(input: CreateMessageInput): Promise<Message> {
    return this.prisma.message.create({
      data: {
        conversationId: input.conversationId,
        employeeId: input.employeeId,
        role: input.role,
        parts: {
          create: input.parts,
        },
      },
      include: {
        parts: true,
      },
    }) as Promise<Message>;
  }

  /**
   * 查询消息列表（强制租户隔离）
   */
  async findMany(filter: MessageFilter): Promise<Message[]> {
    return this.prisma.message.findMany({
      where: {
        conversationId: filter.conversationId,
        employeeId: filter.employeeId,
        deletedAt: filter.includeDeleted ? undefined : null,
      },
      include: {
        parts: {
          orderBy: { order: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
      take: filter.limit,
      skip: filter.offset,
    }) as Promise<Message[]>;
  }

  /**
   * 按 ID 查询消息（强制租户隔离）
   */
  async findById(
    messageId: string,
    employeeId: string,
  ): Promise<Message | null> {
    return this.prisma.message.findFirst({
      where: {
        id: messageId,
        employeeId: employeeId,
      },
      include: {
        parts: {
          orderBy: { order: "asc" },
        },
      },
    }) as Promise<Message | null>;
  }

  /**
   * 软删除消息
   */
  async softDelete(messageId: string, employeeId: string): Promise<Message> {
    // 先验证所有权
    const message = await this.findById(messageId, employeeId);
    if (!message) {
      throw new Error("Message not found or access denied");
    }

    return this.prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
      include: {
        parts: true,
      },
    }) as Promise<Message>;
  }
}

// ============================================================================
// ResponseRunRepository
// ============================================================================

export class ResponseRunRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * 创建 ResponseRun
   */
  async create(input: CreateResponseRunInput): Promise<ResponseRun> {
    return this.prisma.responseRun.create({
      data: {
        messageId: input.messageId,
        branchId: input.branchId,
        providerId: input.providerId,
        modelId: input.modelId,
        status: "pending",
      },
    }) as Promise<ResponseRun>;
  }

  /**
   * 更新 ResponseRun 状态
   */
  async update(
    responseRunId: string,
    input: UpdateResponseRunInput,
  ): Promise<ResponseRun> {
    return this.prisma.responseRun.update({
      where: { id: responseRunId },
      data: input,
    }) as Promise<ResponseRun>;
  }

  /**
   * 按 ID 查询 ResponseRun
   */
  async findById(responseRunId: string): Promise<ResponseRun | null> {
    return this.prisma.responseRun.findUnique({
      where: { id: responseRunId },
    }) as Promise<ResponseRun | null>;
  }
}

// ============================================================================
// UsageRecordRepository
// ============================================================================

export class UsageRecordRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * 创建用量记录
   */
  async create(input: CreateUsageRecordInput): Promise<UsageRecord> {
    return this.prisma.usageRecord.create({
      data: {
        employeeId: input.employeeId,
        responseRunId: input.responseRunId,
        providerId: input.providerId,
        modelId: input.modelId,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        totalTokens: input.totalTokens,
        cachedTokens: input.cachedTokens ?? 0,
        costAmount: input.costAmount,
      },
    });
  }

  /**
   * 查询用量记录（强制租户隔离）
   */
  async findMany(filter: UsageRecordFilter): Promise<UsageRecord[]> {
    return this.prisma.usageRecord.findMany({
      where: {
        employeeId: filter.employeeId,
        createdAt: {
          gte: filter.startDate,
          lte: filter.endDate,
        },
        providerId: filter.providerId,
        modelId: filter.modelId,
      },
      orderBy: { createdAt: "desc" },
      take: filter.limit,
      skip: filter.offset,
    });
  }

  /**
   * 统计总用量（强制租户隔离）
   */
  async getTotalUsage(
    employeeId: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<{
    totalTokens: number;
    totalCost: number;
  }> {
    const result = await this.prisma.usageRecord.aggregate({
      where: {
        employeeId: employeeId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      _sum: {
        totalTokens: true,
        costAmount: true,
      },
    });

    return {
      totalTokens: result._sum.totalTokens ?? 0,
      totalCost: result._sum.costAmount ?? 0,
    };
  }
}

// ============================================================================
// QuotaRecordRepository（原子性额度操作）
// ============================================================================

export class QuotaRecordRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * 预留额度（原子性操作）
   */
  async reserve(input: ReserveQuotaInput): Promise<QuotaRecord> {
    return this.prisma.$transaction(async (tx) => {
      // 查询当前余额
      const lastRecord = await tx.quotaRecord.findFirst({
        where: { employeeId: input.employeeId },
        orderBy: { createdAt: "desc" },
      });

      const currentBalance = lastRecord?.balance ?? 0;

      // 检查余额是否足够
      if (currentBalance < input.amount) {
        throw new Error("Insufficient quota");
      }

      // 检查是否重复预留（幂等性）
      const existing = await tx.quotaRecord.findFirst({
        where: {
          employeeId: input.employeeId,
          referenceId: input.referenceId,
          type: "reserve",
        },
      });

      if (existing) {
        return existing as QuotaRecord;
      }

      // 创建预留记录
      return tx.quotaRecord.create({
        data: {
          employeeId: input.employeeId,
          type: "reserve",
          amount: -input.amount,
          balance: currentBalance - input.amount,
          referenceId: input.referenceId,
        },
      }) as Promise<QuotaRecord>;
    });
  }

  /**
   * 确认额度（已预留的额度转为已使用）
   */
  async confirm(input: ConfirmQuotaInput): Promise<QuotaRecord> {
    return this.prisma.$transaction(async (tx) => {
      // 检查是否已确认（幂等性）
      const existing = await tx.quotaRecord.findFirst({
        where: {
          employeeId: input.employeeId,
          referenceId: input.referenceId,
          type: "confirm",
        },
      });

      if (existing) {
        return existing as QuotaRecord;
      }

      // 查询当前余额
      const lastRecord = await tx.quotaRecord.findFirst({
        where: { employeeId: input.employeeId },
        orderBy: { createdAt: "desc" },
      });

      const currentBalance = lastRecord?.balance ?? 0;

      // 创建确认记录（余额不变，因为已在 reserve 时扣除）
      return tx.quotaRecord.create({
        data: {
          employeeId: input.employeeId,
          type: "confirm",
          amount: 0,
          balance: currentBalance,
          referenceId: input.referenceId,
        },
      }) as Promise<QuotaRecord>;
    });
  }

  /**
   * 释放额度（取消预留）
   */
  async release(input: ReleaseQuotaInput): Promise<QuotaRecord> {
    return this.prisma.$transaction(async (tx) => {
      // 检查是否已释放（幂等性）
      const existing = await tx.quotaRecord.findFirst({
        where: {
          employeeId: input.employeeId,
          referenceId: input.referenceId,
          type: "release",
        },
      });

      if (existing) {
        return existing as QuotaRecord;
      }

      // 查询当前余额
      const lastRecord = await tx.quotaRecord.findFirst({
        where: { employeeId: input.employeeId },
        orderBy: { createdAt: "desc" },
      });

      const currentBalance = lastRecord?.balance ?? 0;

      // 创建释放记录
      return tx.quotaRecord.create({
        data: {
          employeeId: input.employeeId,
          type: "release",
          amount: input.amount,
          balance: currentBalance + input.amount,
          referenceId: input.referenceId,
        },
      }) as Promise<QuotaRecord>;
    });
  }

  /**
   * 查询当前余额（强制租户隔离）
   */
  async getCurrentBalance(employeeId: string): Promise<number> {
    const lastRecord = await this.prisma.quotaRecord.findFirst({
      where: { employeeId: employeeId },
      orderBy: { createdAt: "desc" },
    });

    return lastRecord?.balance ?? 0;
  }
}

// ============================================================================
// AttachmentRepository（Issue #18：持久化附件管线）
// ============================================================================

export class AttachmentRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * 创建附件记录
   */
  async create(input: CreateAttachmentInput): Promise<Attachment> {
    return this.prisma.attachment.create({
      data: {
        employeeId: input.employeeId,
        name: input.name,
        mimeType: input.mimeType,
        size: input.size,
        kind: input.kind,
        storageKey: input.storageKey,
        status: "ready",
        expiresAt: input.expiresAt,
      },
    }) as Promise<Attachment>;
  }

  /**
   * 更新附件状态
   */
  async updateStatus(
    id: string,
    status: "pending" | "processing" | "ready" | "failed",
    errorMessage?: string,
  ): Promise<Attachment> {
    return this.prisma.attachment.update({
      where: { id },
      data: {
        status,
        errorMessage: errorMessage ?? null,
      },
    }) as Promise<Attachment>;
  }

  /**
   * 查询某员工的附件列表（强制租户隔离）
   */
  async findByEmployee(
    employeeId: string,
    limit?: number,
  ): Promise<Attachment[]> {
    return this.prisma.attachment.findMany({
      where: { employeeId },
      orderBy: { createdAt: "desc" },
      take: limit,
    }) as Promise<Attachment[]>;
  }

  /**
   * 按 ID 查询附件（强制租户隔离）
   */
  async findById(id: string, employeeId: string): Promise<Attachment | null> {
    return this.prisma.attachment.findFirst({
      where: { id, employeeId },
    }) as Promise<Attachment | null>;
  }

  /**
   * 绑定附件到消息（消息发出后绑定）
   */
  async bindToMessage(
    id: string,
    messageId: string,
    employeeId: string,
  ): Promise<Attachment> {
    // 先验证所有权
    const attachment = await this.findById(id, employeeId);
    if (!attachment) {
      throw new Error("Attachment not found or access denied");
    }

    return this.prisma.attachment.update({
      where: { id },
      data: { messageId },
    }) as Promise<Attachment>;
  }

  /**
   * 清理过期附件
   */
  async deleteExpired(): Promise<number> {
    const result = await this.prisma.attachment.deleteMany({
      where: {
        expiresAt: { lte: new Date() },
      },
    });
    return result.count;
  }
}

// ============================================================================
// MediaJobRepository（Issue #19：图片与视频异步任务系统）
// ============================================================================

export class MediaJobRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * 创建媒体生成任务
   */
  async create(input: CreateMediaJobInput): Promise<MediaJob> {
    return this.prisma.mediaJob.create({
      data: {
        employeeId: input.employeeId,
        messageId: input.messageId,
        kind: input.kind,
        prompt: input.prompt,
        modelId: input.modelId,
        providerId: input.providerId,
        status: "pending",
        expiresAt: input.expiresAt,
      },
    }) as Promise<MediaJob>;
  }

  /**
   * 更新任务状态（含可选的产物字段）
   */
  async updateStatus(
    id: string,
    status: MediaJobStatus,
    opts?: {
      storageKey?: string;
      resultUrl?: string;
      errorMessage?: string;
    },
  ): Promise<MediaJob> {
    return this.prisma.mediaJob.update({
      where: { id },
      data: {
        status,
        storageKey: opts?.storageKey ?? undefined,
        resultUrl: opts?.resultUrl ?? undefined,
        errorMessage: opts?.errorMessage ?? null,
        completedAt:
          status === "completed" || status === "failed" || status === "cancelled"
            ? new Date()
            : undefined,
      },
    }) as Promise<MediaJob>;
  }

  /**
   * 按 ID 查询任务（强制租户隔离）
   */
  async findById(id: string, employeeId: string): Promise<MediaJob | null> {
    return this.prisma.mediaJob.findFirst({
      where: { id, employeeId },
    }) as Promise<MediaJob | null>;
  }

  /**
   * 查询未完成的任务（刷新恢复用）
   */
  async findPending(employeeId: string): Promise<MediaJob[]> {
    return this.prisma.mediaJob.findMany({
      where: {
        employeeId,
        status: { in: ["pending", "processing"] },
      },
      orderBy: { createdAt: "desc" },
    }) as Promise<MediaJob[]>;
  }

  /**
   * 取消任务（强制租户隔离）
   */
  async cancel(id: string, employeeId: string): Promise<MediaJob> {
    const job = await this.findById(id, employeeId);
    if (!job) {
      throw new Error("MediaJob not found or access denied");
    }
    if (job.status === "completed" || job.status === "failed") {
      throw new Error("Cannot cancel a finished job");
    }
    return this.prisma.mediaJob.update({
      where: { id },
      data: {
        status: "cancelled",
        completedAt: new Date(),
      },
    }) as Promise<MediaJob>;
  }
}

// ============================================================================
// 导出工厂函数
// ============================================================================

export function createRepositories(prisma?: PrismaClient) {
  const client = prisma ?? getPrismaClient();

  return {
    conversations: new ConversationRepository(client),
    messages: new MessageRepository(client),
    responseRuns: new ResponseRunRepository(client),
    usageRecords: new UsageRecordRepository(client),
    quotaRecords: new QuotaRecordRepository(client),
    attachments: new AttachmentRepository(client),
    mediaJobs: new MediaJobRepository(client),
  };
}
