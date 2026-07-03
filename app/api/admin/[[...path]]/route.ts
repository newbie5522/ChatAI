import { randomUUID } from "crypto";

import { NextRequest, NextResponse } from "next/server";
import md5 from "spark-md5";

import {
  clearAdminCookie,
  createAdminSessionToken,
  isAdminConfigured,
  isAdminRequest,
  requireAdmin,
  setAdminCookie,
  verifyAdminPassword,
} from "@/app/config/admin-auth";
import {
  ADMIN_PROVIDER_IDS,
  AdminProviderId,
  deleteAdminEmployeeRecord,
  getAdminProviderConfig,
  hasAdminEmployeeRecord,
  listProviderPublicConfigs,
  saveAdminEmployeeRecord,
  saveAdminProviderConfig,
} from "@/app/config/admin-store";
import {
  EmployeeAccessRecord,
  SafeEmployeeAccessRecord,
  getEmployeeAccessRecords,
} from "@/app/config/employee";
import { getMonthKey, readUsageRecords } from "@/app/config/usage";

function safeEmployee(record: EmployeeAccessRecord): SafeEmployeeAccessRecord {
  const {
    accessKey: _accessKey,
    accessKeyHash: _accessKeyHash,
    ...safe
  } = record;
  return safe;
}

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

function toNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function findEmployee(id: string) {
  return getEmployeeAccessRecords().find((employee) => employee.id === id);
}

function employeePayload(
  body: Record<string, unknown>,
  existing?: EmployeeAccessRecord,
): Partial<EmployeeAccessRecord> {
  const accessKey =
    typeof body.accessKey === "string" && body.accessKey.trim()
      ? body.accessKey.trim()
      : undefined;
  const allowedProviders = toList(body.allowedProviders);
  const allowedModels = toList(body.allowedModels);

  return {
    ...existing,
    id: String(body.id ?? existing?.id ?? "").trim(),
    name: String(body.name ?? existing?.name ?? "").trim(),
    accessKey,
    accessKeyHash: accessKey
      ? undefined
      : existing?.accessKeyHash ||
        (existing?.accessKey
          ? md5.hash(existing.accessKey).toLowerCase()
          : undefined),
    status: String(body.status ?? existing?.status ?? "active").trim(),
    monthlyQuota:
      body.monthlyQuota === undefined
        ? existing?.monthlyQuota
        : toNumber(body.monthlyQuota),
    usedQuota:
      body.usedQuota === undefined
        ? existing?.usedQuota
        : toNumber(body.usedQuota),
    allowedProviders:
      allowedProviders === undefined
        ? existing?.allowedProviders
        : allowedProviders,
    allowedModels:
      allowedModels === undefined ? existing?.allowedModels : allowedModels,
    createdAt: existing?.createdAt,
    lastUsedAt: existing?.lastUsedAt,
  };
}

function providerId(value: string): AdminProviderId | undefined {
  return ADMIN_PROVIDER_IDS.includes(value as AdminProviderId)
    ? (value as AdminProviderId)
    : undefined;
}

async function handleLogin(req: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      {
        error: true,
        message: "admin password is not configured",
      },
      { status: 503 },
    );
  }

  const body = await readBody(req);
  const password = typeof body.password === "string" ? body.password : "";

  if (!verifyAdminPassword(password)) {
    return NextResponse.json(
      {
        error: true,
        message: "wrong admin password",
      },
      { status: 401 },
    );
  }

  const res = NextResponse.json({
    error: false,
    admin: true,
  });
  setAdminCookie(res, createAdminSessionToken());
  return res;
}

function handleLogout() {
  const res = NextResponse.json({
    error: false,
  });
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

function listEmployees() {
  return NextResponse.json({
    error: false,
    employees: getEmployeeAccessRecords()
      .filter(
        (employee) =>
          String(employee.status ?? "active").toLowerCase() !== "deleted",
      )
      .map(safeEmployee),
  });
}

async function createEmployee(req: NextRequest) {
  const body = await readBody(req);
  const id =
    typeof body.id === "string" && body.id.trim()
      ? body.id.trim()
      : `emp-${randomUUID().slice(0, 8)}`;
  const accessKey =
    typeof body.accessKey === "string" ? body.accessKey.trim() : "";

  if (!accessKey) {
    return NextResponse.json(
      {
        error: true,
        message: "employee access key is required",
      },
      { status: 400 },
    );
  }

  const employee = saveAdminEmployeeRecord(
    employeePayload(
      {
        ...body,
        id,
        accessKey,
      },
      undefined,
    ),
  );

  return NextResponse.json({
    error: false,
    employee: safeEmployee(employee),
  });
}

async function updateEmployee(req: NextRequest, id: string) {
  const existing = findEmployee(id);
  if (!existing) {
    return NextResponse.json(
      {
        error: true,
        message: "employee not found",
      },
      { status: 404 },
    );
  }

  const body = await readBody(req);
  const employee = saveAdminEmployeeRecord(
    employeePayload(
      {
        ...body,
        id,
      },
      existing,
    ),
  );

  return NextResponse.json({
    error: false,
    employee: safeEmployee(employee),
  });
}

function disableEmployee(id: string) {
  const existing = findEmployee(id);
  if (!existing) {
    return NextResponse.json(
      {
        error: true,
        message: "employee not found",
      },
      { status: 404 },
    );
  }

  const employee = saveAdminEmployeeRecord({
    ...existing,
    status: "disabled",
  });

  return NextResponse.json({
    error: false,
    employee: safeEmployee(employee),
  });
}

function deleteEmployee(id: string) {
  const existing = findEmployee(id);
  if (!existing) {
    return NextResponse.json(
      {
        error: true,
        message: "employee not found",
      },
      { status: 404 },
    );
  }

  deleteAdminEmployeeRecord(id);
  const envRecord = findEmployee(id);

  if (envRecord && !hasAdminEmployeeRecord(id)) {
    saveAdminEmployeeRecord({
      ...envRecord,
      status: "deleted",
    });
  }

  return NextResponse.json({
    error: false,
    employee: {
      ...safeEmployee(existing),
      status: "deleted",
    },
  });
}

function listProviders() {
  return NextResponse.json({
    error: false,
    providers: listProviderPublicConfigs(),
  });
}

async function updateProvider(req: NextRequest, id: AdminProviderId) {
  const body = await readBody(req);
  const current = getAdminProviderConfig(id);
  const apiKey =
    typeof body.apiKey === "string" && body.apiKey.trim()
      ? body.apiKey.trim()
      : undefined;
  const enabledModels = toList(body.enabledModels);

  saveAdminProviderConfig(id, {
    enabled:
      typeof body.enabled === "boolean"
        ? body.enabled
        : current?.enabled ?? true,
    apiKey:
      body.clearApiKey === true
        ? ""
        : apiKey === undefined
        ? current?.apiKey
        : apiKey,
    baseUrl:
      typeof body.baseUrl === "string" ? body.baseUrl.trim() : current?.baseUrl,
    apiVersion:
      typeof body.apiVersion === "string"
        ? body.apiVersion.trim()
        : current?.apiVersion,
    orgId: typeof body.orgId === "string" ? body.orgId.trim() : current?.orgId,
    enabledModels:
      enabledModels === undefined ? current?.enabledModels : enabledModels,
  });

  return listProviders();
}

async function usageSummary() {
  const records = await readUsageRecords();
  const month = getMonthKey();
  const employees = getEmployeeAccessRecords().map(safeEmployee);
  const employeeMap = new Map(
    employees.map((employee) => [employee.id, employee]),
  );

  const summaries = employees.map((employee) => {
    const employeeRecords = records.filter(
      (record) => record.employeeId === employee.id && record.month === month,
    );
    const successRecords = employeeRecords.filter(
      (record) => record.status === "success",
    );
    const usedQuota =
      (employee.usedQuota ?? 0) +
      successRecords.reduce((sum, record) => sum + record.quotaUnits, 0);

    return {
      employeeId: employee.id,
      employeeName: employee.name,
      month,
      monthlyQuota: employee.monthlyQuota,
      usedQuota,
      remainingQuota:
        employee.monthlyQuota === undefined
          ? undefined
          : Math.max(0, employee.monthlyQuota - usedQuota),
      requestCount: employeeRecords.length,
      successCount: successRecords.length,
      failedCount: employeeRecords.length - successRecords.length,
      inputTokens: employeeRecords.reduce(
        (sum, record) => sum + record.inputTokens,
        0,
      ),
    };
  });

  return NextResponse.json({
    error: false,
    month,
    summaries,
    records: records
      .slice(-200)
      .reverse()
      .map((record) => ({
        ...record,
        employeeName:
          record.employeeName || employeeMap.get(record.employeeId)?.name,
      })),
  });
}

async function dispatch(
  req: NextRequest,
  { params }: { params: { path?: string[] } },
) {
  const path = params.path ?? [];
  const [resource, id, action] = path;

  if (resource === "login" && req.method === "POST") return handleLogin(req);
  if (resource === "logout" && req.method === "POST") return handleLogout();
  if (resource === "session" && req.method === "GET") return handleSession(req);

  const adminError = requireAdmin(req);
  if (adminError) return adminError;

  if (resource === "employees") {
    if (!id && req.method === "GET") return listEmployees();
    if (!id && req.method === "POST") return createEmployee(req);
    if (id && req.method === "PUT") return updateEmployee(req, id);
    if (id && req.method === "POST" && action === "disable") {
      return disableEmployee(id);
    }
    if (id && req.method === "DELETE") return deleteEmployee(id);
  }

  if (resource === "providers") {
    if (!id && req.method === "GET") return listProviders();

    const provider = id ? providerId(id) : undefined;
    if (!provider) {
      return NextResponse.json(
        {
          error: true,
          message: "unknown provider",
        },
        { status: 404 },
      );
    }
    if (req.method === "PUT") return updateProvider(req, provider);
  }

  if (resource === "usage" && req.method === "GET") return usageSummary();

  return NextResponse.json(
    {
      error: true,
      message: "admin api not found",
    },
    { status: 404 },
  );
}

export const GET = dispatch;
export const POST = dispatch;
export const PUT = dispatch;
export const DELETE = dispatch;

export const runtime = "nodejs";
