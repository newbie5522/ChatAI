import {
  ANTHROPIC_BASE_URL,
  GEMINI_BASE_URL,
  OPENAI_BASE_URL,
  PERPLEXITY_BASE_URL,
} from "../constant";
import type { CompanyModel, ModelProvider } from "./model-registry";
import type { ProviderCredential } from "./admin-store";
import {
  getCompanyModelById,
  selectProviderCredentialForModel,
} from "./admin-store";

const DEFAULT_BASE_URL: Record<ModelProvider, string> = {
  openai: OPENAI_BASE_URL,
  anthropic: ANTHROPIC_BASE_URL,
  google: GEMINI_BASE_URL,
  perplexity: PERPLEXITY_BASE_URL,
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

async function verifyWithCredential(
  model: CompanyModel,
  credential: ProviderCredential,
) {
  const baseUrl = normalizeBaseUrl(
    credential.baseUrl,
    credential.provider || model.provider,
  );

  if (model.endpointType === "not_implemented") {
    return { ok: false, message: "model adapter is not implemented" };
  }

  let url = "";
  let body: Record<string, unknown> = {};

  if (model.endpointType === "openai_responses") {
    url = `${baseUrl}/v1/responses`;
    body = {
      model: model.model,
      input: "ping",
      max_output_tokens: 1,
      stream: false,
    };
  } else if (model.endpointType === "anthropic_messages") {
    url = `${baseUrl}/v1/messages`;
    body = {
      model: model.model,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    };
  } else if (
    model.endpointType === "google_generate_content" ||
    model.endpointType === "google_interactions"
  ) {
    url = `${baseUrl}/v1beta/models/${model.model}:generateContent`;
    body = {
      contents: [{ role: "user", parts: [{ text: "ping" }] }],
      generationConfig: { maxOutputTokens: 1 },
    };
  } else if (model.endpointType === "perplexity_sonar") {
    url = `${baseUrl}/chat/completions`;
    body = {
      model: model.model,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    };
  } else {
    return { ok: false, message: "model adapter is not implemented" };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: credentialHeaders(credential),
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, message: await readErrorMessage(res) };
    return { ok: true, message: "model verified" };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function verifyCompanyModel(modelId: string) {
  const model = getCompanyModelById(modelId);
  if (!model) return { ok: false, message: "model not found" };

  const credential = selectProviderCredentialForModel(model);
  if (!credential) {
    return {
      ok: false,
      message: "no enabled and verified credential matches this model",
    };
  }

  return verifyWithCredential(model, credential);
}
