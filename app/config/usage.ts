import { randomUUID } from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";

import { SafeEmployeeAccessRecord } from "./employee";

export type UsageStatus =
  | "success"
  | "failed"
  | "auth_failed"
  | "quota_exceeded";

export interface UsageRecord {
  id: string;
  employeeId: string;
  employeeName?: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  quotaUnits: number;
  status: UsageStatus;
  httpStatus?: number;
  errorMessage?: string;
  requestPath?: string;
  month: string;
  createdAt: string;
}

export interface UsageSummary {
  employeeId: string;
  employeeName?: string;
  month: string;
  monthlyQuota?: number;
  usedQuota: number;
  remainingQuota?: number;
  requestCount: number;
  successCount: number;
  failedCount: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

interface UsageStore {
  version: 1;
  records: UsageRecord[];
}

type UsageRecordInput = Omit<UsageRecord, "id" | "createdAt" | "month"> & {
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
    version: 1,
    records: [],
  };
}

async function readStoreUnsafe(): Promise<UsageStore> {
  try {
    const raw = await readFile(getUsageLogPath(), "utf8");
    const parsed = JSON.parse(raw) as UsageStore;
    return {
      version: 1,
      records: Array.isArray(parsed.records) ? parsed.records : [],
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
    version: 1,
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
    const createdAt = input.createdAt ?? new Date().toISOString();
    const record: UsageRecord = {
      ...input,
      id: randomUUID(),
      createdAt,
      month: getMonthKey(new Date(createdAt)),
      errorMessage: input.errorMessage?.slice(0, 1000),
    };

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

export function extractModelFromGatewayRequest(
  provider: string,
  requestPath: string,
  bodyText?: string,
) {
  if (provider === "google") {
    const match = requestPath.match(/models\/([^/:]+)(?::|\/|$)/);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }

  if (!bodyText) return "unknown";

  try {
    const parsed = JSON.parse(bodyText) as { model?: unknown };
    if (typeof parsed.model === "string" && parsed.model.trim()) {
      return parsed.model.trim();
    }
  } catch {
    // Keep usage logging resilient for malformed requests.
  }

  return "unknown";
}

function quotaSeed(employee?: SafeEmployeeAccessRecord) {
  const usedQuota = Number(employee?.usedQuota ?? 0);
  return Number.isFinite(usedQuota) && usedQuota > 0 ? usedQuota : 0;
}

function quotaLimit(employee?: SafeEmployeeAccessRecord) {
  const monthlyQuota = Number(employee?.monthlyQuota ?? 0);
  return Number.isFinite(monthlyQuota) && monthlyQuota > 0
    ? monthlyQuota
    : undefined;
}

function getMonthlyRecords(
  records: UsageRecord[],
  employeeId: string,
  month = getMonthKey(),
) {
  return records.filter(
    (record) => record.employeeId === employeeId && record.month === month,
  );
}

export async function getEmployeeUsageSummary(
  employee: SafeEmployeeAccessRecord,
  month = getMonthKey(),
): Promise<UsageSummary> {
  const records = getMonthlyRecords(
    await readUsageRecords(),
    employee.id,
    month,
  );
  const successfulRecords = records.filter(
    (record) => record.status === "success",
  );
  const usedQuota =
    quotaSeed(employee) +
    successfulRecords.reduce((sum, record) => sum + record.quotaUnits, 0);
  const monthlyQuota = quotaLimit(employee);
  const inputTokens = records.reduce(
    (sum, record) => sum + record.inputTokens,
    0,
  );
  const outputTokens = records.reduce(
    (sum, record) => sum + record.outputTokens,
    0,
  );
  const estimatedCost = records.reduce(
    (sum, record) => sum + record.estimatedCost,
    0,
  );

  return {
    employeeId: employee.id,
    employeeName: employee.name,
    month,
    monthlyQuota,
    usedQuota,
    remainingQuota:
      monthlyQuota === undefined
        ? undefined
        : Math.max(0, monthlyQuota - usedQuota),
    requestCount: records.length,
    successCount: successfulRecords.length,
    failedCount: records.length - successfulRecords.length,
    inputTokens,
    outputTokens,
    estimatedCost,
  };
}

export async function listEmployeeUsageRecords(
  employeeId: string,
  month = getMonthKey(),
  limit = 100,
) {
  const records = getMonthlyRecords(
    await readUsageRecords(),
    employeeId,
    month,
  );
  return records.slice(-limit).reverse();
}

export async function checkMonthlyQuota(
  employee: SafeEmployeeAccessRecord | undefined,
  requestedQuotaUnits: number,
) {
  if (!employee) {
    return {
      allowed: true,
      usedQuota: 0,
      requestedQuotaUnits,
    };
  }

  const summary = await getEmployeeUsageSummary(employee);
  if (summary.monthlyQuota === undefined) {
    return {
      allowed: true,
      usedQuota: summary.usedQuota,
      requestedQuotaUnits,
    };
  }

  return {
    allowed: summary.usedQuota + requestedQuotaUnits <= summary.monthlyQuota,
    monthlyQuota: summary.monthlyQuota,
    usedQuota: summary.usedQuota,
    requestedQuotaUnits,
    remainingQuota: Math.max(0, summary.monthlyQuota - summary.usedQuota),
  };
}
