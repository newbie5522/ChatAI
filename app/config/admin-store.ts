import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs";
import path from "path";

import md5 from "spark-md5";

import type { EmployeeAccessRecord } from "./employee";

export type AdminProviderId = "openai" | "google" | "perplexity" | "anthropic";

export interface AdminProviderConfig {
  id: AdminProviderId;
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
  orgId?: string;
  enabledModels?: string[];
  updatedAt?: string;
}

export interface AdminStore {
  version: 1;
  employees: EmployeeAccessRecord[];
  providers: Partial<Record<AdminProviderId, AdminProviderConfig>>;
}

export interface ProviderPublicConfig {
  id: AdminProviderId;
  name: string;
  enabled: boolean;
  keyConfigured: boolean;
  keyPreview: string;
  baseUrl: string;
  apiVersion?: string;
  orgId?: string;
  enabledModels: string[];
  updatedAt?: string;
}

const PROVIDER_NAMES: Record<AdminProviderId, string> = {
  openai: "OpenAI",
  google: "Google Gemini",
  perplexity: "Perplexity",
  anthropic: "Anthropic Claude",
};

const PROVIDER_ENV: Record<
  AdminProviderId,
  {
    key?: keyof NodeJS.ProcessEnv;
    baseUrl?: keyof NodeJS.ProcessEnv;
    apiVersion?: keyof NodeJS.ProcessEnv;
    orgId?: keyof NodeJS.ProcessEnv;
  }
> = {
  openai: {
    key: "OPENAI_API_KEY",
    baseUrl: "BASE_URL",
    orgId: "OPENAI_ORG_ID",
  },
  google: {
    key: "GOOGLE_API_KEY",
    baseUrl: "GOOGLE_URL",
  },
  perplexity: {
    key: "PERPLEXITY_API_KEY",
    baseUrl: "PERPLEXITY_BASE_URL",
  },
  anthropic: {
    key: "ANTHROPIC_API_KEY",
    baseUrl: "ANTHROPIC_URL",
    apiVersion: "ANTHROPIC_API_VERSION",
  },
};

export const ADMIN_PROVIDER_IDS: AdminProviderId[] = [
  "openai",
  "google",
  "perplexity",
  "anthropic",
];

function getAdminConfigPath() {
  return (
    process.env.NEWBIE_ADMIN_CONFIG_PATH ||
    path.join(process.cwd(), ".data", "newbiechat-admin.json")
  );
}

function emptyStore(): AdminStore {
  return {
    version: 1,
    employees: [],
    providers: {},
  };
}

function normalizeStore(value: unknown): AdminStore {
  if (!value || typeof value !== "object") return emptyStore();

  const store = value as Partial<AdminStore>;
  return {
    version: 1,
    employees: Array.isArray(store.employees) ? store.employees : [],
    providers:
      store.providers && typeof store.providers === "object"
        ? store.providers
        : {},
  };
}

export function readAdminStore(): AdminStore {
  const filePath = getAdminConfigPath();
  if (!existsSync(filePath)) return emptyStore();

  try {
    return normalizeStore(JSON.parse(readFileSync(filePath, "utf8")));
  } catch (error) {
    console.error("[Admin Store] failed to read admin config", error);
    return emptyStore();
  }
}

export function writeAdminStore(store: AdminStore) {
  const filePath = getAdminConfigPath();
  mkdirSync(path.dirname(filePath), { recursive: true });

  const normalized = normalizeStore(store);
  const tempPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tempPath, JSON.stringify(normalized, null, 2), "utf8");
  renameSync(tempPath, filePath);
}

function now() {
  return new Date().toISOString();
}

function cleanList(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map(String)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeQuota(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeEmployeeRecord(
  record: Partial<EmployeeAccessRecord>,
): EmployeeAccessRecord {
  const id = String(record.id ?? "").trim();
  const name = String(record.name ?? id).trim() || id;

  if (!id) {
    throw new Error("employee id is required");
  }

  return {
    id,
    name,
    accessKey: undefined,
    accessKeyHash:
      record.accessKeyHash?.trim() ||
      (record.accessKey ? md5.hash(record.accessKey).toLowerCase() : undefined),
    status: String(record.status ?? "active").trim(),
    monthlyQuota: normalizeQuota(record.monthlyQuota),
    usedQuota: normalizeQuota(record.usedQuota),
    allowedProviders: cleanList(record.allowedProviders),
    allowedModels: cleanList(record.allowedModels),
    createdAt: record.createdAt || now(),
    updatedAt: now(),
    lastUsedAt: record.lastUsedAt,
  };
}

export function getAdminEmployeeRecords() {
  return readAdminStore().employees.map((record) =>
    normalizeEmployeeRecord(record),
  );
}

export function saveAdminEmployeeRecord(record: Partial<EmployeeAccessRecord>) {
  const store = readAdminStore();
  const normalized = normalizeEmployeeRecord(record);
  const index = store.employees.findIndex((item) => item.id === normalized.id);

  if (index >= 0) {
    store.employees[index] = {
      ...store.employees[index],
      ...normalized,
      createdAt: store.employees[index].createdAt || normalized.createdAt,
      updatedAt: now(),
    };
  } else {
    store.employees.push(normalized);
  }

  writeAdminStore(store);
  return normalized;
}

export function hasAdminEmployeeRecord(id: string) {
  return readAdminStore().employees.some((record) => record.id === id);
}

export function deleteAdminEmployeeRecord(id: string) {
  const store = readAdminStore();
  const nextEmployees = store.employees.filter((record) => record.id !== id);
  const deleted = nextEmployees.length !== store.employees.length;

  if (deleted) {
    writeAdminStore({
      ...store,
      employees: nextEmployees,
    });
  }

  return deleted;
}

export function getAdminProviderConfig(id: AdminProviderId) {
  const provider = readAdminStore().providers[id];
  return provider && provider.id === id ? provider : undefined;
}

export function saveAdminProviderConfig(
  id: AdminProviderId,
  config: Partial<AdminProviderConfig>,
) {
  const store = readAdminStore();
  const current = store.providers[id] ?? {
    id,
    enabled: true,
  };

  store.providers[id] = {
    ...current,
    ...config,
    id,
    enabled: config.enabled ?? current.enabled ?? true,
    updatedAt: now(),
  };

  writeAdminStore(store);
  return store.providers[id] as AdminProviderConfig;
}

function previewSecret(value?: string) {
  if (!value) return "";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function envValue(key?: keyof NodeJS.ProcessEnv) {
  return key ? process.env[key] ?? "" : "";
}

export function getEffectiveProviderSecret(id: AdminProviderId) {
  const adminConfig = getAdminProviderConfig(id);
  const envConfig = PROVIDER_ENV[id];
  return adminConfig?.apiKey || envValue(envConfig.key);
}

export function getEffectiveProviderBaseUrl(id: AdminProviderId) {
  const adminConfig = getAdminProviderConfig(id);
  const envConfig = PROVIDER_ENV[id];
  return adminConfig?.baseUrl || envValue(envConfig.baseUrl);
}

export function getEffectiveProviderApiVersion(id: AdminProviderId) {
  const adminConfig = getAdminProviderConfig(id);
  const envConfig = PROVIDER_ENV[id];
  return adminConfig?.apiVersion || envValue(envConfig.apiVersion);
}

export function getEffectiveProviderOrgId(id: AdminProviderId) {
  const adminConfig = getAdminProviderConfig(id);
  const envConfig = PROVIDER_ENV[id];
  return adminConfig?.orgId || envValue(envConfig.orgId);
}

export function isProviderEnabled(id: AdminProviderId) {
  const adminConfig = getAdminProviderConfig(id);
  return adminConfig?.enabled !== false;
}

export function getProviderEnabledModels(id: AdminProviderId) {
  const adminConfig = getAdminProviderConfig(id);
  return cleanList(adminConfig?.enabledModels);
}

export function isProviderModelEnabled(id: AdminProviderId, model: string) {
  const enabledModels = getProviderEnabledModels(id);
  if (enabledModels.length === 0 || !model || model === "unknown") return true;

  const normalizedModel = model.toLowerCase();
  return enabledModels.some((item) => item.toLowerCase() === normalizedModel);
}

export function listProviderPublicConfigs(): ProviderPublicConfig[] {
  return ADMIN_PROVIDER_IDS.map((id) => {
    const adminConfig = getAdminProviderConfig(id);
    const secret = getEffectiveProviderSecret(id);
    return {
      id,
      name: PROVIDER_NAMES[id],
      enabled: adminConfig?.enabled !== false,
      keyConfigured: !!secret,
      keyPreview: previewSecret(secret),
      baseUrl: getEffectiveProviderBaseUrl(id),
      apiVersion: getEffectiveProviderApiVersion(id),
      orgId: getEffectiveProviderOrgId(id),
      enabledModels: getProviderEnabledModels(id),
      updatedAt: adminConfig?.updatedAt,
    };
  });
}
