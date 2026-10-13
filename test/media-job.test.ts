/**
 * MediaJobRepository 单元测试
 *
 * @jest-environment node
 *
 * 测试策略：mock PrismaClient，验证：
 * 1. 创建任务（含 employeeId 隔离）
 * 2. 租户隔离（不同 employeeId 返回 null）
 * 3. pending → processing → completed 状态转换
 * 4. failed 状态含 errorMessage
 * 5. cancel 操作
 * 6. findPending 只返回 pending/processing
 * 7. expiresAt 逻辑
 * 8. storageKey 在 completed 时被设置
 */

// 手动 mock PrismaClient
const mockPrisma: any = {
  mediaJob: {
    create: jest.fn(),
    update: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
};

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockPrisma),
}));

import { MediaJobRepository } from "../app/repositories";

describe("MediaJobRepository", () => {
  let repo: MediaJobRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new MediaJobRepository(mockPrisma as any);
  });

  // ── 测试 1：create() 成功 ────────────────────────────────────────────────
  test("create() 创建任务时状态初始为 pending，包含 employeeId", async () => {
    const input = {
      employeeId: "emp-001",
      kind: "image" as const,
      prompt: "一只猫",
      modelId: "gpt-image-1",
      providerId: "openai",
    };
    const mockJob = {
      id: "job-001",
      ...input,
      messageId: null,
      status: "pending",
      storageKey: null,
      resultUrl: null,
      errorMessage: null,
      createdAt: new Date(),
      completedAt: null,
      expiresAt: null,
    };
    mockPrisma.mediaJob.create.mockResolvedValueOnce(mockJob);

    const job = await repo.create(input);

    const createCall = mockPrisma.mediaJob.create.mock.calls[0][0];
    expect(createCall.data.status).toBe("pending");
    expect(createCall.data.employeeId).toBe("emp-001");
    expect(createCall.data.kind).toBe("image");
    expect(job.status).toBe("pending");
  });

  // ── 测试 2：租户隔离 ────────────────────────────────────────────────────
  test("findById() 不同 employeeId 返回 null（租户隔离）", async () => {
    // 模拟用 emp-002 查询 emp-001 的任务，返回 null
    mockPrisma.mediaJob.findFirst.mockResolvedValueOnce(null);

    const result = await repo.findById("job-001", "emp-002");

    expect(result).toBeNull();
    const callArgs = mockPrisma.mediaJob.findFirst.mock.calls[0][0];
    expect(callArgs.where.id).toBe("job-001");
    expect(callArgs.where.employeeId).toBe("emp-002");
  });

  // ── 测试 3：pending → processing → completed 状态转换 ───────────────────
  test("updateStatus() 支持 pending → processing → completed 状态链", async () => {
    const baseJob = {
      id: "job-001",
      employeeId: "emp-001",
      status: "processing",
      completedAt: null,
    };
    mockPrisma.mediaJob.update
      .mockResolvedValueOnce({ ...baseJob, status: "processing" })
      .mockResolvedValueOnce({ ...baseJob, status: "completed", completedAt: new Date() });

    await repo.updateStatus("job-001", "processing");
    const call1 = mockPrisma.mediaJob.update.mock.calls[0][0];
    expect(call1.data.status).toBe("processing");
    // processing 不设置 completedAt
    expect(call1.data.completedAt).toBeUndefined();

    await repo.updateStatus("job-001", "completed");
    const call2 = mockPrisma.mediaJob.update.mock.calls[1][0];
    expect(call2.data.status).toBe("completed");
    expect(call2.data.completedAt).toBeInstanceOf(Date);
  });

  // ── 测试 4：failed 状态含 errorMessage ──────────────────────────────────
  test("updateStatus() failed 状态时保存 errorMessage 并设置 completedAt", async () => {
    mockPrisma.mediaJob.update.mockResolvedValueOnce({
      id: "job-001",
      status: "failed",
      errorMessage: "API 调用超时",
      completedAt: new Date(),
    });

    await repo.updateStatus("job-001", "failed", { errorMessage: "API 调用超时" });

    const call = mockPrisma.mediaJob.update.mock.calls[0][0];
    expect(call.data.status).toBe("failed");
    expect(call.data.errorMessage).toBe("API 调用超时");
    expect(call.data.completedAt).toBeInstanceOf(Date);
  });

  // ── 测试 5：cancel 操作 ─────────────────────────────────────────────────
  test("cancel() 取消 pending 任务，设置 status=cancelled 和 completedAt", async () => {
    const pendingJob = {
      id: "job-001",
      employeeId: "emp-001",
      status: "pending",
      completedAt: null,
    };
    mockPrisma.mediaJob.findFirst.mockResolvedValueOnce(pendingJob);
    mockPrisma.mediaJob.update.mockResolvedValueOnce({
      ...pendingJob,
      status: "cancelled",
      completedAt: new Date(),
    });

    const result = await repo.cancel("job-001", "emp-001");

    expect(result.status).toBe("cancelled");
    const updateCall = mockPrisma.mediaJob.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("cancelled");
    expect(updateCall.data.completedAt).toBeInstanceOf(Date);
  });

  test("cancel() 任务不属于该用户时抛出错误", async () => {
    mockPrisma.mediaJob.findFirst.mockResolvedValueOnce(null);

    await expect(repo.cancel("job-001", "emp-002")).rejects.toThrow(
      "MediaJob not found or access denied",
    );
    expect(mockPrisma.mediaJob.update).not.toHaveBeenCalled();
  });

  // ── 测试 6：findPending 只返回 pending/processing ────────────────────────
  test("findPending() 只返回 pending 和 processing 状态的任务", async () => {
    const pendingJobs = [
      { id: "job-001", status: "pending" },
      { id: "job-002", status: "processing" },
    ];
    mockPrisma.mediaJob.findMany.mockResolvedValueOnce(pendingJobs);

    const jobs = await repo.findPending("emp-001");

    const callArgs = mockPrisma.mediaJob.findMany.mock.calls[0][0];
    expect(callArgs.where.employeeId).toBe("emp-001");
    expect(callArgs.where.status).toEqual({ in: ["pending", "processing"] });
    expect(jobs).toHaveLength(2);
  });

  // ── 测试 7：expiresAt 逻辑 ──────────────────────────────────────────────
  test("create() 可以传入 expiresAt，为空则永久保存（不设置过期）", async () => {
    const expiresAt = new Date("2027-01-01T00:00:00Z");
    mockPrisma.mediaJob.create.mockResolvedValueOnce({
      id: "job-003",
      employeeId: "emp-001",
      status: "pending",
      expiresAt,
    });

    await repo.create({
      employeeId: "emp-001",
      kind: "image",
      prompt: "test",
      modelId: "m1",
      providerId: "openai",
      expiresAt,
    });

    const createCall = mockPrisma.mediaJob.create.mock.calls[0][0];
    expect(createCall.data.expiresAt).toEqual(expiresAt);

    // 不传 expiresAt 时应为 undefined（永久保存）
    jest.clearAllMocks();
    mockPrisma.mediaJob.create.mockResolvedValueOnce({
      id: "job-004",
      employeeId: "emp-001",
      status: "pending",
      expiresAt: null,
    });

    await repo.create({
      employeeId: "emp-001",
      kind: "image",
      prompt: "test",
      modelId: "m1",
      providerId: "openai",
    });

    const createCall2 = mockPrisma.mediaJob.create.mock.calls[0][0];
    expect(createCall2.data.expiresAt).toBeUndefined();
  });

  // ── 测试 8：storageKey 在 completed 时被设置 ───────────────────────────
  test("updateStatus() completed 时同时写入 storageKey 和 resultUrl", async () => {
    mockPrisma.mediaJob.update.mockResolvedValueOnce({
      id: "job-001",
      status: "completed",
      storageKey: "media/job-001/output.png",
      resultUrl: "/api/media/jobs/job-001/result",
      completedAt: new Date(),
    });

    await repo.updateStatus("job-001", "completed", {
      storageKey: "media/job-001/output.png",
      resultUrl: "/api/media/jobs/job-001/result",
    });

    const call = mockPrisma.mediaJob.update.mock.calls[0][0];
    expect(call.data.status).toBe("completed");
    expect(call.data.storageKey).toBe("media/job-001/output.png");
    expect(call.data.resultUrl).toBe("/api/media/jobs/job-001/result");
    expect(call.data.completedAt).toBeInstanceOf(Date);
  });
});
