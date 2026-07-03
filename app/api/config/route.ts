import { NextResponse } from "next/server";

import { getServerSideConfig } from "../../config/server";

// Danger! Do not hard code any secret value here.
function getDangerConfig() {
  const serverConfig = getServerSideConfig();
  return {
    needCode: serverConfig.needCode,
    employeeAccessEnabled: serverConfig.employeeAccessEnabled,
    hideUserApiKey: serverConfig.hideUserApiKey,
    disableGPT4: serverConfig.disableGPT4,
    hideBalanceQuery: serverConfig.hideBalanceQuery,
    disableFastLink: serverConfig.disableFastLink,
    customModels: serverConfig.customModels,
    defaultModel: serverConfig.defaultModel,
    visionModels: serverConfig.visionModels,
  };
}

declare global {
  type DangerConfig = ReturnType<typeof getDangerConfig>;
}

async function handle() {
  return NextResponse.json(getDangerConfig());
}

export const GET = handle;
export const POST = handle;

export const runtime = "nodejs";
