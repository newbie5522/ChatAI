import { callGoogleGenerateContent } from "./google-generate-content";
import type { GatewayAdapterContext } from "./types";

export async function callGoogleInteractions(ctx: GatewayAdapterContext) {
  return callGoogleGenerateContent(ctx);
}
