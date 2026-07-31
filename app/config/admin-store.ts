import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs";
import path from "path";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "crypto";

import md5 from "spark-md5";

import type { EmployeeAccessRecord } from "./employee";
import {
  CompanyModel,
  DEFAULT_COMPANY_MODELS,
  ModelCategory,
  ModelProvider,
  findCompanyModelByProviderModel,
  mergeCompanyModels,
  normalizeCompanyModel,
  toCompanyLLMModel,
} from "./model-registry";

export type AdminProviderId = ModelProvider;
export type AccountRole = "employee" | "admin" | "super_admin";
export type AccountStatus = "active" | "disabled" | "deleted";

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

export interface AccountRecord {
  id: string;
  username: string;
  name: string;
  role: AccountRole;
  passwordHash: string;
  status: AccountStatus;
  monthlyQuota?: number;
  usedQuota?: number;
  allowedModelIds: string[];
  allowedCategories: ModelCategory[];
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export type SafeAccountRecord = Omit<AccountRecord, "passwordHash">;

export interface ProviderCredential {
  id: string;
  provider: ModelProvider;
  name: string;
  apiKey: string;
  baseUrl?: string;
  apiVersion?: string;
  orgId?: string;
  categoryScope: ModelCategory | "all";
  modelIds?: string[];
  enabled: boolean;
  verified: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export type PublicProviderCredential = Omit<ProviderCredential, "apiKey"> & {
  keyConfigured: boolean;
  keyPreview: string;
};

export interface AdminStore {
  version: 2;
  employees: EmployeeAccessRecord[];
  providers: Partial<Record<AdminProviderId, AdminProviderConfig>>;
  accounts: AccountRecord[];
  credentials: ProviderCredential[];
  models: CompanyModel[];
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

export interface AccountSessionUser {
  userId: string;
  username: string;
  name: string;
  role: AccountRole;
  allowedModelIds: string[];
  allowedCategories: ModelCategory[];
  monthlyQuota?: number;
  usedQuota?: number;
}

const PROVIDER_NAMES: Record<AdminProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  perplexity: "Perplexity",
  xai: "xAI",
  deepseek: "DeepSeek",
  qwen: "Qwen",
  mistral: "Mistral",
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
  xai: {},
  deepseek: {},
  qwen: {},
  mistral: {},
};

export const ADMIN_PROVIDER_IDS: AdminProviderId[] = [
  "openai",
  "anthropic",
  "google",
  "perplexity",
  "xai",
  "deepseek",
  "qwen",
  "mistral",
];

const MODEL_CATEGORY_IDS: ModelCategory[] = [
  "chat",
  "image",
  "search",
  "video",
];

function getAdminConfigPath() {
  return (
    process.env.NEWBIE_ADMIN_CONFIG_PATH ||
    path.join(process.cwd(), ".data", "newbiechat-admin.json")
  );
}

function now() {
  return new Date().toISOString();
}

function emptyStore(): AdminStore {
  return {
    version: 2,
    employees: [],
    providers: {},
    accounts: [],
    credentials: [],
    models: DEFAULT_COMPANY_MODELS.map((model) => ({ ...model })),
  };
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

function cleanCategories(value: unknown): ModelCategory[] {
  return cleanList(value).filter((item): item is ModelCategory =>
    MODEL_CATEGORY_IDS.includes(item as ModelCategory),
  );
}

function normalizeQuota(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function normalizeStatus(value: unknown): AccountStatus {
  const status = String(value ?? "active").toLowerCase();
  if (status === "disabled") return "disabled";
  if (status === "deleted") return "deleted";
  return "active";
}

function normalizeRole(value: unknown): AccountRole {
  const role = String(value ?? "employee").toLowerCase();
  if (role === "super_admin") return "super_admin";
  if (role === "admin") return "admin";
  return "employee";
}

function normalizeProvider(value: unknown): ModelProvider {
  const provider = String(value ?? "openai").toLowerCase() as ModelProvider;
  return ADMIN_PROVIDER_IDS.includes(provider) ? provider : "openai";
}

function normalizeCategoryScope(value: unknown): ModelCategory | "all" {
  const category = String(value ?? "all").toLowerCase();
  if (category === "all") return "all";
  return MODEL_CATEGORY_IDS.includes(category as ModelCategory)
    ? (category as ModelCategory)
    : "all";
}

function normalizeAccountRecord(record: Partial<AccountRecord>): AccountRecord {
  const id = String(record.id ?? "").trim() || randomUUID();
  const username = String(record.username ?? id).trim();
  const name = String(record.name ?? username).trim() || username;

  if (!username) {
    throw new Error("username is required");
  }

  return {
    id,
    username,
    name,
    role: normalizeRole(record.role),
    passwordHash: String(record.passwordHash ?? "").trim(),
    status: normalizeStatus(record.status),
    monthlyQuota: normalizeQuota(record.monthlyQuota),
    usedQuota: normalizeQuota(record.usedQuota),
    allowedModelIds: cleanList(record.allowedModelIds),
    allowedCategories: cleanCategories(record.allowedCategories),
    createdAt: record.createdAt || now(),
    updatedAt: record.updatedAt || now(),
    lastLoginAt: record.lastLoginAt,
  };
}

function normalizeCredentialRecord(
  record: Partial<ProviderCredential>,
): ProviderCredential {
  const provider = normalizeProvider(record.provider);
  const id = String(record.id ?? "").trim() || `cred-${randomUUID()}`;
  const name = String(record.name ?? PROVIDER_NAMES[provider]).trim() || id;
  const priority = Number(record.priority);

  return {
    id,
    provider,
    name,
    apiKey: String(record.apiKey ?? "").trim(),
    baseUrl: String(record.baseUrl ?? "").trim(),
    apiVersion: String(record.apiVersion ?? "").trim(),
    orgId: String(record.orgId ?? "").trim(),
    categoryScope: normalizeCategoryScope(record.categoryScope),
    modelIds: cleanList(record.modelIds),
    enabled: record.enabled ?? true,
    verified: record.verified ?? false,
    priority: Number.isFinite(priority) ? priority : 100,
    createdAt: record.createdAt || now(),
    updatedAt: record.updatedAt || now(),
  };
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

function normalizeStore(value: unknown): AdminStore {
  if (!value || typeof value !== "object") return emptyStore();

  const store = value as Partial<AdminStore>;
  return {
    version: 2,
    employees: Array.isArray(store.employees) ? store.employees : [],
    providers:
      store.providers && typeof store.providers === "object"
        ? store.providers
        : {},
    accounts: Array.isArray(store.accounts)
      ? store.accounts
          .map((record) => normalizeAccountRecord(record))
          .filter((record) => !!record.username)
      : [],
    credentials: Array.isArray(store.credentials)
      ? store.credentials.map((record) => normalizeCredentialRecord(record))
      : [],
    models: mergeCompanyModels(Array.isArray(store.models) ? store.models : []),
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

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [scheme, salt, expected] = storedHash.split(":");
  if (scheme !== "scrypt" || !salt || !expected) return false;

  try {
    const actual = Buffer.from(scryptSync(password, salt, 64).toString("hex"));
    const expectedBuffer = Buffer.from(expected);
    return (
      actual.length === expectedBuffer.length &&
      timingSafeEqual(actual, expectedBuffer)
    );
  } catch {
    return false;
  }
}

export function ensureBootstrapSuperAdmin() {
  const store = readAdminStore();
  if (store.accounts.some((account) => account.role === "super_admin")) {
    return store;
  }

  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!password.trim()) return store;

  const username = (process.env.ADMIN_USERNAME || "admin").trim() || "admin";
  const timestamp = now();
  store.accounts.push({
    id: "super-admin",
    username,
    name: username,
    role: "super_admin",
    passwordHash: hashPassword(password),
    status: "active",
    monthlyQuota: undefined,
    usedQuota: 0,
    allowedModelIds: [],
    allowedCategories: ["chat", "search"],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  writeAdminStore(store);
  return store;
}

export function toSafeAccount(record: AccountRecord): SafeAccountRecord {
  const { passwordHash: _passwordHash, ...safe } = record;
  return safe;
}

export function toSessionUser(record: SafeAccountRecord): AccountSessionUser {
  return {
    userId: record.id,
    username: record.username,
    name: record.name,
    role: record.role,
    allowedModelIds: record.allowedModelIds,
    allowedCategories: record.allowedCategories,
    monthlyQuota: record.monthlyQuota,
    usedQuota: record.usedQuota,
  };
}

export function getAccountRecords() {
  return ensureBootstrapSuperAdmin()
    .accounts.map((record) => normalizeAccountRecord(record))
    .filter((record) => record.status !== "deleted");
}

export function findAccountById(id: string) {
  return getAccountRecords().find((account) => account.id === id);
}

export function findAccountByUsername(username: string) {
  const normalized = username.trim().toLowerCase();
  return ensureBootstrapSuperAdmin()
    .accounts.map((account) => normalizeAccountRecord(account))
    .find((account) => account.username.toLowerCase() === normalized);
}

export function authenticateAccount(username: string, password: string) {
  const account = findAccountByUsername(username);
  if (!account || account.status !== "active") return null;
  if (!verifyPassword(password, account.passwordHash)) return null;

  saveAccountRecord({
    ...account,
    lastLoginAt: now(),
  });
  return findAccountById(account.id) ?? account;
}

export function saveAccountRecord(
  record: Partial<AccountRecord> & { password?: string },
) {
  const store = ensureBootstrapSuperAdmin();
  const existingIndex = record.id
    ? store.accounts.findIndex((account) => account.id === record.id)
    : -1;
  const existing =
    existingIndex >= 0 ? store.accounts[existingIndex] : undefined;
  const passwordHash = record.password
    ? hashPassword(record.password)
    : record.passwordHash || existing?.passwordHash || "";

  if (!passwordHash) {
    throw new Error("password is required");
  }

  const normalized = normalizeAccountRecord({
    ...existing,
    ...record,
    id: record.id || existing?.id || randomUUID(),
    passwordHash,
    createdAt: existing?.createdAt || record.createdAt || now(),
    updatedAt: now(),
  });

  if (existingIndex >= 0) {
    store.accounts[existingIndex] = normalized;
  } else {
    store.accounts.push(normalized);
  }

  writeAdminStore(store);
  return normalized;
}

export function deleteAccountRecord(id: string) {
  const account = findAccountById(id);
  if (!account) return false;
  if (account.role === "super_admin" && account.status === "active") {
    const superAdminCount = getAccountRecords().filter(
      (item) => item.role === "super_admin" && item.status === "active",
    ).length;
    if (superAdminCount <= 1) {
      throw new Error("不能删除最后一个超级管理员");
    }
  }

  saveAccountRecord({ ...account, status: "deleted" });
  return true;
}

export function listProviderCredentials(includeSecret = false) {
  return readAdminStore().credentials.map((record) => ({
    ...record,
    apiKey: includeSecret ? record.apiKey : "",
  }));
}

function previewSecret(value?: string) {
  if (!value) return "";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function listProviderCredentialsPublic(): PublicProviderCredential[] {
  return readAdminStore().credentials.map((credential) => {
    const { apiKey: _apiKey, ...safe } = credential;
    return {
      ...safe,
      keyConfigured: !!credential.apiKey,
      keyPreview: previewSecret(credential.apiKey),
    };
  });
}

export function getPrimaryProviderCredential(provider: ModelProvider) {
  return listProviderCredentials(true)
    .filter((credential) => credential.provider === provider)
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    )
    .at(0);
}

export function getPrimaryProviderCredentialPublic(provider: ModelProvider) {
  const primary = getPrimaryProviderCredential(provider);
  return primary
    ? listProviderCredentialsPublic().find(
        (credential) => credential.id === primary.id,
      )
    : undefined;
}

export function saveProviderCredential(
  record: Partial<ProviderCredential> & { clearApiKey?: boolean },
) {
  const store = readAdminStore();
  const existingIndex = store.credentials.findIndex(
    (credential) => credential.id === record.id,
  );
  const existing =
    existingIndex >= 0 ? store.credentials[existingIndex] : undefined;
  const apiKey =
    record.clearApiKey === true
      ? ""
      : record.apiKey !== undefined
      ? record.apiKey
      : existing?.apiKey ?? "";
  const normalized = normalizeCredentialRecord({
    ...existing,
    ...record,
    id: record.id || existing?.id || `cred-${randomUUID()}`,
    apiKey,
    createdAt: existing?.createdAt || record.createdAt || now(),
    updatedAt: now(),
  });

  if (existingIndex >= 0) {
    store.credentials[existingIndex] = normalized;
  } else {
    store.credentials.push(normalized);
  }

  writeAdminStore(store);
  return normalized;
}

export function deleteProviderCredential(id: string) {
  const store = readAdminStore();
  const nextCredentials = store.credentials.filter(
    (credential) => credential.id !== id,
  );
  const deleted = nextCredentials.length !== store.credentials.length;
  if (deleted) {
    writeAdminStore({ ...store, credentials: nextCredentials });
  }
  return deleted;
}

export function listCompanyModels() {
  return readAdminStore().models;
}

export function saveCompanyModel(id: string, patch: Partial<CompanyModel>) {
  const store = readAdminStore();
  const existing =
    store.models.find((model) => model.id === id) ||
    DEFAULT_COMPANY_MODELS.find((model) => model.id === id);
  if (!existing) {
    throw new Error("model not found");
  }

  const model = normalizeCompanyModel(
    {
      ...existing,
      id,
      enabled:
        typeof patch.enabled === "boolean" ? patch.enabled : existing.enabled,
    },
    existing,
  );
  store.models = mergeCompanyModels([
    ...store.models.filter((item) => item.id !== id),
    model,
  ]);
  writeAdminStore(store);
  return model;
}

export function getCompanyModelById(id: string) {
  return listCompanyModels().find((model) => model.id === id);
}

export function getCompanyModelForRequest(
  provider: ModelProvider,
  modelName: string,
) {
  return findCompanyModelByProviderModel(
    listCompanyModels(),
    provider,
    modelName,
  );
}

export function selectProviderCredentialForModel(model: CompanyModel) {
  if (!isProviderEnabled(model.provider)) return undefined;
  const credential = getPrimaryProviderCredential(model.provider);
  return credential?.enabled && credential.apiKey.trim().length > 0
    ? credential
    : undefined;
}

export function hasUsableCredentialForModel(model: CompanyModel) {
  return !!selectProviderCredentialForModel(model);
}

function isAccountAuthorizedForModel(
  account: SafeAccountRecord,
  model: CompanyModel,
) {
  if (account.role === "admin" || account.role === "super_admin") return true;
  const allowedModelIds = account.allowedModelIds ?? [];
  const allowedCategories = account.allowedCategories ?? [];
  return (
    allowedModelIds.includes(model.id) ||
    allowedCategories.includes(model.category)
  );
}

export function getVisibleCompanyModelsForAccount(account?: SafeAccountRecord) {
  if (!account || account.status !== "active") return [];

  return listCompanyModels()
    .filter((model) => model.enabled)
    .filter((model) => model.endpointType !== "not_implemented")
    .filter((model) => hasUsableCredentialForModel(model))
    .filter((model) => account.role !== "employee" || !model.adminOnly)
    .filter((model) => account.role !== "employee" || !model.legacy)
    .filter((model) => account.role !== "employee" || !model.deprecated)
    .filter((model) => isAccountAuthorizedForModel(account, model))
    .map(toCompanyLLMModel);
}

export function getAllCompanyModelsForAdmin() {
  return listCompanyModels().map((model) => ({
    ...model,
    hasUsableCredential: hasUsableCredentialForModel(model),
  }));
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

function envValue(key?: keyof NodeJS.ProcessEnv) {
  return key ? process.env[key] ?? "" : "";
}

function firstCredentialValue(
  id: AdminProviderId,
  field: "apiKey" | "baseUrl" | "apiVersion" | "orgId",
) {
  return readAdminStore()
    .credentials.filter(
      (credential) =>
        credential.provider === id &&
        credential.enabled &&
        (field !== "apiKey" || credential.apiKey.trim().length > 0),
    )
    .sort((a, b) => a.priority - b.priority)
    .map((credential) => String(credential[field] ?? ""))
    .find(Boolean);
}

export function getEffectiveProviderSecret(id: AdminProviderId) {
  const adminConfig = getAdminProviderConfig(id);
  const envConfig = PROVIDER_ENV[id];
  return (
    firstCredentialValue(id, "apiKey") ||
    adminConfig?.apiKey ||
    envValue(envConfig.key)
  );
}

export function getEffectiveProviderBaseUrl(id: AdminProviderId) {
  const adminConfig = getAdminProviderConfig(id);
  const envConfig = PROVIDER_ENV[id];
  return (
    firstCredentialValue(id, "baseUrl") ||
    adminConfig?.baseUrl ||
    envValue(envConfig.baseUrl)
  );
}

export function getEffectiveProviderApiVersion(id: AdminProviderId) {
  const adminConfig = getAdminProviderConfig(id);
  const envConfig = PROVIDER_ENV[id];
  return (
    firstCredentialValue(id, "apiVersion") ||
    adminConfig?.apiVersion ||
    envValue(envConfig.apiVersion)
  );
}

export function getEffectiveProviderOrgId(id: AdminProviderId) {
  const adminConfig = getAdminProviderConfig(id);
  const envConfig = PROVIDER_ENV[id];
  return (
    firstCredentialValue(id, "orgId") ||
    adminConfig?.orgId ||
    envValue(envConfig.orgId)
  );
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
