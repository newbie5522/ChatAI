import { gatewayJsonError } from "./types";

export async function callOpenAIImages() {
  return gatewayJsonError(
    501,
    "OpenAI Images adapter is not enabled in this NewbieChat build.",
  );
}
