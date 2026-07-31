import { randomUUID } from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";

import type { ModelCategory } from "./model-registry";
import type { SafeAccountRecord } from "./admin-store";

export type UsageStatus = "success" | "failed" | "blocked";

export interface UsageLogRecord {
  id: string;
  accountId: string;
  username: string;
  role: string;
  provider: string;
  modelId: string;
  model: string;
  category: ModelCategory;
  promptPreview: string;
  promptContent?: string;
  inputTokens?: number;
  usageUnits?: number;
  quotaUnits?: number;
  status: UsageStatus;
  errorMessage?: string;
  httpStatus?: number;
  requestPath?: string;
  month: string;
  createdAt: string;
}

export interface UsageSummary {
  accountId: string;
  username: string;
  name?: string;
  role: string;
  month: string;
  quotaUnlimited: boolean;
  monthlyChatTurns?: number;
  monthlySearchTurns?: number;
  monthlyImageCount?: number;
  monthlyVideoCount?: number;
  usedChatTurns: number;
  usedSearchTurns: number;
  usedImageCount: number;
  usedVideoCount: number;
  requestCount: number;
  successCount: number;
  failedCount: number;
  blockedCount: number;
  inputTokens: number;
}

interface UsageStore {
  version: 2;
  records: UsageLogRecord[];
}

type UsageRecordInput = Omit<UsageLogRecord, "id" | "createdAt" | "month"> & {
  createdAt?: string;
};

const DEFAULT_USAGE_LOG_PATH = path.join(
  process.cwd(),
  ".data",
  "newbiechat-usage.json",
);

let writeQueue = Promise.resolve();

function getUsageLogPath() {
  return process.env.NEWBIE_USAGE_LOG_PATH || DEFAULT_USAGE_LOG_PATH;
}

function getMaxRecords() {
  const parsed = Number(process.env.USAGE_LOG_MAX_RECORDS ?? 20000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20000;
}

export function getMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}`;
}

function emptyStore(): UsageStore {
  return {
    version: 2,
    records: [],
  };
}

function normalizeRecord(record: Partial<UsageLogRecord>): UsageLogRecord {
  const createdAt = record.createdAt ?? new Date().toISOString();
  const legacy = record as Record<string, unknown>;
  const status = String(record.status ?? "failed");
  return {
    id: record.id || randomUUID(),
    accountId: String(record.accountId ?? legacy.employeeId ?? ""),
    username: String(record.username ?? legacy.employeeName ?? ""),
    role: String(record.role ?? "employee"),
    provider: String(record.provider ?? ""),
    modelId: String(record.modelId ?? ""),
    model: String(record.model ?? "unknown"),
    category: (record.category ?? "chat") as ModelCategory,
    promptPreview: String(record.promptPreview ?? ""),
    promptContent:
      typeof record.promptContent === "string"
        ? record.promptContent.slice(0, 12000)
        : undefined,
    inputTokens: Number(record.inputTokens ?? 0),
    usageUnits: Number(record.usageUnits ?? 0),
    quotaUnits: Number(record.quotaUnits ?? 0),
    status: ["success", "failed", "blocked"].includes(status)
      ? (status as UsageStatus)
      : "failed",
    errorMessage: record.errorMessage?.slice(0, 1000),
    httpStatus: record.httpStatus,
    requestPath: record.requestPath,
    month: record.month || getMonthKey(new Date(createdAt)),
    createdAt,
  };
}

async function readStoreUnsafe(): Promise<UsageStore> {
  try {
    const raw = await readFile(getUsageLogPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<UsageStore>;
    return {
      version: 2,
      records: Array.isArray(parsed.records)
        ? parsed.records.map((record) => normalizeRecord(record))
        : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyStore();
    }
    throw error;
  }
}

async function writeStoreUnsafe(store: UsageStore) {
  const filePath = getUsageLogPath();
  await mkdir(path.dirname(filePath), { recursive: true });

  const maxRecords = getMaxRecords();
  const trimmedStore: UsageStore = {
    version: 2,
    records: store.records.slice(-maxRecords),
  };

  const tempPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tempPath, JSON.stringify(trimmedStore, null, 2), "utf8");
  await rename(tempPath, filePath);
}

function enqueueWrite<T>(task: () => Promise<T>) {
  const run = writeQueue.then(task, task);
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function readUsageRecords() {
  const store = await readStoreUnsafe();
  return store.records;
}

export async function appendUsageRecord(input: UsageRecordInput) {
  return enqueueWrite(async () => {
    const record = normalizeRecord({
      ...input,
      id: randomUUID(),
      createdAt: input.createdAt ?? new Date().toISOString(),
    });

    const store = await readStoreUnsafe();
    store.records.push(record);
    await writeStoreUnsafe(store);

    return record;
  });
}

export function estimateTokensFromBody(bodyText?: string) {
  if (!bodyText?.trim()) return 0;
  return Math.max(1, Math.ceil(bodyText.length / 4));
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export function extractPromptFromBody(bodyText?: string) {
  if (!bodyText) return "";

  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    const prompt = textFromContent(parsed.prompt);
    if (prompt) return prompt;

    const input = textFromContent(parsed.input);
    if (input) return input;

    if (Array.isArray(parsed.messages)) {
      const userMessages = parsed.messages
        .filter(
          (message) =>
            message &&
            typeof message === "object" &&
            (message as { role?: string }).role === "user",
        )
        .map((message) =>
          textFromContent((message as { content?: unknown }).content),
        )
        .filter(Boolean);
      return userMessages.at(-1) ?? "";
    }

    if (Array.isArray(parsed.contents)) {
      const userContents = parsed.contents
        .filter(
          (content) =>
            content &&
            typeof content === "object" &&
            (content as { role?: string }).role !== "model",
        )
        .map((content) =>
          textFromContent((content as { parts?: unknown }).parts),
        )
        .filter(Boolean);
      return userContents.at(-1) ?? "";
    }
    return "";
  } catch {
    return "";
  }
}

export function sanitizePromptForLog(prompt: string) {
  return prompt
    .replace(/\[附件开始\]([\s\S]*?)\[附件结束\]/g, (_match, block) => {
      const name = String(block)
        .match(/文件名：([^\n\r]+)/)?.[1]
        ?.trim();
      const type = String(block)
        .match(/文件类型：([^\n\r]+)/)?.[1]
        ?.trim();
      return `[附件：${name || "未命名"}${type ? `（${type}）` : ""}]`;
    })
    .replace(/data:image\/[^;]+;base64,[a-z0-9+/_=-]+/gi, "[图片数据已省略]")
    .replace(/(?:https?|blob):\/\/[^\s"'<>]+/gi, "[链接已省略]")
    .slice(0, 12000);
}

export function extractModelFromGatewayRequest(
  provider: string,
  requestPath: string,
  bodyText?: string,
) {
  if (bodyText) {
    try {
      const parsed = JSON.parse(bodyText) as { model?: unknown };
      if (typeof parsed.model === "string" && parsed.model.trim()) {
        return parsed.model.trim();
      }
    } catch {
      // Keep usage logging resilient for malformed requests.
    }
  }

  if (provider === "google") {
    const match = requestPath.match(/models\/([^/:]+)(?::|\/|$)/);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }

  return "";
}

function getMonthlyRecords(
  records: UsageLogRecord[],
  accountId: string,
  month = getMonthKey(),
) {
  return records.filter(
    (record) => record.accountId === accountId && record.month === month,
  );
}

export async function getAccountUsageSummary(
  account: SafeAccountRecord,
  month = getMonthKey(),
): Promise<UsageSummary> {
  const records = getMonthlyRecords(
    await readUsageRecords(),
    account.id,
    month,
  );
  const successfulRecords = records.filter(
    (record) => record.status === "success" && record.usageUnits === 1,
  );
  const usedByCategory = (category: ModelCategory) =>
    successfulRecords.filter((record) => record.category === category).length;

  return {
    accountId: account.id,
    username: account.username,
    name: account.name,
    role: account.role,
    month,
    quotaUnlimited: account.quotaUnlimited,
    monthlyChatTurns: account.monthlyChatTurns,
    monthlySearchTurns: account.monthlySearchTurns,
    monthlyImageCount: account.monthlyImageCount,
    monthlyVideoCount: account.monthlyVideoCount,
    usedChatTurns: usedByCategory("chat"),
    usedSearchTurns: usedByCategory("search"),
    usedImageCount: usedByCategory("image"),
    usedVideoCount: usedByCategory("video"),
    requestCount: records.length,
    successCount: successfulRecords.length,
    failedCount: records.filter((record) => record.status === "failed").length,
    blockedCount: records.filter((record) => record.status === "blocked")
      .length,
    inputTokens: records.reduce(
      (sum, record) => sum + Number(record.inputTokens ?? 0),
      0,
    ),
  };
}

export async function listAccountUsageRecords(
  accountId?: string,
  month = getMonthKey(),
  limit = 200,
) {
  const records = (await readUsageRecords()).filter(
    (record) =>
      (!accountId || record.accountId === accountId) && record.month === month,
  );
  return records.slice(-limit).reverse();
}

function categoryLimit(account: SafeAccountRecord, category: ModelCategory) {
  if (category === "chat") return account.monthlyChatTurns;
  if (category === "search") return account.monthlySearchTurns;
  if (category === "image") return account.monthlyImageCount;
  return account.monthlyVideoCount;
}

function categoryUsage(summary: UsageSummary, category: ModelCategory) {
  if (category === "chat") return summary.usedChatTurns;
  if (category === "search") return summary.usedSearchTurns;
  if (category === "image") return summary.usedImageCount;
  return summary.usedVideoCount;
}

export async function checkCategoryQuota(
  account: SafeAccountRecord | undefined,
  category: ModelCategory,
) {
  if (!account || account.role === "admin" || account.role === "super_admin") {
    return {
      allowed: true,
      category,
      used: 0,
    };
  }

  const summary = await getAccountUsageSummary(account);
  if (account.quotaUnlimited) {
    return {
      allowed: true,
      category,
      used: categoryUsage(summary, category),
    };
  }

  const limit = categoryLimit(account, category) ?? 0;
  const used = categoryUsage(summary, category);
  return {
    allowed: used < limit,
    category,
    limit,
    used,
    remaining: Math.max(0, limit - used),
  };
}
