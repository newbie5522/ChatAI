/**
 * V2 数据模型 Repository 层测试
 * 
 * 测试策略：使用 Jest mock 模拟 PrismaClient
 * CI 环境无真实 PostgreSQL，通过 mock 验证：
 * 1. 租户隔离（所有查询带 employeeId）
 * 2. 方法调用参数正确
 * 3. 事务原子性（额度操作）
 */

// 手动 mock PrismaClient
const mockPrisma = {
  conversation: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  message: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  responseRun: {
    create: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
  },
  usageRecord: {
    create: jest.fn(),
    findMany: jest.fn(),
    aggregate: jest.fn(),
  },
  quotaRecord: {
    create: jest.fn(),
    findFirst: jest.fn(),
  },
  $transaction: jest.fn((fn: any) => fn(mockPrisma)),
};

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockPrisma),
}));

import {
  ConversationRepository,
  MessageRepository,
  ResponseRunRepository,
  UsageRecordRepository,
  QuotaRecordRepository,
} from "../app/repositories";

describe("ConversationRepository", () => {
  let repo: ConversationRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new ConversationRepository(mockPrisma as any);
  });

  test("create() 创建对话时包含 employeeId", async () => {
    const input = { employeeId: "emp-001", topic: "测试对话" };
    mockPrisma.conversation.create.mockResolvedValueOnce({ id: "conv-001", ...input });

    await repo.create(input);

    expect(mockPrisma.conversation.create).toHaveBeenCalledWith({
      data: { employeeId: "emp-001", topic: "测试对话" },
    });
  });

  test("findMany() 查询时强制带 employeeId 租户隔离", async () => {
    mockPrisma.conversation.findMany.mockResolvedValueOnce([]);

    await repo.findMany({ employeeId: "emp-001" });

    const callArgs = mockPrisma.conversation.findMany.mock.calls[0][0];
    expect(callArgs.where.employeeId).toBe("emp-001");
    expect(callArgs.where.deletedAt).toBe(null); // 默认排除软删除
  });

  test("findMany() 默认排除已软删除的对话", async () => {
    mockPrisma.conversation.findMany.mockResolvedValueOnce([]);

    await repo.findMany({ employeeId: "emp-001" });

    const callArgs = mockPrisma.conversation.findMany.mock.calls[0][0];
    expect(callArgs.where.deletedAt).toBe(null);
  });

  test("findById() 验证所有权：同时检查 id 和 employeeId", async () => {
    mockPrisma.conversation.findFirst.mockResolvedValueOnce({ id: "conv-001", employeeId: "emp-001" });

    await repo.findById("conv-001", "emp-001");

    expect(mockPrisma.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: "conv-001", employeeId: "emp-001" },
    });
  });

  test("softDelete() 只能删除自己的对话", async () => {
    // 找不到对话（不属于该员工）
    mockPrisma.conversation.findFirst.mockResolvedValueOnce(null);

    await expect(repo.softDelete("conv-other", "emp-001")).rejects.toThrow(
      "Conversation not found or access denied",
    );

    // 不应该执行 update
    expect(mockPrisma.conversation.update).not.toHaveBeenCalled();
  });

  test("softDelete() 软删除时设置 deletedAt", async () => {
    mockPrisma.conversation.findFirst.mockResolvedValueOnce({ id: "conv-001", employeeId: "emp-001" });
    mockPrisma.conversation.update.mockResolvedValueOnce({ id: "conv-001", deletedAt: new Date() });

    await repo.softDelete("conv-001", "emp-001");

    const updateCall = mockPrisma.conversation.update.mock.calls[0][0];
    expect(updateCall.where.id).toBe("conv-001");
    expect(updateCall.data.deletedAt).toBeInstanceOf(Date);
  });
});

describe("MessageRepository", () => {
  let repo: MessageRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new MessageRepository(mockPrisma as any);
  });

  test("create() 创建消息时同时创建 MessagePart", async () => {
    const input = {
      conversationId: "conv-001",
      employeeId: "emp-001",
      role: "user" as const,
      parts: [{ type: "text" as const, content: '{"text":"你好"}', order: 0 }],
    };
    mockPrisma.message.create.mockResolvedValueOnce({ id: "msg-001", ...input, parts: input.parts });

    await repo.create(input);

    const createCall = mockPrisma.message.create.mock.calls[0][0];
    expect(createCall.data.parts.create).toHaveLength(1);
    expect(createCall.data.parts.create[0].type).toBe("text");
  });

  test("findMany() 查询时强制带 conversationId 和 employeeId", async () => {
    mockPrisma.message.findMany.mockResolvedValueOnce([]);

    await repo.findMany({ conversationId: "conv-001", employeeId: "emp-001" });

    const callArgs = mockPrisma.message.findMany.mock.calls[0][0];
    expect(callArgs.where.conversationId).toBe("conv-001");
    expect(callArgs.where.employeeId).toBe("emp-001");
  });

  test("findById() 验证所有权：同时检查 id 和 employeeId", async () => {
    mockPrisma.message.findFirst.mockResolvedValueOnce({ id: "msg-001" });

    await repo.findById("msg-001", "emp-001");

    expect(mockPrisma.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "msg-001", employeeId: "emp-001" },
      }),
    );
  });

  test("softDelete() 只能删除自己的消息", async () => {
    mockPrisma.message.findFirst.mockResolvedValueOnce(null);

    await expect(repo.softDelete("msg-other", "emp-001")).rejects.toThrow(
      "Message not found or access denied",
    );
    expect(mockPrisma.message.update).not.toHaveBeenCalled();
  });
});

describe("ResponseRunRepository", () => {
  let repo: ResponseRunRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new ResponseRunRepository(mockPrisma as any);
  });

  test("create() 创建 ResponseRun 时状态初始为 pending", async () => {
    const input = { messageId: "msg-001", providerId: "openai", modelId: "gpt-4o" };
    mockPrisma.responseRun.create.mockResolvedValueOnce({ id: "run-001", status: "pending" });

    await repo.create(input);

    const createCall = mockPrisma.responseRun.create.mock.calls[0][0];
    expect(createCall.data.status).toBe("pending");
    expect(createCall.data.messageId).toBe("msg-001");
  });

  test("update() 可以更新状态为 completed", async () => {
    mockPrisma.responseRun.update.mockResolvedValueOnce({ id: "run-001", status: "completed" });

    await repo.update("run-001", { status: "completed", completedAt: new Date() });

    const updateCall = mockPrisma.responseRun.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("completed");
    expect(updateCall.data.completedAt).toBeInstanceOf(Date);
  });
});

describe("UsageRecordRepository", () => {
  let repo: UsageRecordRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new UsageRecordRepository(mockPrisma as any);
  });

  test("create() 创建用量记录时包含 employeeId", async () => {
    const input = {
      employeeId: "emp-001",
      providerId: "openai",
      modelId: "gpt-4o",
      inputTokens: 100,
      outputTokens: 200,
      totalTokens: 300,
      costAmount: 0.003,
    };
    mockPrisma.usageRecord.create.mockResolvedValueOnce({ id: "usage-001" });

    await repo.create(input);

    const createCall = mockPrisma.usageRecord.create.mock.calls[0][0];
    expect(createCall.data.employeeId).toBe("emp-001");
    expect(createCall.data.totalTokens).toBe(300);
    expect(createCall.data.cachedTokens).toBe(0); // 默认值
  });

  test("getTotalUsage() 统计时强制租户隔离", async () => {
    mockPrisma.usageRecord.aggregate.mockResolvedValueOnce({
      _sum: { totalTokens: 1000, costAmount: 0.01 },
    });

    const result = await repo.getTotalUsage("emp-001");

    const aggCall = mockPrisma.usageRecord.aggregate.mock.calls[0][0];
    expect(aggCall.where.employeeId).toBe("emp-001");
    expect(result.totalTokens).toBe(1000);
    expect(result.totalCost).toBe(0.01);
  });
});

describe("QuotaRecordRepository - 原子性额度操作", () => {
  let repo: QuotaRecordRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new QuotaRecordRepository(mockPrisma as any);
    // 重置 $transaction 为直接执行
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(mockPrisma));
  });

  test("reserve() 余额不足时抛出错误", async () => {
    // reserve() 执行顺序：1. 查余额(lastRecord)  2. 检查余额  3. 如果够再查幂等
    // 余额 0.5 < 1.0，直接在第2步抛出，不会走到第3步
    mockPrisma.quotaRecord.findFirst
      .mockResolvedValueOnce({ balance: 0.5 }); // 1. lastRecord → 余额不足直接抛出

    await expect(
      repo.reserve({ employeeId: "emp-001", amount: 1.0, referenceId: "run-001" }),
    ).rejects.toThrow("Insufficient quota");
  });

  test("reserve() 余额足够时创建预留记录", async () => {
    // reserve() 执行顺序：1. 查余额(lastRecord)  2. 查幂等去重  3. 创建记录
    mockPrisma.quotaRecord.findFirst
      .mockResolvedValueOnce({ balance: 10.0 }) // 1. lastRecord
      .mockResolvedValueOnce(null);             // 2. 无重复预留
    mockPrisma.quotaRecord.create.mockResolvedValueOnce({
      id: "quota-001", type: "reserve", amount: -1.0, balance: 9.0,
    });

    await repo.reserve({ employeeId: "emp-001", amount: 1.0, referenceId: "run-001" });

    const createCall = mockPrisma.quotaRecord.create.mock.calls[0][0];
    expect(createCall.data.type).toBe("reserve");
    expect(createCall.data.amount).toBe(-1.0);
    expect(createCall.data.balance).toBe(9.0);
  });

  test("reserve() 重复预留时幂等返回已有记录", async () => {
    // reserve() 执行顺序：1. 查余额(lastRecord)  2. 查幂等去重 → 有则直接返回
    const existing = { id: "quota-001", type: "reserve" };
    mockPrisma.quotaRecord.findFirst
      .mockResolvedValueOnce({ balance: 10.0 }) // 1. lastRecord
      .mockResolvedValueOnce(existing);         // 2. 已有预留记录 → 直接返回

    const result = await repo.reserve({ employeeId: "emp-001", amount: 1.0, referenceId: "run-001" });

    expect(result).toBe(existing);
    expect(mockPrisma.quotaRecord.create).not.toHaveBeenCalled(); // 不重复创建
  });

  test("release() 释放时余额增加", async () => {
    // release() 执行顺序：1. 查幂等去重  2. 查余额(lastRecord)  3. 创建记录
    mockPrisma.quotaRecord.findFirst
      .mockResolvedValueOnce(null)              // 1. 无重复释放
      .mockResolvedValueOnce({ balance: 9.0 }); // 2. lastRecord
    mockPrisma.quotaRecord.create.mockResolvedValueOnce({
      id: "quota-002", type: "release", amount: 1.0, balance: 10.0,
    });

    await repo.release({ employeeId: "emp-001", amount: 1.0, referenceId: "run-001" });

    const createCall = mockPrisma.quotaRecord.create.mock.calls[0][0];
    expect(createCall.data.type).toBe("release");
    expect(createCall.data.amount).toBe(1.0);
    expect(createCall.data.balance).toBe(10.0);
  });
});
