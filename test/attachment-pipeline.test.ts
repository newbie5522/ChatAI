/**
 * @jest-environment node
 *
 * Issue #18：持久化附件管线 — 单元测试
 *
 * 测试策略：mock PrismaClient，验证租户隔离、状态机流转、过期逻辑
 */

import type { PrismaClient } from "@prisma/client";

// 手动 mock PrismaClient（与 test/repositories.test.ts 保持一致）
const mockPrisma: any = {
  attachment: {
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    deleteMany: jest.fn(),
  },
  $transaction: jest.fn((fn: any) => fn(mockPrisma)),
};

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockPrisma),
}));

import { AttachmentRepository } from "../app/repositories";

describe("AttachmentRepository", () => {
  let repo: AttachmentRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new AttachmentRepository(mockPrisma as unknown as PrismaClient);
  });

  // ── 1. create() 成功 ──────────────────────────────────────────────────────
  test("create() 成功创建附件记录，status 默认为 ready", async () => {
    const input = {
      employeeId: "emp-001",
      name: "report.pdf",
      mimeType: "application/pdf",
      size: 102400,
      kind: "document",
      storageKey: "analysis-uuid-001",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    };
    const expected = { id: "att-001", status: "ready", ...input };
    mockPrisma.attachment.create.mockResolvedValueOnce(expected);

    const result = await repo.create(input);

    const createCall = mockPrisma.attachment.create.mock.calls[0][0];
    expect(createCall.data.employeeId).toBe("emp-001");
    expect(createCall.data.storageKey).toBe("analysis-uuid-001");
    expect(createCall.data.status).toBe("ready");
    expect(result).toBe(expected);
  });

  // ── 2. findById() 租户隔离（不同 employeeId 返回 null）───────────────────
  test("findById() 不同 employeeId 返回 null（租户隔离）", async () => {
    mockPrisma.attachment.findFirst.mockResolvedValueOnce(null);

    const result = await repo.findById("att-001", "emp-other");

    const callArgs = mockPrisma.attachment.findFirst.mock.calls[0][0];
    expect(callArgs.where.id).toBe("att-001");
    expect(callArgs.where.employeeId).toBe("emp-other");
    expect(result).toBeNull();
  });

  test("findById() 相同 employeeId 可以找到记录", async () => {
    const record = { id: "att-001", employeeId: "emp-001" };
    mockPrisma.attachment.findFirst.mockResolvedValueOnce(record);

    const result = await repo.findById("att-001", "emp-001");

    expect(result).toBe(record);
  });

  // ── 3. updateStatus() 正常流转 ────────────────────────────────────────────
  test("updateStatus() 更新 status 字段", async () => {
    const updated = { id: "att-001", status: "processing" };
    mockPrisma.attachment.update.mockResolvedValueOnce(updated);

    const result = await repo.updateStatus("att-001", "processing");

    const updateCall = mockPrisma.attachment.update.mock.calls[0][0];
    expect(updateCall.where.id).toBe("att-001");
    expect(updateCall.data.status).toBe("processing");
    expect(updateCall.data.errorMessage).toBeNull();
    expect(result).toBe(updated);
  });

  test("updateStatus() failed 时记录 errorMessage", async () => {
    mockPrisma.attachment.update.mockResolvedValueOnce({
      id: "att-001",
      status: "failed",
      errorMessage: "解析超时",
    });

    await repo.updateStatus("att-001", "failed", "解析超时");

    const updateCall = mockPrisma.attachment.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("failed");
    expect(updateCall.data.errorMessage).toBe("解析超时");
  });

  // ── 4. bindToMessage() 正确绑定 ──────────────────────────────────────────
  test("bindToMessage() 绑定 messageId 到附件", async () => {
    // findFirst（所有权验证）返回记录
    mockPrisma.attachment.findFirst.mockResolvedValueOnce({
      id: "att-001",
      employeeId: "emp-001",
    });
    mockPrisma.attachment.update.mockResolvedValueOnce({
      id: "att-001",
      messageId: "msg-001",
    });

    await repo.bindToMessage("att-001", "msg-001", "emp-001");

    const updateCall = mockPrisma.attachment.update.mock.calls[0][0];
    expect(updateCall.where.id).toBe("att-001");
    expect(updateCall.data.messageId).toBe("msg-001");
  });

  test("bindToMessage() 跨账号操作抛出错误", async () => {
    mockPrisma.attachment.findFirst.mockResolvedValueOnce(null);

    await expect(
      repo.bindToMessage("att-001", "msg-001", "emp-other"),
    ).rejects.toThrow("Attachment not found or access denied");

    expect(mockPrisma.attachment.update).not.toHaveBeenCalled();
  });

  // ── 5. deleteExpired() 清理逻辑 ───────────────────────────────────────────
  test("deleteExpired() 删除 expiresAt <= now 的记录并返回数量", async () => {
    mockPrisma.attachment.deleteMany.mockResolvedValueOnce({ count: 3 });

    const count = await repo.deleteExpired();

    const deleteManyCall = mockPrisma.attachment.deleteMany.mock.calls[0][0];
    expect(deleteManyCall.where.expiresAt.lte).toBeInstanceOf(Date);
    expect(count).toBe(3);
  });

  // ── 6. 状态机：pending → processing → ready ───────────────────────────────
  test("状态机：pending → processing → ready 完整路径", async () => {
    mockPrisma.attachment.update
      .mockResolvedValueOnce({ id: "att-001", status: "processing" })
      .mockResolvedValueOnce({ id: "att-001", status: "ready" });

    await repo.updateStatus("att-001", "processing");
    await repo.updateStatus("att-001", "ready");

    const calls = mockPrisma.attachment.update.mock.calls;
    expect(calls[0][0].data.status).toBe("processing");
    expect(calls[1][0].data.status).toBe("ready");
  });

  // ── 7. 状态机：pending → failed 重试后 ready ─────────────────────────────
  test("状态机：pending → failed 重试后 ready", async () => {
    mockPrisma.attachment.update
      .mockResolvedValueOnce({ id: "att-001", status: "failed" })
      .mockResolvedValueOnce({ id: "att-001", status: "processing" })
      .mockResolvedValueOnce({ id: "att-001", status: "ready" });

    await repo.updateStatus("att-001", "failed", "网络超时");
    await repo.updateStatus("att-001", "processing");
    await repo.updateStatus("att-001", "ready");

    const calls = mockPrisma.attachment.update.mock.calls;
    expect(calls[0][0].data.status).toBe("failed");
    expect(calls[0][0].data.errorMessage).toBe("网络超时");
    expect(calls[1][0].data.status).toBe("processing");
    expect(calls[2][0].data.status).toBe("ready");
  });

  // ── 8. expiresAt 逻辑（30 天后过期）──────────────────────────────────────
  test("expiresAt 设置为 30 天后", async () => {
    const before = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    mockPrisma.attachment.create.mockResolvedValueOnce({ id: "att-001" });

    await repo.create({
      employeeId: "emp-001",
      name: "data.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: 20480,
      kind: "table",
      storageKey: "analysis-uuid-002",
      expiresAt: new Date(before + thirtyDaysMs),
    });

    const createCall = mockPrisma.attachment.create.mock.calls[0][0];
    const expiresAt: Date = createCall.data.expiresAt;
    expect(expiresAt).toBeInstanceOf(Date);
    const diff = expiresAt.getTime() - before;
    // 允许 ±5 秒误差
    expect(diff).toBeGreaterThanOrEqual(thirtyDaysMs - 5000);
    expect(diff).toBeLessThanOrEqual(thirtyDaysMs + 5000);
  });
});
