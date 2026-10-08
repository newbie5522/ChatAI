#!/usr/bin/env node
/**
 * V1 → V2 数据迁移脚本
 * 
 * 迁移策略（按用户批准的提案第2号）：
 * - ✅ 保留：员工账号、管理员账号、供应商 Key、额度配置
 * - ❌ 放弃：旧聊天记录、旧附件、旧媒体产物、旧用量明细
 * - 🔄 重置：当前月已使用额度清零（保留额度上限）
 * 
 * 数据来源：
 * - newbiechat-admin.json（账号 + 供应商 Key + 额度上限）
 * - 环境变量 EMPLOYEE_ACCESS_KEYS（员工凭证）
 * 
 * 目标：V2 PostgreSQL（Employee + QuotaRecord）
 * 
 * 执行方式：
 * ```bash
 * # 设置数据库连接
 * export DATABASE_URL="postgresql://user:pass@localhost:5432/newbiechat_v2"
 * 
 * # 设置 V1 数据路径（默认 .data/newbiechat-admin.json）
 * export V1_ADMIN_CONFIG_PATH=".data/newbiechat-admin.json"
 * 
 * # 执行迁移
 * yarn tsx scripts/migrate-v1-to-v2.ts
 * ```
 */

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";

const prisma = new PrismaClient();

// ============================================================================
// V1 数据类型定义
// ============================================================================

interface V1Account {
  id: string;
  name: string;
  role: "user" | "admin" | "super-admin";
  password?: string; // scrypt hash
  allowedModels?: string[];
  quotaLimit?: number; // 额度上限（元）
}

interface V1AdminConfig {
  accounts?: V1Account[];
  employees?: Array<{ id: string; accessKey: string }>; // 旧格式
  credentials?: Array<{ provider: string; apiKey: string }>;
  providers?: Record<string, any>;
  models?: any[];
}

// ============================================================================
// 数据加载
// ============================================================================

function loadV1Config(configPath: string): V1AdminConfig {
  try {
    const content = readFileSync(configPath, "utf-8");
    return JSON.parse(content);
  } catch (error: any) {
    console.error(`❌ 无法读取 V1 配置文件: ${configPath}`);
    console.error(`   错误: ${error.message}`);
    throw error;
  }
}

function loadEmployeeAccessKeys(): Record<string, string> | null {
  const envValue = process.env.EMPLOYEE_ACCESS_KEYS || process.env.COMPANY_EMPLOYEE_KEYS;
  if (!envValue) return null;

  try {
    // 尝试 JSON 数组
    const parsed = JSON.parse(envValue);
    if (Array.isArray(parsed)) {
      return Object.fromEntries(parsed.map((key: string, idx: number) => [`employee-${idx}`, key]));
    }
    // 尝试 JSON 对象
    if (typeof parsed === "object") {
      return parsed as Record<string, string>;
    }
  } catch {
    // 逗号分隔字符串
    return Object.fromEntries(
      envValue.split(",").map((key, idx) => [`employee-${idx}`, key.trim()]),
    );
  }

  return null;
}

// ============================================================================
// 迁移逻辑
// ============================================================================

async function migrateAccounts(accounts: V1Account[]): Promise<void> {
  console.log(`\n📦 迁移 ${accounts.length} 个员工账号...`);

  for (const account of accounts) {
    // 检查是否已存在
    const existing = await prisma.employee.findUnique({
      where: { id: account.id },
    });

    if (existing) {
      console.log(`  ⏭️  ${account.name} (${account.id}) 已存在，跳过`);
      continue;
    }

    await prisma.employee.create({
      data: {
        id: account.id,
        name: account.name,
        role: account.role,
      },
    });

    console.log(`  ✅ ${account.name} (${account.id}) - ${account.role}`);
  }
}

async function initializeQuotas(accounts: V1Account[]): Promise<void> {
  console.log(`\n💰 初始化员工额度...`);

  for (const account of accounts) {
    // 检查是否已有额度记录
    const existing = await prisma.quotaRecord.findFirst({
      where: { employeeId: account.id },
    });

    if (existing) {
      console.log(`  ⏭️  ${account.name} 已有额度记录，跳过`);
      continue;
    }

    const quotaLimit = account.quotaLimit ?? 100.0; // 默认 100 元

    // 创建初始额度记录（当前月清零，从 0 开始）
    await prisma.quotaRecord.create({
      data: {
        employeeId: account.id,
        type: "reserve", // 初始化记录
        amount: 0,
        balance: quotaLimit,
        referenceId: `migration-init-${account.id}`,
      },
    });

    console.log(`  ✅ ${account.name} - 初始额度: ${quotaLimit} 元`);
  }
}

async function printMigrationSummary(config: V1AdminConfig): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("📊 迁移摘要");
  console.log("=".repeat(60));

  const employeeCount = await prisma.employee.count();
  console.log(`\n✅ 已迁移项目：`);
  console.log(`   - 员工账号: ${employeeCount} 个`);

  console.log(`\n❌ 放弃项目（按用户批准）：`);
  console.log(`   - 旧聊天记录（V1 localStorage）`);
  console.log(`   - 旧附件与媒体产物`);
  console.log(`   - 旧用量明细`);

  console.log(`\n📝 额外保留项（需手动处理）：`);
  console.log(`   - 供应商 API Key: ${config.credentials?.length ?? 0} 个`);
  console.log(`   - Provider 配置: ${Object.keys(config.providers ?? {}).length} 个`);
  console.log(`   - 模型配置: ${config.models?.length ?? 0} 个`);
  console.log(`   ⚠️  这些配置仍在 V1 admin.json 中，V2 暂未迁移`);

  console.log(`\n⏰ 切换时间点: ${new Date().toISOString()}`);
  console.log(`   从此时刻起，当前月已使用额度清零`);
}

// ============================================================================
// 主流程
// ============================================================================

async function main() {
  console.log("=" .repeat(60));
  console.log("🚀 NewbieChat V1 → V2 数据迁移");
  console.log("=".repeat(60));

  // 1. 加载 V1 配置
  const configPath = process.env.V1_ADMIN_CONFIG_PATH || ".data/newbiechat-admin.json";
  console.log(`\n📂 V1 配置路径: ${configPath}`);

  const config = loadV1Config(configPath);
  const accounts = config.accounts ?? [];

  if (accounts.length === 0) {
    console.log(`\n⚠️  警告: 未找到任何账号，请检查配置文件`);
    return;
  }

  console.log(`   找到 ${accounts.length} 个账号`);

  // 2. 加载环境变量员工凭证
  const envKeys = loadEmployeeAccessKeys();
  if (envKeys) {
    console.log(`   环境变量员工凭证: ${Object.keys(envKeys).length} 个`);
    console.log(`   ⚠️  这些凭证使用 md5 哈希，无法迁移到 V2`);
    console.log(`   建议：保留 V1 验证通道，用户下次登录时升级哈希`);
  }

  // 3. 确认继续
  console.log(`\n⚠️  即将开始迁移，当前 V2 数据库将被写入新数据`);
  console.log(`   DATABASE_URL: ${process.env.DATABASE_URL || "(未设置)"}`);
  console.log(`\n   按 Ctrl+C 取消，或等待 5 秒后自动继续...`);
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // 4. 执行迁移
  try {
    await migrateAccounts(accounts);
    await initializeQuotas(accounts);
    await printMigrationSummary(config);

    console.log("\n" + "=".repeat(60));
    console.log("✅ 迁移完成！");
    console.log("=".repeat(60));
  } catch (error: any) {
    console.error("\n❌ 迁移失败:");
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// 执行
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
