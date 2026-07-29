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
  AccountRole,
  AccountStatus,
  SafeAccountRecord,
  deleteAccountRecord,
  deleteProviderCredential,
  findAccountById,
  getAccountRecords,
  getAllCompanyModelsForAdmin,
  listProviderCredentials,
  listProviderCredentialsPublic,
  saveAccountRecord,
  saveCompanyModel,
  saveProviderCredential,
  toSafeAccount,
} from "@/app/config/admin-store";
import { canManageRole, requireAdminAccount } from "@/app/config/account-auth";
import {
  verifyCompanyModel,
  verifyProviderCredentialConnection,
} from "@/app/config/model-verification";
import {
  getAccountUsageSummary,
  getMonthKey,
  listAccountUsageRecords,
} from "@/app/config/usage";
import type { ModelCategory } from "@/app/config/model-registry";

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

function forbidden(message: string) {
  return NextResponse.json({ error: true, message }, { status: 403 });
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
    monthlyQuota:
      body.monthlyQuota === undefined
        ? existing?.monthlyQuota
        : toNumber(body.monthlyQuota),
    usedQuota:
      body.usedQuota === undefined
        ? existing?.usedQuota
        : toNumber(body.usedQuota),
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

function listAccounts() {
  return NextResponse.json({
    error: false,
    accounts: getAccountRecords().map(toSafeAccount),
  });
}

async function createAccount(req: NextRequest, actor: SafeAccountRecord) {
  const body = await readBody(req);
  const payload = accountPayload(body);

  if (!payload.username) {
    return NextResponse.json(
      { error: true, message: "username is required" },
      { status: 400 },
    );
  }
  if (!payload.password) {
    return NextResponse.json(
      { error: true, message: "password is required" },
      { status: 400 },
    );
  }
  if (!canManageRole(actor, payload.role)) {
    return forbidden("insufficient role permission");
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
  if (!existing) return notFound("account not found");
  if (!canManageRole(actor, existing.role)) {
    return forbidden("insufficient role permission");
  }

  const body = await readBody(req);
  const payload = accountPayload(body, toSafeAccount(existing));
  if (!canManageRole(actor, payload.role)) {
    return forbidden("insufficient role permission");
  }

  const account = saveAccountRecord(payload);
  return NextResponse.json({ error: false, account: toSafeAccount(account) });
}

function disableAccount(id: string, actor: SafeAccountRecord) {
  const existing = findAccountById(id);
  if (!existing) return notFound("account not found");
  if (!canManageRole(actor, existing.role)) {
    return forbidden("insufficient role permission");
  }

  const account = saveAccountRecord({ ...existing, status: "disabled" });
  return NextResponse.json({ error: false, account: toSafeAccount(account) });
}

function removeAccount(id: string, actor: SafeAccountRecord) {
  const existing = findAccountById(id);
  if (!existing) return notFound("account not found");
  if (!canManageRole(actor, existing.role)) {
    return forbidden("insufficient role permission");
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
    credentials: listProviderCredentialsPublic(),
  });
}

async function createCredential(req: NextRequest) {
  const body = await readBody(req);
  const credential = saveProviderCredential({
    id: typeof body.id === "string" ? body.id : undefined,
    provider: body.provider as never,
    name: typeof body.name === "string" ? body.name : undefined,
    apiKey: typeof body.apiKey === "string" ? body.apiKey : "",
    baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
    apiVersion:
      typeof body.apiVersion === "string" ? body.apiVersion : undefined,
    orgId: typeof body.orgId === "string" ? body.orgId : undefined,
    categoryScope: body.categoryScope as never,
    modelIds: toList(body.modelIds),
    enabled:
      typeof body.enabled === "boolean" ? body.enabled : body.enabled !== false,
    verified: body.verified === true,
    priority: toNumber(body.priority) ?? 100,
  });
  return NextResponse.json({
    error: false,
    credential: listProviderCredentialsPublic().find(
      (item) => item.id === credential.id,
    ),
  });
}

async function updateCredential(req: NextRequest, id: string) {
  const body = await readBody(req);
  const credential = saveProviderCredential({
    id,
    provider: body.provider as never,
    name: typeof body.name === "string" ? body.name : undefined,
    apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
    clearApiKey: body.clearApiKey === true,
    baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
    apiVersion:
      typeof body.apiVersion === "string" ? body.apiVersion : undefined,
    orgId: typeof body.orgId === "string" ? body.orgId : undefined,
    categoryScope: body.categoryScope as never,
    modelIds: toList(body.modelIds),
    enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    verified: typeof body.verified === "boolean" ? body.verified : undefined,
    priority: toNumber(body.priority),
  });
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
    models: getAllCompanyModelsForAdmin(),
  });
}

async function updateModel(req: NextRequest, id: string) {
  const body = await readBody(req);
  const model = saveCompanyModel(id, {
    displayName:
      typeof body.displayName === "string" ? body.displayName : undefined,
    model: typeof body.model === "string" ? body.model : undefined,
    endpointType: body.endpointType as never,
    enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    verified: typeof body.verified === "boolean" ? body.verified : undefined,
    adminOnly: typeof body.adminOnly === "boolean" ? body.adminOnly : undefined,
    legacy: typeof body.legacy === "boolean" ? body.legacy : undefined,
    deprecated:
      typeof body.deprecated === "boolean" ? body.deprecated : undefined,
    sort: toNumber(body.sort),
  });
  return NextResponse.json({ error: false, model });
}

async function verifyModel(id: string) {
  const result = await verifyCompanyModel(id);
  const model = saveCompanyModel(id, {
    verified: result.ok,
    enabled: result.ok,
  });
  return NextResponse.json({
    error: false,
    ok: result.ok,
    message: result.message,
    model,
  });
}

async function usageLogs(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month") || getMonthKey();
  const accountId = req.nextUrl.searchParams.get("accountId") || undefined;
  const accounts = getAccountRecords().map(toSafeAccount);
  const summaries = await Promise.all(
    accounts.map((account) => getAccountUsageSummary(account, month)),
  );
  const records = await listAccountUsageRecords(accountId, month, 500);

  return NextResponse.json({
    error: false,
    month,
    summaries,
    records,
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
  if (!actor) return forbidden("admin role required");

  if (resource === "accounts" || resource === "employees") {
    if (!id && req.method === "GET") return listAccounts();
    if (!id && req.method === "POST") return createAccount(req, actor);
    if (id && req.method === "PUT") return updateAccount(req, id, actor);
    if (id && req.method === "POST" && action === "disable") {
      return disableAccount(id, actor);
    }
    if (id && req.method === "DELETE") return removeAccount(id, actor);
  }

  if (resource === "credentials" || resource === "providers") {
    if (!id && req.method === "GET") return listCredentials();
    if (!id && req.method === "POST") return createCredential(req);
    if (id && req.method === "PUT") return updateCredential(req, id);
    if (id && req.method === "POST" && action === "test") {
      return testCredential(id);
    }
    if (id && req.method === "DELETE") return removeCredential(id);
  }

  if (resource === "models") {
    if (!id && req.method === "GET") return listModels();
    if (id && req.method === "PUT") return updateModel(req, id);
    if (id && req.method === "POST" && action === "verify") {
      return verifyModel(id);
    }
  }

  if (
    (resource === "usage-logs" || resource === "usage") &&
    req.method === "GET"
  ) {
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
