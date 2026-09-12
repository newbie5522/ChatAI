import { NextResponse } from "next/server";
function retiredPersonalApi() {
  return NextResponse.json(
    { error: true, message: "个人 API 入口已停用，请使用公司账号。" },
    { status: 410 },
  );
}
export const GET = retiredPersonalApi;
export const POST = retiredPersonalApi;
