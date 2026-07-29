import { NextRequest, NextResponse } from "next/server";

import { getAccountFromRequest } from "@/app/config/account-auth";
import {
  ensureBootstrapSuperAdmin,
  getVisibleCompanyModelsForAccount,
  toSessionUser,
} from "@/app/config/admin-store";

export async function GET(req: NextRequest) {
  ensureBootstrapSuperAdmin();
  const account = getAccountFromRequest(req);

  if (!account) {
    return NextResponse.json({
      error: false,
      authenticated: false,
      user: null,
      models: [],
    });
  }

  return NextResponse.json({
    error: false,
    authenticated: true,
    user: toSessionUser(account),
    models: getVisibleCompanyModelsForAccount(account),
  });
}

export const runtime = "nodejs";
