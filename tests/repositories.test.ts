/**
 * V2 数据仓储层测试
 * 使用 mock PrismaClient 验证仓储层的调用逻辑（不依赖真实数据库）
 *
 * 说明：CI 环境无 PostgreSQL，因此本测试通过 mock 验证：
 * 1. 仓储方法是否以正确的参数调用 Prisma
 * 2. 返回值是否正确传递
 * 真实数据库集成测试见 docs/v2/MIGRATION.md 中的本地验证步骤。
 */

import {
  ConversationRepository,
  MessageRepository,
  RunRepository,
  ArtifactRepository,
  AttachmentRepository,
  UsageRepository,
} from '../app/repositories';

// Mock PrismaClient：为每个模型提供最小可用的方法集
function createMockPrisma() {
  return {
    conversation: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    message: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    run: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    artifact: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    attachment: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    usage: {
      create: jest.fn(),
      findUnique: jest.fn(),
      aggregate: jest.fn(),
    },
  } as any;
}

describe('ConversationRepository', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let repo: ConversationRepository;

  beforeEach(() => {
    prisma = createMockPrisma();
    repo = new ConversationRepository(prisma);
  });

  it('should create a conversation with correct params', async () => {
    const expected = {
      id: 'conv-1',
      employeeId: 'test-employee',
      topic: 'Test Conversation',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    prisma.conversation.create.mockResolvedValue(expected);

    const result = await repo.create({
      employeeId: 'test-employee',
      topic: 'Test Conversation',
    });

    expect(prisma.conversation.create).toHaveBeenCalledWith({
      data: { employeeId: 'test-employee', topic: 'Test Conversation' },
    });
    expect(result).toEqual(expected);
  });

  it('should find conversation by id', async () => {
    const expected = { id: 'conv-1', employeeId: 'e1', topic: 'T' };
    prisma.conversation.findUnique.mockResolvedValue(expected);

    const result = await repo.findById('conv-1');

    expect(prisma.conversation.findUnique).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
    });
    expect(result).toEqual(expected);
  });

  it('should list conversations by employeeId excluding soft-deleted', async () => {
    const expected = [{ id: 'c1' }, { id: 'c2' }];
    prisma.conversation.findMany.mockResolvedValue(expected);

    const result = await repo.findByEmployeeId('emp1');

    expect(prisma.conversation.findMany).toHaveBeenCalledWith({
      where: { employeeId: 'emp1', deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
    expect(result).toEqual(expected);
  });

  it('should soft delete conversation by setting deletedAt', async () => {
    const now = new Date();
    prisma.conversation.update.mockResolvedValue({ id: 'conv-1', deletedAt: now });

    await repo.softDelete('conv-1');

    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: { deletedAt: expect.any(Date) },
    });
  });
});

describe('MessageRepository', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let repo: MessageRepository;

  beforeEach(() => {
    prisma = createMockPrisma();
    repo = new MessageRepository(prisma);
  });

  it('should create a message with default contentType', async () => {
    prisma.message.create.mockResolvedValue({ id: 'msg-1' });

    await repo.create({
      conversationId: 'conv-1',
      role: 'user',
      content: 'Hello',
    });

    expect(prisma.message.create).toHaveBeenCalledWith({
      data: {
        conversationId: 'conv-1',
        role: 'user',
        content: 'Hello',
        contentType: 'text',
      },
    });
  });

  it('should support message branching via parentId', async () => {
    prisma.message.create.mockResolvedValue({ id: 'msg-2', parentId: 'msg-1' });

    await repo.create({
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'Reply',
      parentId: 'msg-1',
    });

    expect(prisma.message.create).toHaveBeenCalledWith({
      data: {
        conversationId: 'conv-1',
        role: 'assistant',
        content: 'Reply',
        contentType: 'text',
        parentId: 'msg-1',
      },
    });
  });

  it('should list messages by conversationId with runs and attachments included', async () => {
    prisma.message.findMany.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);

    const result = await repo.findByConversationId('conv-1');

    expect(prisma.message.findMany).toHaveBeenCalledWith({
      where: { conversationId: 'conv-1', deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: {
        runs: true,
        attachments: { include: { artifact: true } },
      },
    });
    expect(result).toHaveLength(2);
  });

  it('should find children of a parent message', async () => {
    prisma.message.findMany.mockResolvedValue([{ id: 'child-1' }]);

    const result = await repo.findChildren('parent-1');

    expect(prisma.message.findMany).toHaveBeenCalledWith({
      where: { parentId: 'parent-1', deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    expect(result).toHaveLength(1);
  });
});

describe('RunRepository', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let repo: RunRepository;

  beforeEach(() => {
    prisma = createMockPrisma();
    repo = new RunRepository(prisma);
  });

  it('should create a run with pending status implied by schema default', async () => {
    prisma.run.create.mockResolvedValue({
      id: 'run-1',
      requestId: 'req-123',
      status: 'pending',
    });

    const result = await repo.create({
      messageId: 'msg-1',
      requestId: 'req-123',
      model: 'gpt-4',
      providerName: 'openai',
    });

    expect(prisma.run.create).toHaveBeenCalledWith({
      data: {
        messageId: 'msg-1',
        requestId: 'req-123',
        model: 'gpt-4',
        providerName: 'openai',
        status: 'pending',
      },
    });
    expect(result.status).toBe('pending');
  });

  it('should update run status to completed and set completedAt', async () => {
    prisma.run.update.mockResolvedValue({ id: 'run-1', status: 'completed' });

    await repo.updateStatus('run-1', 'completed');

    expect(prisma.run.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: {
        status: 'completed',
        completedAt: expect.any(Date),
        errorCode: undefined,
        errorMessage: undefined,
      },
    });
  });

  it('should record error details when marking a run as failed', async () => {
    prisma.run.update.mockResolvedValue({ id: 'run-1', status: 'failed' });

    await repo.updateStatus('run-1', 'failed', {
      code: 'NETWORK_ERROR',
      message: 'Timeout',
    });

    expect(prisma.run.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: {
        status: 'failed',
        completedAt: expect.any(Date),
        errorCode: 'NETWORK_ERROR',
        errorMessage: 'Timeout',
      },
    });
  });

  it('should find run by requestId for idempotency checks', async () => {
    prisma.run.findUnique.mockResolvedValue({ id: 'run-1', requestId: 'req-unique' });

    const result = await repo.findByRequestId('req-unique');

    expect(prisma.run.findUnique).toHaveBeenCalledWith({
      where: { requestId: 'req-unique' },
    });
    expect(result?.requestId).toBe('req-unique');
  });
});

describe('UsageRepository', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let repo: UsageRepository;

  beforeEach(() => {
    prisma = createMockPrisma();
    repo = new UsageRepository(prisma);
  });

  it('should record usage for a run', async () => {
    prisma.usage.create.mockResolvedValue({
      id: 'usage-1',
      runId: 'run-1',
      totalTokens: 150,
      cost: 0.003,
    });

    const result = await repo.create({
      runId: 'run-1',
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cost: 0.003,
    });

    expect(prisma.usage.create).toHaveBeenCalledWith({
      data: {
        runId: 'run-1',
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cost: 0.003,
      },
    });
    expect(result.totalTokens).toBe(150);
  });

  it('should aggregate usage by employeeId within a date range', async () => {
    prisma.usage.aggregate.mockResolvedValue({
      _sum: { totalTokens: 450, cost: 0.009 },
    });

    const startDate = new Date('2020-01-01');
    const endDate = new Date('2030-01-01');
    const result = await repo.sumByEmployeeId('emp1', startDate, endDate);

    expect(prisma.usage.aggregate).toHaveBeenCalledWith({
      where: {
        run: { message: { conversation: { employeeId: 'emp1' } } },
        createdAt: { gte: startDate, lte: endDate },
      },
      _sum: { totalTokens: true, cost: true },
    });
    expect(result.totalTokens).toBe(450);
    expect(result.totalCost).toBe(0.009);
  });

  it('should return zero when no usage exists', async () => {
    prisma.usage.aggregate.mockResolvedValue({ _sum: { totalTokens: null, cost: null } });

    const result = await repo.sumByEmployeeId(
      'emp-empty',
      new Date('2020-01-01'),
      new Date('2030-01-01'),
    );

    expect(result.totalTokens).toBe(0);
    expect(result.totalCost).toBe(0);
  });
});

describe('ArtifactRepository', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let repo: ArtifactRepository;

  beforeEach(() => {
    prisma = createMockPrisma();
    repo = new ArtifactRepository(prisma);
  });

  it('should create an artifact', async () => {
    prisma.artifact.create.mockResolvedValue({
      id: 'art-1',
      storageKey: 's3://bucket/key.png',
    });

    const result = await repo.create({
      storageKey: 's3://bucket/key.png',
      mimeType: 'image/png',
      size: 1024,
    });

    expect(prisma.artifact.create).toHaveBeenCalledWith({
      data: { storageKey: 's3://bucket/key.png', mimeType: 'image/png', size: 1024 },
    });
    expect(result.storageKey).toBe('s3://bucket/key.png');
  });

  it('should find artifact by storageKey to prevent duplicates', async () => {
    prisma.artifact.findUnique.mockResolvedValue({ id: 'art-1' });

    const result = await repo.findByStorageKey('s3://bucket/key.png');

    expect(prisma.artifact.findUnique).toHaveBeenCalledWith({
      where: { storageKey: 's3://bucket/key.png' },
    });
    expect(result).toEqual({ id: 'art-1' });
  });
});

describe('AttachmentRepository', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let repo: AttachmentRepository;

  beforeEach(() => {
    prisma = createMockPrisma();
    repo = new AttachmentRepository(prisma);
  });

  it('should create an attachment linked to an artifact', async () => {
    prisma.attachment.create.mockResolvedValue({ id: 'att-1' });

    await repo.create({
      messageId: 'msg-1',
      kind: 'image',
      artifactId: 'art-1',
    });

    expect(prisma.attachment.create).toHaveBeenCalledWith({
      data: { messageId: 'msg-1', kind: 'image', artifactId: 'art-1' },
    });
  });

  it('should find attachments by messageId including artifact', async () => {
    prisma.attachment.findMany.mockResolvedValue([{ id: 'att-1' }]);

    const result = await repo.findByMessageId('msg-1');

    expect(prisma.attachment.findMany).toHaveBeenCalledWith({
      where: { messageId: 'msg-1' },
      include: { artifact: true },
    });
    expect(result).toHaveLength(1);
  });
});
