import md5 from "spark-md5";

import { ModelProvider, ServiceProvider } from "../constant";

export type EmployeeAccessStatus =
  | "active"
  | "enabled"
  | "disabled"
  | "inactive";

export interface EmployeeAccessRecord {
  id: string;
  name: string;
  accessKey?: string;
  accessKeyHash?: string;
  status?: EmployeeAccessStatus | string;
  monthlyQuota?: number;
  usedQuota?: number;
  allowedProviders?: string[];
  allowedModels?: string[];
  createdAt?: string;
  updatedAt?: string;
  lastUsedAt?: string;
}

export type SafeEmployeeAccessRecord = Omit<
  EmployeeAccessRecord,
  "accessKey" | "accessKeyHash"
>;

export interface EmployeeAccessValidation {
  ok: boolean;
  reason?: string;
  employee?: SafeEmployeeAccessRecord;
}

export interface ValidationOptions {
  modelProvider?: ModelProvider;
  model?: string;
}

function getRawEmployeeConfig() {
  return (
    process.env.EMPLOYEE_ACCESS_KEYS ??
    process.env.COMPANY_EMPLOYEE_KEYS ??
    ""
  ).trim();
}

function toStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map(String)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function toNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeRecord(
  value: unknown,
  index: number,
  idFromMap?: string,
): EmployeeAccessRecord | null {
  if (typeof value === "string") {
    const id = idFromMap ?? `employee-${index + 1}`;
    return {
      id,
      name: id,
      accessKey: value.trim(),
      status: "active",
    };
  }

  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const id = String(record.id ?? idFromMap ?? `employee-${index + 1}`).trim();
  const name = String(record.name ?? id).trim();

  if (!id) return null;

  return {
    id,
    name,
    accessKey:
      typeof record.accessKey === "string" ? record.accessKey.trim() : "",
    accessKeyHash:
      typeof record.accessKeyHash === "string"
        ? record.accessKeyHash.trim()
        : "",
    status: String(record.status ?? "active").trim(),
    monthlyQuota: toNumber(record.monthlyQuota),
    usedQuota: toNumber(record.usedQuota),
    allowedProviders: toStringArray(record.allowedProviders),
    allowedModels: toStringArray(record.allowedModels),
    createdAt:
      typeof record.createdAt === "string" ? record.createdAt.trim() : "",
    updatedAt:
      typeof record.updatedAt === "string" ? record.updatedAt.trim() : "",
    lastUsedAt:
      typeof record.lastUsedAt === "string" ? record.lastUsedAt.trim() : "",
  };
}

export function getEmployeeAccessRecords(): EmployeeAccessRecord[] {
  const rawConfig = getRawEmployeeConfig();
  if (!rawConfig) return [];

  try {
    const parsed = JSON.parse(rawConfig) as unknown;

    if (Array.isArray(parsed)) {
      return parsed
        .map((value, index) => normalizeRecord(value, index))
        .filter((record): record is EmployeeAccessRecord => !!record);
    }

    if (parsed && typeof parsed === "object") {
      return Object.entries(parsed as Record<string, unknown>)
        .map(([id, value], index) => normalizeRecord(value, index, id))
        .filter((record): record is EmployeeAccessRecord => !!record);
    }
  } catch {
    // Fall back to a simple comma-separated list for quick MVP deployments.
  }

  return rawConfig
    .split(",")
    .map((value, index) => normalizeRecord(value, index))
    .filter((record): record is EmployeeAccessRecord => !!record);
}

export function hasEmployeeAccessControl() {
  return getEmployeeAccessRecords().length > 0;
}

export function getEmployeeAccessCount() {
  return getEmployeeAccessRecords().length;
}

function getRecordHash(record: EmployeeAccessRecord) {
  if (record.accessKeyHash) return record.accessKeyHash.toLowerCase();
  if (record.accessKey) return md5.hash(record.accessKey).toLowerCase();
  return "";
}

function isRecordEnabled(record: EmployeeAccessRecord) {
  const status = String(record.status ?? "active").toLowerCase();
  return !["disabled", "inactive", "revoked", "deleted", "false", "0"].includes(
    status,
  );
}

function toSafeRecord(record: EmployeeAccessRecord): SafeEmployeeAccessRecord {
  const {
    accessKey: _accessKey,
    accessKeyHash: _accessKeyHash,
    ...safe
  } = record;
  return safe;
}

function allowedProviderNames(modelProvider: ModelProvider) {
  switch (modelProvider) {
    case ModelProvider.GPT:
      return [ServiceProvider.OpenAI, ModelProvider.GPT];
    case ModelProvider.GeminiPro:
      return [ServiceProvider.Google, ModelProvider.GeminiPro];
    case ModelProvider.Perplexity:
      return [ServiceProvider.Perplexity, ModelProvider.Perplexity];
    case ModelProvider.Claude:
      return [ServiceProvider.Anthropic, ModelProvider.Claude];
    default:
      return [modelProvider];
  }
}

function isAllowed(value: string, allowedValues: string[]) {
  if (allowedValues.length === 0) return true;
  const normalized = value.toLowerCase();
  return allowedValues.some((allowed) => allowed.toLowerCase() === normalized);
}

export function validateEmployeeAccessKey(
  accessKey: string,
  options: ValidationOptions = {},
): EmployeeAccessValidation {
  const records = getEmployeeAccessRecords();
  if (records.length === 0) {
    return {
      ok: false,
      reason: "employee access is not configured",
    };
  }

  const cleanKey = accessKey.trim();
  if (!cleanKey) {
    return {
      ok: false,
      reason: "empty employee access key",
    };
  }

  const hashedKey = md5.hash(cleanKey).toLowerCase();
  const record = records.find((item) => getRecordHash(item) === hashedKey);

  if (!record) {
    return {
      ok: false,
      reason: "wrong employee access key",
    };
  }

  if (!isRecordEnabled(record)) {
    return {
      ok: false,
      reason: "employee access key is disabled",
    };
  }

  if (options.modelProvider) {
    const providerAllowed = allowedProviderNames(options.modelProvider).some(
      (provider) => isAllowed(provider, record.allowedProviders ?? []),
    );
    if (!providerAllowed) {
      return {
        ok: false,
        reason: "employee access key is not allowed for this provider",
      };
    }
  }

  if (options.model && !isAllowed(options.model, record.allowedModels ?? [])) {
    return {
      ok: false,
      reason: "employee access key is not allowed for this model",
    };
  }

  return {
    ok: true,
    employee: toSafeRecord(record),
  };
}
