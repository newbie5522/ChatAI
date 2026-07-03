import { NextRequest, NextResponse } from "next/server";

import { validateEmployeeRequest } from "@/app/api/auth";
import {
  getEmployeeUsageSummary,
  getMonthKey,
  listEmployeeUsageRecords,
} from "@/app/config/usage";

async function handle(req: NextRequest) {
  const employeeAccess = validateEmployeeRequest(req);

  if (!employeeAccess.ok || !employeeAccess.employee) {
    return NextResponse.json(
      {
        error: true,
        message: employeeAccess.reason ?? "unauthorized",
      },
      { status: 401 },
    );
  }

  const month = req.nextUrl.searchParams.get("month") || getMonthKey();
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 100);
  const safeLimit = Number.isFinite(limit)
    ? Math.min(Math.max(Math.floor(limit), 1), 500)
    : 100;

  const [summary, records] = await Promise.all([
    getEmployeeUsageSummary(employeeAccess.employee, month),
    listEmployeeUsageRecords(employeeAccess.employee.id, month, safeLimit),
  ]);

  return NextResponse.json({
    error: false,
    employee: {
      id: employeeAccess.employee.id,
      name: employeeAccess.employee.name,
    },
    summary,
    records,
  });
}

export const GET = handle;
export const POST = handle;

export const runtime = "nodejs";
