import { randomUUID } from "crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  clearAdminCookie,
  createAdminSessionToken,
  isAdminConfigured,
  isAdminRequest,
  setAdminCookie,
  verifyAdminPassword,
} from "@/app/config/admin-auth";
import {
  ADMIN_PROVIDER_IDS,
  AccountRole,
  AccountStatus,
  type ProviderCredential,
  SafeAccountRecord,
  deleteAccountRecord,
  deleteProviderCredential,
  findAccountById,
  findAccountByUsername,
  getAccountRecords,
  getCompanyModelById,
  getCompanyModelForRequest,
  getManageableCompanyModelsForAdmin,
  getPrimaryProviderCredential,
  getPrimaryProviderCredentialPublic,
  listProviderCredentials,
  listProviderCredentialsPublic,
  saveAccountRecord,
  saveAdminProviderConfig,
  saveCompanyModel,
  saveProviderCredential,
  toSafeAccount,
} from "@/app/config/admin-store";
import { canManageRole, requireAdminAccount } from "@/app/config/account-auth";
import { verifyProviderCredentialConnection } from "@/app/config/model-verification";
import {
  getAccountUsageSummary,
  getMonthKey,
  listAccountUsageRecords,
  sanitizePromptForLog,
} from "@/app/config/usage";
import type {
  ModelCategory,
  ModelEndpointType,
  ModelProvider,
} from "@/app/config/model-registry";

async function readBody(req: NextRequest) {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toList(value: unknown) {
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
  return undefined;
}

function toCategories(value: unknown) {
  const categories = toList(value);
  if (!categories) return undefined;
  return categories.filter((category): category is ModelCategory =>
    ["chat", "image", "search", "video"].includes(category),
  );
}

function toNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

const QUOTA_FIELDS = [
  ["monthlyChatTurns", "聊天额度"],
  ["monthlySearchTurns", "搜索额度"],
  ["monthlyImageCount", "生图额度"],
  ["monthlyVideoCount", "视频额度"],
] as const;

function validateQuotaFields(body: Record<string, unknown>) {
  for (const [field, label] of QUOTA_FIELDS) {
    if (body[field] === undefined) continue;
    const value = Number(body[field]);
    if (!Number.isInteger(value) || value < 0) {
      return `${label}必须为非负整数`;
    }
  }
  return "";
}

function toNonNegativeInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function forbidden(message: string) {
  return NextResponse.json({ error: true, message }, { status: 403 });
}

function requireSuperAdmin(actor: SafeAccountRecord) {
  return actor.role === "super_admin" ? null : forbidden("需要超级管理员权限");
}

function notFound(message: string) {
  return NextResponse.json({ error: true, message }, { status: 404 });
}

function accountPayload(
  body: Record<string, unknown>,
  existing?: SafeAccountRecord,
) {
  const password =
    typeof body.password === "string" && body.password.trim()
      ? body.password
      : undefined;
  const allowedModelIds = toList(body.allowedModelIds);
  const allowedCategories = toCategories(body.allowedCategories);

  return {
    ...existing,
    id: String(body.id ?? existing?.id ?? `acct-${randomUUID()}`).trim(),
    username: String(body.username ?? existing?.username ?? "").trim(),
    name: String(body.name ?? existing?.name ?? "").trim(),
    role: String(body.role ?? existing?.role ?? "employee") as AccountRole,
    status: String(
      body.status ?? existing?.status ?? "active",
    ) as AccountStatus,
    password,
    quotaUnlimited:
      typeof body.quotaUnlimited === "boolean"
        ? body.quotaUnlimited
        : existing?.quotaUnlimited ?? true,
    monthlyChatTurns:
      body.monthlyChatTurns === undefined
        ? existing?.monthlyChatTurns
        : toNonNegativeInteger(body.monthlyChatTurns),
    monthlySearchTurns:
      body.monthlySearchTurns === undefined
        ? existing?.monthlySearchTurns
        : toNonNegativeInteger(body.monthlySearchTurns),
    monthlyImageCount:
      body.monthlyImageCount === undefined
        ? existing?.monthlyImageCount
        : toNonNegativeInteger(body.monthlyImageCount),
    monthlyVideoCount:
      body.monthlyVideoCount === undefined
        ? existing?.monthlyVideoCount
        : toNonNegativeInteger(body.monthlyVideoCount),
    monthlyQuota: existing?.monthlyQuota,
    usedQuota: existing?.usedQuota,
    allowedModelIds:
      allowedModelIds === undefined
        ? existing?.allowedModelIds
        : allowedModelIds,
    allowedCategories:
      allowedCategories === undefined
        ? existing?.allowedCategories
        : allowedCategories,
    createdAt: existing?.createdAt,
    lastLoginAt: existing?.lastLoginAt,
  };
}

async function handleLegacyLogin(req: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: true, message: "admin password is not configured" },
      { status: 503 },
    );
  }

  const body = await readBody(req);
  const password = typeof body.password === "string" ? body.password : "";

  if (!verifyAdminPassword(password)) {
    return NextResponse.json(
      { error: true, message: "wrong admin password" },
      { status: 401 },
    );
  }

  const res = NextResponse.json({ error: false, admin: true });
  setAdminCookie(res, createAdminSessionToken());
  return res;
}

function handleLegacyLogout() {
  const res = NextResponse.json({ error: false });
  clearAdminCookie(res);
  return res;
}

function handleSession(req: NextRequest) {
  return NextResponse.json({
    error: false,
    configured: isAdminConfigured(),
    admin: isAdminRequest(req),
  });
}

async function listAccounts() {
  const month = getMonthKey();
  const accounts = getAccountRecords().map(toSafeAccount);
  const summaries = await Promise.all(
    accounts.map((account) => getAccountUsageSummary(account, month)),
  );
  const summaryByAccount = new Map(
    summaries.map((summary) => [summary.accountId, summary]),
  );
  return NextResponse.json({
    error: false,
    accounts: accounts.map((account) => ({
      ...account,
      usedChatTurns: summaryByAccount.get(account.id)?.usedChatTurns ?? 0,
      usedSearchTurns: summaryByAccount.get(account.id)?.usedSearchTurns ?? 0,
      usedImageCount: summaryByAccount.get(account.id)?.usedImageCount ?? 0,
      usedVideoCount: summaryByAccount.get(account.id)?.usedVideoCount ?? 0,
    })),
  });
}

async function createAccount(req: NextRequest, actor: SafeAccountRecord) {
  const body = await readBody(req);
  const quotaError = validateQuotaFields(body);
  if (quotaError) {
    return NextResponse.json(
      { error: true, message: quotaError },
      { status: 400 },
    );
  }
  const payload = accountPayload(body);

  if (!payload.username) {
    return NextResponse.json(
      { error: true, message: "请输入登录账号" },
      { status: 400 },
    );
  }
  if (!payload.password) {
    return NextResponse.json(
      { error: true, message: "请输入密码" },
      { status: 400 },
    );
  }
  if (payload.password.length < 8) {
    return NextResponse.json(
      { error: true, message: "密码至少需要 8 位" },
      { status: 400 },
    );
  }
  if (payload.role === "super_admin") {
    return forbidden("不能通过普通页面创建超级管理员");
  }
  if (findAccountByUsername(payload.username)) {
    return NextResponse.json(
      { error: true, message: "该账号已存在" },
      { status: 409 },
    );
  }
  if (!canManageRole(actor, payload.role)) {
    return forbidden("没有权限创建该角色");
  }

  const account = saveAccountRecord(payload);
  return NextResponse.json({ error: false, account: toSafeAccount(account) });
}

async function updateAccount(
  req: NextRequest,
  id: string,
  actor: SafeAccountRecord,
) {
  const existing = findAccountById(id);
  if (!existing) return notFound("账号不存在");
  if (!canManageRole(actor, existing.role)) {
    return forbidden("没有权限管理该账号");
  }

  const body = await readBody(req);
  const quotaError = validateQuotaFields(body);
  if (quotaError) {
    return NextResponse.json(
      { error: true, message: quotaError },
      { status: 400 },
    );
  }
  const payload = accountPayload(body, toSafeAccount(existing));
  if (!payload.username) {
    return NextResponse.json(
      { error: true, message: "请输入登录账号" },
      { status: 400 },
    );
  }
  const duplicate = findAccountByUsername(payload.username);
  if (duplicate && duplicate.id !== existing.id) {
    return NextResponse.json(
      { error: true, message: "该账号已存在" },
      { status: 409 },
    );
  }
  if (payload.password && payload.password.length < 8) {
    return NextResponse.json(
      { error: true, message: "密码至少需要 8 位" },
      { status: 400 },
    );
  }
  const activeSuperAdminCount = getAccountRecords().filter(
    (account) => account.role === "super_admin" && account.status === "active",
  ).length;
  if (
    existing.role === "super_admin" &&
    existing.status === "active" &&
    activeSuperAdminCount <= 1
  ) {
    if (payload.role !== "super_admin") {
      return NextResponse.json(
        { error: true, message: "不能修改最后一个超级管理员的角色" },
        { status: 400 },
      );
    }
    if (payload.status !== "active") {
      return NextResponse.json(
        { error: true, message: "不能禁用最后一个超级管理员" },
        { status: 400 },
      );
    }
  }
  if (actor.id === existing.id) {
    if (payload.status !== "active") {
      return forbidden("当前账号不能禁用自己");
    }
    if (payload.role !== existing.role) {
      return forbidden("当前账号不能修改自己的角色");
    }
  }
  if (!canManageRole(actor, payload.role)) {
    return forbidden("没有权限修改为该角色");
  }
  const account = saveAccountRecord(payload);
  return NextResponse.json({ error: false, account: toSafeAccount(account) });
}

function disableAccount(id: string, actor: SafeAccountRecord) {
  const existing = findAccountById(id);
  if (!existing) return notFound("账号不存在");
  if (!canManageRole(actor, existing.role)) {
    return forbidden("没有权限禁用该账号");
  }
  if (actor.id === existing.id) {
    return forbidden("当前账号不能禁用自己");
  }
  if (
    existing.role === "super_admin" &&
    existing.status === "active" &&
    getAccountRecords().filter(
      (account) =>
        account.role === "super_admin" && account.status === "active",
    ).length <= 1
  ) {
    return NextResponse.json(
      { error: true, message: "不能禁用最后一个超级管理员" },
      { status: 400 },
    );
  }

  const account = saveAccountRecord({ ...existing, status: "disabled" });
  return NextResponse.json({ error: false, account: toSafeAccount(account) });
}

function enableAccount(id: string, actor: SafeAccountRecord) {
  const existing = findAccountById(id);
  if (!existing) return notFound("账号不存在");
  if (!canManageRole(actor, existing.role)) {
    return forbidden("没有权限启用该账号");
  }

  const account = saveAccountRecord({ ...existing, status: "active" });
  return NextResponse.json({ error: false, account: toSafeAccount(account) });
}

function removeAccount(id: string, actor: SafeAccountRecord) {
  const existing = findAccountById(id);
  if (!existing) return notFound("账号不存在");
  if (!canManageRole(actor, existing.role)) {
    return forbidden("没有权限删除该账号");
  }
  if (actor.id === existing.id) {
    return forbidden("当前账号不能删除自己");
  }

  try {
    deleteAccountRecord(id);
    return NextResponse.json({
      error: false,
      account: { ...toSafeAccount(existing), status: "deleted" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: true,
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }
}

function listCredentials() {
  return NextResponse.json({
    error: false,
    credentials: ADMIN_PROVIDER_IDS.map(
      getPrimaryProviderCredentialPublic,
    ).filter(
      (credential): credential is NonNullable<typeof credential> =>
        !!credential,
    ),
  });
}

async function createCredential(req: NextRequest) {
  const body = await readBody(req);
  const provider =
    typeof body.provider === "string" &&
    (ADMIN_PROVIDER_IDS as readonly string[]).includes(body.provider)
      ? (body.provider as ModelProvider)
      : undefined;
  if (!provider) {
    return NextResponse.json(
      { error: true, message: "服务商不受支持" },
      { status: 400 },
    );
  }
  const existing = getPrimaryProviderCredential(provider);
  const apiKey =
    typeof body.apiKey === "string" && body.apiKey.trim()
      ? body.apiKey.trim()
      : undefined;
  if ((!existing || !existing.apiKey.trim()) && !apiKey) {
    return NextResponse.json(
      { error: true, message: "请先填写 API Key" },
      { status: 400 },
    );
  }
  const enabled =
    typeof body.enabled === "boolean"
      ? body.enabled
      : existing?.enabled ?? false;
  const baseUrl =
    typeof body.baseUrl === "string" ? body.baseUrl.trim() : undefined;
  let credential: ProviderCredential;
  try {
    credential = saveProviderCredential({
      id: existing?.id,
      provider,
      apiKey,
      baseUrl,
      enabled,
      ...(existing
        ? {}
        : {
            name: `${String(body.provider)} 主配置`,
            categoryScope: "all" as const,
            modelIds: [],
            priority: 100,
          }),
    });
    saveAdminProviderConfig(provider, { enabled });
  } catch (error) {
    return NextResponse.json(
      {
        error: true,
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }
  return NextResponse.json({
    error: false,
    credential: listProviderCredentialsPublic().find(
      (item) => item.id === credential.id,
    ),
  });
}

async function updateCredential(req: NextRequest, id: string) {
  const body = await readBody(req);
  const existing = listProviderCredentials(true).find(
    (credential) => credential.id === id,
  );
  if (!existing) return notFound("服务商配置不存在");
  const primary = getPrimaryProviderCredential(existing.provider);
  if (primary?.id !== existing.id) {
    return forbidden("只能修改服务商主配置");
  }
  const apiKey =
    typeof body.apiKey === "string" && body.apiKey.trim()
      ? body.apiKey
      : undefined;
  const enabled =
    typeof body.enabled === "boolean" ? body.enabled : existing.enabled;
  const baseUrl =
    typeof body.baseUrl === "string" ? body.baseUrl.trim() : undefined;
  let credential: ProviderCredential;
  try {
    credential = saveProviderCredential({
      id,
      provider: existing.provider,
      apiKey,
      baseUrl,
      enabled,
    });
    saveAdminProviderConfig(existing.provider, { enabled });
  } catch (error) {
    return NextResponse.json(
      {
        error: true,
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }
  return NextResponse.json({
    error: false,
    credential: listProviderCredentialsPublic().find(
      (item) => item.id === credential.id,
    ),
  });
}

async function testCredential(id: string) {
  const credential = listProviderCredentials(true).find(
    (item) => item.id === id,
  );
  if (!credential) return notFound("credential not found");

  const result = await verifyProviderCredentialConnection(credential);
  saveProviderCredential({ ...credential, verified: result.ok });
  return NextResponse.json({
    error: false,
    ok: result.ok,
    message: result.message,
    credential: listProviderCredentialsPublic().find((item) => item.id === id),
  });
}

function removeCredential(id: string) {
  if (!deleteProviderCredential(id)) return notFound("credential not found");
  return NextResponse.json({ error: false });
}

function listModels() {
  return NextResponse.json({
    error: false,
    models: getManageableCompanyModelsForAdmin(),
  });
}

async function updateModel(req: NextRequest, id: string) {
  const body = await readBody(req);
  const patch: { enabled?: boolean; endpointType?: ModelEndpointType } = {};

  if (typeof body.enabled === "boolean") {
    patch.enabled = body.enabled;
  }

  if (typeof body.endpointType === "string" && body.endpointType) {
    const validTypes: ReadonlySet<string> = new Set([
      "openai_responses",
      "openai_images",
      "anthropic_messages",
      "google_interactions",
      "google_generate_content",
      "google_image",
      "perplexity_sonar",
      "openai_compatible_chat",
      "xai_images",
      "not_implemented",
    ]);
    if (!validTypes.has(body.endpointType)) {
      return NextResponse.json(
        { error: true, message: "不支持的接口协议类型" },
        { status: 400 },
      );
    }
    patch.endpointType = body.endpointType as ModelEndpointType;
  }

  if (patch.enabled === undefined && patch.endpointType === undefined) {
    return NextResponse.json(
      { error: true, message: "请提供要修改的字段（enabled 或 endpointType）" },
      { status: 400 },
    );
  }

  const manageable = getManageableCompanyModelsForAdmin().some(
    (model) => model.id === id,
  );
  if (!manageable) return notFound("模型不可管理或服务商尚未配置");
  const model = saveCompanyModel(id, patch);
  return NextResponse.json({ error: false, model });
}

async function usageLogs(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month") || getMonthKey();
  const accountId = req.nextUrl.searchParams.get("accountId") || undefined;
  const accounts = getAccountRecords().map(toSafeAccount);
  const summaries = await Promise.all(
    accounts.map((account) => getAccountUsageSummary(account, month)),
  );
  const records = await listAccountUsageRecords(accountId, month, 500);
  const safeRecords = records.map((record) => {
    const provider = ADMIN_PROVIDER_IDS.includes(
      record.provider as ModelProvider,
    )
      ? (record.provider as ModelProvider)
      : undefined;
    const model =
      getCompanyModelById(record.modelId) ||
      (provider
        ? getCompanyModelForRequest(provider, record.model)
        : undefined);
    return {
      ...record,
      modelDisplayName: model?.displayName ?? "未知模型",
      promptContent: sanitizePromptForLog(record.promptContent ?? ""),
      promptPreview: sanitizePromptForLog(record.promptPreview),
    };
  });

  return NextResponse.json({
    error: false,
    month,
    summaries,
    records: safeRecords,
  });
}

async function dispatch(
  req: NextRequest,
  { params }: { params: { path?: string[] } },
) {
  const path = params.path ?? [];
  const [resource, id, action] = path;

  if (resource === "login" && req.method === "POST")
    return handleLegacyLogin(req);
  if (resource === "logout" && req.method === "POST")
    return handleLegacyLogout();
  if (resource === "session" && req.method === "GET") return handleSession(req);

  const { account: actor, response } = requireAdminAccount(req);
  if (response) return response;
  if (!actor) return forbidden("需要管理员权限");

  if (resource === "accounts" || resource === "employees") {
    if (!id && req.method === "GET") return listAccounts();
    if (!id && req.method === "POST") return createAccount(req, actor);
    if (id && req.method === "PUT") return updateAccount(req, id, actor);
    if (id && req.method === "POST" && action === "disable") {
      return disableAccount(id, actor);
    }
    if (id && req.method === "POST" && action === "enable") {
      return enableAccount(id, actor);
    }
    if (id && req.method === "DELETE") return removeAccount(id, actor);
  }

  if (resource === "credentials" || resource === "providers") {
    const denied = requireSuperAdmin(actor);
    if (denied) return denied;
    if (!id && req.method === "GET") return listCredentials();
    if (!id && req.method === "POST") return createCredential(req);
    if (id && req.method === "PUT") return updateCredential(req, id);
    if (id && req.method === "POST" && action === "test") {
      return testCredential(id);
    }
    if (id && req.method === "DELETE") return removeCredential(id);
  }

  if (resource === "models") {
    const denied = requireSuperAdmin(actor);
    if (denied) return denied;
    if (!id && req.method === "GET") return listModels();
    if (id && req.method === "PUT") return updateModel(req, id);
  }

  if (
    (resource === "usage-logs" || resource === "usage") &&
    req.method === "GET"
  ) {
    const denied = requireSuperAdmin(actor);
    if (denied) return denied;
    return usageLogs(req);
  }

  return NextResponse.json(
    { error: true, message: "admin api not found" },
    { status: 404 },
  );
}

export const GET = dispatch;
export const POST = dispatch;
export const PUT = dispatch;
export const DELETE = dispatch;

export const runtime = "nodejs";
