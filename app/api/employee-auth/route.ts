import { NextRequest, NextResponse } from "next/server";
import md5 from "spark-md5";

import { getServerSideConfig } from "@/app/config/server";
import {
  hasEmployeeAccessControl,
  validateEmployeeAccessKey,
} from "@/app/config/employee";

async function getAccessKey(req: NextRequest) {
  try {
    const body = (await req.json()) as { accessKey?: string };
    return body.accessKey?.trim() ?? "";
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  const accessKey = await getAccessKey(req);
  const serverConfig = getServerSideConfig();

  if (hasEmployeeAccessControl()) {
    const validation = validateEmployeeAccessKey(accessKey);
    if (!validation.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: validation.reason ?? "wrong employee access key",
        },
        { status: 401 },
      );
    }

    return NextResponse.json({
      ok: true,
      employee: validation.employee,
    });
  }

  if (!serverConfig.needCode) {
    return NextResponse.json({ ok: true });
  }

  const hashedCode = md5.hash(accessKey).trim();
  if (serverConfig.codes.has(hashedCode)) {
    return NextResponse.json({
      ok: true,
      employee: {
        id: "legacy-code",
        name: "Legacy Access Code",
        status: "active",
      },
    });
  }

  return NextResponse.json(
    {
      ok: false,
      message: !accessKey ? "empty access code" : "wrong access code",
    },
    { status: 401 },
  );
}

export const runtime = "nodejs";
