/**
 * V2 数据仓储层测试
 * 测试数据库操作的正确性
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  ConversationRepository,
  MessageRepository,
  RunRepository,
  ArtifactRepository,
  AttachmentRepository,
  UsageRepository,
} from '../app/repositories';

describe('ConversationRepository', () => {
  let prisma: PrismaClient;
  let repo: ConversationRepository;

  beforeAll(() => {
    prisma = new PrismaClient();
    repo = new ConversationRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // 清理测试数据
    await prisma.conversation.deleteMany();
  });

  it('should create a conversation', async () => {
    const conv = await repo.create({
      employeeId: 'test-employee',
      topic: 'Test Conversation',
    });

    expect(conv.id).toBeDefined();
    expect(conv.employeeId).toBe('test-employee');
    expect(conv.topic).toBe('Test Conversation');
  });

  it('should find conversation by id', async () => {
    const created = await repo.create({
      employeeId: 'test-employee',
      topic: 'Test',
    });

    const found = await repo.findById(created.id);
    expect(found).toBeDefined();
    expect(found?.id).toBe(created.id);
  });

  it('should list conversations by employeeId', async () => {
    await repo.create({ employeeId: 'emp1', topic: 'Conv1' });
    await repo.create({ employeeId: 'emp1', topic: 'Conv2' });
    await repo.create({ employeeId: 'emp2', topic: 'Conv3' });

    const convs = await repo.findByEmployeeId('emp1');
    expect(convs).toHaveLength(2);
  });

  it('should soft delete conversation', async () => {
    const conv = await repo.create({
      employeeId: 'test',
      topic: 'Test',
    });

    await repo.softDelete(conv.id);

    const convs = await repo.findByEmployeeId('test');
    expect(convs).toHaveLength(0); // 软删除后不应出现
  });
});

describe('MessageRepository', () => {
  let prisma: PrismaClient;
  let convRepo: ConversationRepository;
  let msgRepo: MessageRepository;
  let conversationId: string;

  beforeAll(() => {
    prisma = new PrismaClient();
    convRepo = new ConversationRepository(prisma);
    msgRepo = new MessageRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.message.deleteMany();
    await prisma.conversation.deleteMany();

    const conv = await convRepo.create({
      employeeId: 'test',
      topic: 'Test',
    });
    conversationId = conv.id;
  });

  it('should create a message', async () => {
    const msg = await msgRepo.create({
      conversationId,
      role: 'user',
      content: 'Hello',
    });

    expect(msg.id).toBeDefined();
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hello');
  });

  it('should support message branching', async () => {
    const parent = await msgRepo.create({
      conversationId,
      role: 'user',
      content: 'Parent',
    });

    const child1 = await msgRepo.create({
      conversationId,
      role: 'assistant',
      content: 'Child 1',
      parentId: parent.id,
    });

    const child2 = await msgRepo.create({
      conversationId,
      role: 'assistant',
      content: 'Child 2',
      parentId: parent.id,
    });

    const children = await msgRepo.findChildren(parent.id);
    expect(children).toHaveLength(2);
  });

  it('should list messages by conversation', async () => {
    await msgRepo.create({
      conversationId,
      role: 'user',
      content: 'Msg1',
    });
    await msgRepo.create({
      conversationId,
      role: 'assistant',
      content: 'Msg2',
    });

    const messages = await msgRepo.findByConversationId(conversationId);
    expect(messages).toHaveLength(2);
  });
});

describe('RunRepository', () => {
  let prisma: PrismaClient;
  let convRepo: ConversationRepository;
  let msgRepo: MessageRepository;
  let runRepo: RunRepository;
  let messageId: string;

  beforeAll(() => {
    prisma = new PrismaClient();
    convRepo = new ConversationRepository(prisma);
    msgRepo = new MessageRepository(prisma);
    runRepo = new RunRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.run.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversation.deleteMany();

    const conv = await convRepo.create({
      employeeId: 'test',
      topic: 'Test',
    });
    const msg = await msgRepo.create({
      conversationId: conv.id,
      role: 'user',
      content: 'Test',
    });
    messageId = msg.id;
  });

  it('should create a run with pending status', async () => {
    const run = await runRepo.create({
      messageId,
      requestId: 'req-123',
      model: 'gpt-4',
      providerName: 'openai',
    });

    expect(run.status).toBe('pending');
    expect(run.requestId).toBe('req-123');
  });

  it('should update run status', async () => {
    const run = await runRepo.create({
      messageId,
      requestId: 'req-123',
      model: 'gpt-4',
      providerName: 'openai',
    });

    const updated = await runRepo.updateStatus(run.id, 'completed');
    expect(updated.status).toBe('completed');
    expect(updated.completedAt).toBeDefined();
  });

  it('should enforce requestId uniqueness (idempotency)', async () => {
    await runRepo.create({
      messageId,
      requestId: 'req-unique',
      model: 'gpt-4',
      providerName: 'openai',
    });

    await expect(
      runRepo.create({
        messageId,
        requestId: 'req-unique',
        model: 'gpt-4',
        providerName: 'openai',
      }),
    ).rejects.toThrow();
  });
});

describe('UsageRepository', () => {
  let prisma: PrismaClient;
  let convRepo: ConversationRepository;
  let msgRepo: MessageRepository;
  let runRepo: RunRepository;
  let usageRepo: UsageRepository;

  beforeAll(() => {
    prisma = new PrismaClient();
    convRepo = new ConversationRepository(prisma);
    msgRepo = new MessageRepository(prisma);
    runRepo = new RunRepository(prisma);
    usageRepo = new UsageRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.usage.deleteMany();
    await prisma.run.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversation.deleteMany();
  });

  it('should record usage for a run', async () => {
    const conv = await convRepo.create({
      employeeId: 'test',
      topic: 'Test',
    });
    const msg = await msgRepo.create({
      conversationId: conv.id,
      role: 'user',
      content: 'Test',
    });
    const run = await runRepo.create({
      messageId: msg.id,
      requestId: 'req-123',
      model: 'gpt-4',
      providerName: 'openai',
    });

    const usage = await usageRepo.create({
      runId: run.id,
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cost: 0.003,
    });

    expect(usage.totalTokens).toBe(150);
    expect(usage.cost).toBe(0.003);
  });

  it('should aggregate usage by employeeId', async () => {
    const conv = await convRepo.create({
      employeeId: 'emp1',
      topic: 'Test',
    });
    const msg1 = await msgRepo.create({
      conversationId: conv.id,
      role: 'user',
      content: 'Msg1',
    });
    const msg2 = await msgRepo.create({
      conversationId: conv.id,
      role: 'user',
      content: 'Msg2',
    });

    const run1 = await runRepo.create({
      messageId: msg1.id,
      requestId: 'req-1',
      model: 'gpt-4',
      providerName: 'openai',
    });
    const run2 = await runRepo.create({
      messageId: msg2.id,
      requestId: 'req-2',
      model: 'gpt-4',
      providerName: 'openai',
    });

    await usageRepo.create({
      runId: run1.id,
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cost: 0.003,
    });
    await usageRepo.create({
      runId: run2.id,
      promptTokens: 200,
      completionTokens: 100,
      totalTokens: 300,
      cost: 0.006,
    });

    const startDate = new Date('2020-01-01');
    const endDate = new Date('2030-01-01');
    const result = await usageRepo.sumByEmployeeId('emp1', startDate, endDate);

    expect(result.totalTokens).toBe(450);
    expect(result.totalCost).toBe(0.009);
  });
});
