import { gatewayJsonError } from "./types";

export async function callGoogleImage() {
  return gatewayJsonError(
    501,
    "Google Image adapter is not enabled in this NewbieChat build.",
  );
}
