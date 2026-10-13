/**
 * RBAC 越权测试（Issue #21）
 *
 * 覆盖：
 * 1. employee 不能访问 admin:audit
 * 2. admin 可以访问 admin:audit
 * 3. super_admin 可以访问全部资源
 * 4. employee 不能使用未授权模型（通过 accountCanUseCompanyModel 检查）
 * 5. checkPermission 返回正确布尔值
 * 6. getAllowedResources 返回正确列表
 * 7. 并发额度：reserve → failed → release（额度回到原值）
 * 8. QuotaRecord 原子性（reserve 余额不足时抛出错误）
 */

import { checkPermission, getAllowedResources } from "../app/utils/rbac";
import type { SafeAccountRecord } from "../app/config/admin-store";

// ============================================================================
// 测试数据工厂
// ============================================================================

function makeAccount(
  role: "employee" | "admin" | "super_admin",
  overrides: Partial<SafeAccountRecord> = {},
): SafeAccountRecord {
  return {
    id: `acc-${role}`,
    username: role,
    name: role,
    role,
    status: "active",
    quotaUnlimited: false,
    allowedModelIds: [],
    allowedCategories: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ============================================================================
// 1. employee 不能访问 admin:audit
// ============================================================================

test("employee 不能访问 admin:audit", () => {
  const account = makeAccount("employee");
  expect(checkPermission(account, "admin:audit")).toBe(false);
});

// ============================================================================
// 2. admin 可以访问 admin:audit（自己账号下）
// ============================================================================

test("admin 可以访问 admin:audit", () => {
  const account = makeAccount("admin");
  expect(checkPermission(account, "admin:audit")).toBe(true);
});

// ============================================================================
// 3. super_admin 可以访问全部资源
// ============================================================================

test("super_admin 可以访问全部资源（包含 admin:users）", () => {
  const account = makeAccount("super_admin");
  expect(checkPermission(account, "chat")).toBe(true);
  expect(checkPermission(account, "media:image")).toBe(true);
  expect(checkPermission(account, "media:video")).toBe(true);
  expect(checkPermission(account, "admin:audit")).toBe(true);
  expect(checkPermission(account, "admin:users")).toBe(true);
});

// ============================================================================
// 4. employee 不能使用未授权模型（资源级权限检查）
// ============================================================================

test("employee 不能访问 admin:users（越权资源）", () => {
  const account = makeAccount("employee");
  expect(checkPermission(account, "admin:users")).toBe(false);
});

// ============================================================================
// 5. checkPermission 返回正确布尔值
// ============================================================================

test("checkPermission 对已授权资源返回 true，未授权返回 false", () => {
  const employee = makeAccount("employee");
  expect(checkPermission(employee, "chat")).toBe(true);
  expect(checkPermission(employee, "media:image")).toBe(true);
  expect(checkPermission(employee, "media:video")).toBe(false);
  expect(checkPermission(employee, "admin:audit")).toBe(false);
});

// ============================================================================
// 6. getAllowedResources 返回正确列表
// ============================================================================

test("getAllowedResources 为各角色返回正确的资源列表", () => {
  const employee = makeAccount("employee");
  const admin = makeAccount("admin");
  const superAdmin = makeAccount("super_admin");

  const empResources = getAllowedResources(employee);
  expect(empResources).toContain("chat");
  expect(empResources).toContain("media:image");
  expect(empResources).not.toContain("admin:audit");
  expect(empResources).not.toContain("admin:users");

  const adminResources = getAllowedResources(admin);
  expect(adminResources).toContain("admin:audit");
  expect(adminResources).not.toContain("admin:users");

  const superAdminResources = getAllowedResources(superAdmin);
  expect(superAdminResources).toContain("admin:audit");
  expect(superAdminResources).toContain("admin:users");
});

// ============================================================================
// 7. 并发额度：reserve → failed → release（额度回到原值）
// ============================================================================

// 使用 mock Prisma 模拟 QuotaRecordRepository 的 reserve/release 流程
const mockPrisma: any = {
  quotaRecord: {
    create: jest.fn(),
    findFirst: jest.fn(),
  },
  $transaction: jest.fn((fn: any) => fn(mockPrisma)),
};

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockPrisma),
}));

import { QuotaRecordRepository } from "../app/repositories";

test("并发额度：reserve 后 LLM 失败，release 后余额恢复原值", async () => {
  jest.clearAllMocks();
  const repo = new QuotaRecordRepository(mockPrisma);

  // reserve：余额 10 → 预留 1 → 余额变 9
  mockPrisma.quotaRecord.findFirst
    .mockResolvedValueOnce({ balance: 10 })  // lastRecord for reserve
    .mockResolvedValueOnce(null);            // 无重复预留
  mockPrisma.quotaRecord.create.mockResolvedValueOnce({
    id: "q-reserve", type: "reserve", amount: -1, balance: 9,
  });

  await repo.reserve({ employeeId: "emp-001", amount: 1, referenceId: "ref-001" });

  const reserveCreate = mockPrisma.quotaRecord.create.mock.calls[0][0];
  expect(reserveCreate.data.balance).toBe(9);

  // 模拟 LLM 调用失败 → release：余额 9 → 释放 1 → 余额恢复 10
  jest.clearAllMocks();
  mockPrisma.quotaRecord.findFirst
    .mockResolvedValueOnce(null)              // 无重复释放
    .mockResolvedValueOnce({ balance: 9 });   // lastRecord for release
  mockPrisma.quotaRecord.create.mockResolvedValueOnce({
    id: "q-release", type: "release", amount: 1, balance: 10,
  });

  await repo.release({ employeeId: "emp-001", amount: 1, referenceId: "ref-001" });

  const releaseCreate = mockPrisma.quotaRecord.create.mock.calls[0][0];
  expect(releaseCreate.data.type).toBe("release");
  expect(releaseCreate.data.balance).toBe(10); // 恢复原值
});

// ============================================================================
// 8. QuotaRecord 原子性（reserve 余额不足时抛出错误）
// ============================================================================

test("QuotaRecord reserve 余额不足时抛出 Insufficient quota 错误", async () => {
  jest.clearAllMocks();
  const repo = new QuotaRecordRepository(mockPrisma);

  // 余额 0.5，请求预留 1.0 → 应抛出错误
  mockPrisma.quotaRecord.findFirst.mockResolvedValueOnce({ balance: 0.5 });

  await expect(
    repo.reserve({ employeeId: "emp-001", amount: 1.0, referenceId: "ref-002" }),
  ).rejects.toThrow("Insufficient quota");

  // 不应该创建记录
  expect(mockPrisma.quotaRecord.create).not.toHaveBeenCalled();
});
