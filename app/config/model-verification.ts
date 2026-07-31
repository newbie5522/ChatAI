import {
  ANTHROPIC_BASE_URL,
  GEMINI_BASE_URL,
  OPENAI_BASE_URL,
  PERPLEXITY_BASE_URL,
} from "../constant";
import type { ModelProvider } from "./model-registry";
import type { ProviderCredential } from "./admin-store";

const DEFAULT_BASE_URL: Record<ModelProvider, string> = {
  openai: OPENAI_BASE_URL,
  anthropic: ANTHROPIC_BASE_URL,
  google: GEMINI_BASE_URL,
  perplexity: PERPLEXITY_BASE_URL,
  xai: "",
  deepseek: "",
  qwen: "",
  mistral: "",
};

function normalizeBaseUrl(url?: string, provider?: ModelProvider) {
  const raw = (url || (provider ? DEFAULT_BASE_URL[provider] : "")).trim();
  if (!raw) return "";
  const withProtocol = raw.startsWith("http") ? raw : `https://${raw}`;
  return withProtocol.endsWith("/")
    ? withProtocol.slice(0, withProtocol.length - 1)
    : withProtocol;
}

async function readErrorMessage(res: Response) {
  try {
    const json = await res.json();
    return json?.error?.message || json?.message || res.statusText;
  } catch {
    return res.statusText;
  }
}

function credentialHeaders(
  credential: ProviderCredential,
): Record<string, string> {
  switch (credential.provider) {
    case "google":
      return {
        "Content-Type": "application/json",
        "x-goog-api-key": credential.apiKey,
      };
    case "anthropic":
      return {
        "Content-Type": "application/json",
        "x-api-key": credential.apiKey,
        "anthropic-version": credential.apiVersion || "2023-06-01",
      };
    default:
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credential.apiKey}`,
      };
      if (credential.orgId) {
        headers["OpenAI-Organization"] = credential.orgId;
      }
      return headers;
  }
}

export async function verifyProviderCredentialConnection(
  credential: ProviderCredential,
) {
  if (!credential.apiKey) {
    return { ok: false, message: "credential api key is empty" };
  }

  const baseUrl = normalizeBaseUrl(credential.baseUrl, credential.provider);
  let url = "";
  let init: RequestInit = {
    method: "GET",
    headers: credentialHeaders(credential),
  };

  if (credential.provider === "openai") {
    url = `${baseUrl}/v1/models`;
  } else if (credential.provider === "google") {
    url = `${baseUrl}/v1beta/models`;
  } else if (credential.provider === "anthropic") {
    url = `${baseUrl}/v1/messages`;
    init = {
      method: "POST",
      headers: credentialHeaders(credential),
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
    };
  } else {
    url = `${baseUrl}/chat/completions`;
    init = {
      method: "POST",
      headers: credentialHeaders(credential),
      body: JSON.stringify({
        model: "sonar",
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
    };
  }

  try {
    const res = await fetch(url, init);
    if (!res.ok) return { ok: false, message: await readErrorMessage(res) };
    return { ok: true, message: "credential verified" };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
