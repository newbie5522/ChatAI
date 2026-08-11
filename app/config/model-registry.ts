export type ModelProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "perplexity"
  | "xai"
  | "deepseek"
  | "qwen"
  | "mistral"
  | "zhipu";

export type ModelCategory = "chat" | "image" | "search" | "video";

export type ModelEndpointType =
  | "openai_responses"
  | "openai_images"
  | "openai_compatible_video"
  | "anthropic_messages"
  | "google_interactions"
  | "google_generate_content"
  | "google_image"
  | "perplexity_sonar"
  | "openai_compatible_chat"
  | "xai_images"
  | "not_implemented";

export interface CompanyModel {
  id: string;
  provider: ModelProvider;
  category: ModelCategory;
  displayName: string;
  model: string;
  endpointType: ModelEndpointType;
  enabled: boolean;
  defaultEnabled: boolean;
  adminOnly?: boolean;
  legacy?: boolean;
  deprecated?: boolean;
  sort: number;
  capabilities?: {
    vision?: boolean;
    reasoning?: boolean;
    tools?: boolean;
    webSearch?: boolean;
    imageGeneration?: boolean;
    videoGeneration?: boolean;
  };
}

export const MODEL_PROVIDER_LABELS: Record<ModelProvider, string> = {
  openai: "OpenAI",
  anthropic: "Claude",
  google: "Google",
  perplexity: "Perplexity",
  xai: "xAI",
  deepseek: "DeepSeek",
  qwen: "Qwen",
  mistral: "Mistral",
  zhipu: "智谱 GLM",
};

export const MODEL_PROVIDER_SORT: Record<ModelProvider, number> = {
  openai: 1,
  anthropic: 2,
  google: 3,
  perplexity: 4,
  xai: 5,
  deepseek: 6,
  qwen: 7,
  mistral: 8,
  zhipu: 9,
};

export const DEFAULT_COMPANY_MODELS: CompanyModel[] = [
  {
    id: "openai:gpt-5.6-sol",
    provider: "openai",
    category: "chat",
    displayName: "GPT-5.6 Sol",
    model: "gpt-5.6-sol",
    endpointType: "openai_responses",
    enabled: true,
    defaultEnabled: true,
    sort: 100,
    capabilities: { reasoning: true, tools: true, vision: true },
  },
  {
    id: "openai:gpt-5.6-terra",
    provider: "openai",
    category: "chat",
    displayName: "GPT-5.6 Terra",
    model: "gpt-5.6-terra",
    endpointType: "openai_responses",
    enabled: true,
    defaultEnabled: true,
    sort: 110,
    capabilities: { reasoning: true, tools: true, vision: true },
  },
  {
    id: "openai:gpt-5.6-luna",
    provider: "openai",
    category: "chat",
    displayName: "GPT-5.6 Luna",
    model: "gpt-5.6-luna",
    endpointType: "openai_responses",
    enabled: true,
    defaultEnabled: true,
    sort: 120,
    capabilities: { reasoning: true, tools: true, vision: true },
  },
  {
    id: "openai:gpt-5.5",
    provider: "openai",
    category: "chat",
    displayName: "GPT-5.5",
    model: "gpt-5.5",
    endpointType: "openai_responses",
    enabled: true,
    defaultEnabled: true,
    legacy: false,
    deprecated: false,
    sort: 130,
    capabilities: { reasoning: true, tools: true, vision: true },
  },
  {
    id: "openai:gpt-image-2",
    provider: "openai",
    category: "image",
    displayName: "GPT Image 2",
    model: "gpt-image-2",
    endpointType: "openai_images",
    enabled: true,
    defaultEnabled: true,
    sort: 615,
    capabilities: { imageGeneration: true },
  },
  {
    id: "anthropic:claude-haiku-4-5",
    provider: "anthropic",
    category: "chat",
    displayName: "Claude Haiku 4.5",
    model: "claude-haiku-4-5",
    endpointType: "anthropic_messages",
    enabled: true,
    defaultEnabled: true,
    sort: 330,
    capabilities: { tools: true, vision: true },
  },
  {
    id: "google:gemini-3.6-flash",
    provider: "google",
    category: "chat",
    displayName: "Gemini 3.6 Flash",
    model: "gemini-3.6-flash",
    endpointType: "google_generate_content",
    enabled: true,
    defaultEnabled: true,
    sort: 400,
    capabilities: { vision: true, reasoning: true, tools: true },
  },
  {
    id: "google:gemini-3.5-flash",
    provider: "google",
    category: "chat",
    displayName: "Gemini 3.5 Flash",
    model: "gemini-3.5-flash",
    endpointType: "google_generate_content",
    enabled: true,
    defaultEnabled: true,
    sort: 410,
    capabilities: { vision: true, reasoning: true, tools: true },
  },
  {
    id: "google:gemini-3.5-flash-lite",
    provider: "google",
    category: "chat",
    displayName: "Gemini 3.5 Flash-Lite",
    model: "gemini-3.5-flash-lite",
    endpointType: "google_generate_content",
    enabled: true,
    defaultEnabled: true,
    sort: 420,
    capabilities: { vision: true, reasoning: true, tools: true },
  },
  {
    id: "google:gemini-3.1-pro-preview",
    provider: "google",
    category: "chat",
    displayName: "Gemini 3.1 Pro Preview",
    model: "gemini-3.1-pro-preview",
    endpointType: "google_generate_content",
    enabled: false,
    defaultEnabled: false,
    adminOnly: true,
    legacy: false,
    deprecated: false,
    sort: 430,
    capabilities: { reasoning: true, vision: true, tools: true },
  },
  {
    id: "google:nano-banana-2",
    provider: "google",
    category: "image",
    displayName: "Nano Banana 2",
    model: "gemini-3.1-flash-image",
    endpointType: "google_image",
    enabled: true,
    defaultEnabled: true,
    sort: 500,
    capabilities: { imageGeneration: true },
  },
  {
    id: "google:nano-banana-2-lite",
    provider: "google",
    category: "image",
    displayName: "Nano Banana 2 Lite",
    model: "gemini-3.1-flash-lite-image",
    endpointType: "google_image",
    enabled: true,
    defaultEnabled: true,
    sort: 510,
    capabilities: { imageGeneration: true },
  },
  {
    id: "google:nano-banana-pro",
    provider: "google",
    category: "image",
    displayName: "Nano Banana Pro",
    model: "gemini-3-pro-image",
    endpointType: "google_image",
    enabled: true,
    defaultEnabled: true,
    sort: 520,
    capabilities: { imageGeneration: true },
  },
  {
    id: "perplexity:sonar",
    provider: "perplexity",
    category: "search",
    displayName: "Sonar",
    model: "sonar",
    endpointType: "perplexity_sonar",
    enabled: true,
    defaultEnabled: true,
    sort: 600,
    capabilities: { webSearch: true, vision: true },
  },
  {
    id: "perplexity:sonar-pro",
    provider: "perplexity",
    category: "search",
    displayName: "Sonar Pro",
    model: "sonar-pro",
    endpointType: "perplexity_sonar",
    enabled: true,
    defaultEnabled: true,
    sort: 610,
    capabilities: { webSearch: true, vision: true },
  },
  {
    id: "perplexity:sonar-reasoning-pro",
    provider: "perplexity",
    category: "search",
    displayName: "Sonar Reasoning Pro",
    model: "sonar-reasoning-pro",
    endpointType: "perplexity_sonar",
    enabled: true,
    defaultEnabled: true,
    sort: 620,
    capabilities: { reasoning: true, webSearch: true, vision: true },
  },
  {
    id: "perplexity:sonar-deep-research",
    provider: "perplexity",
    category: "search",
    displayName: "Sonar Deep Research",
    model: "sonar-deep-research",
    endpointType: "perplexity_sonar",
    enabled: true,
    defaultEnabled: true,
    sort: 630,
    capabilities: { reasoning: true, webSearch: true, vision: true },
  },
  {
    id: "xai:grok-4.5",
    provider: "xai",
    category: "chat",
    displayName: "Grok 4.5",
    model: "grok-4.5",
    endpointType: "openai_compatible_chat",
    enabled: true,
    defaultEnabled: true,
    sort: 700,
    capabilities: { vision: true, reasoning: true, tools: true },
  },
  {
    id: "xai:grok-imagine-image",
    provider: "xai",
    category: "image",
    displayName: "Grok Imagine Image",
    model: "grok-imagine-image",
    endpointType: "xai_images",
    enabled: true,
    defaultEnabled: true,
    sort: 710,
    capabilities: { imageGeneration: true },
  },
  {
    id: "deepseek:deepseek-v4-pro",
    provider: "deepseek",
    category: "chat",
    displayName: "DeepSeek V4 Pro",
    model: "deepseek-v4-pro",
    endpointType: "openai_compatible_chat",
    enabled: true,
    defaultEnabled: true,
    sort: 800,
  },
  {
    id: "deepseek:deepseek-v4-flash",
    provider: "deepseek",
    category: "chat",
    displayName: "DeepSeek V4 Flash",
    model: "deepseek-v4-flash",
    endpointType: "openai_compatible_chat",
    enabled: true,
    defaultEnabled: true,
    sort: 810,
  },
  {
    id: "qwen:qwen3.7-max",
    provider: "qwen",
    category: "chat",
    displayName: "Qwen 3.7 Max",
    model: "qwen3.7-max",
    endpointType: "openai_compatible_chat",
    enabled: true,
    defaultEnabled: true,
    sort: 900,
  },
  {
    id: "qwen:qwen3.7-plus",
    provider: "qwen",
    category: "chat",
    displayName: "Qwen 3.7 Plus",
    model: "qwen3.7-plus",
    endpointType: "openai_compatible_chat",
    enabled: true,
    defaultEnabled: true,
    sort: 910,
    capabilities: { vision: true, reasoning: true, tools: true },
  },
  {
    id: "qwen:qwen3.7-flash",
    provider: "qwen",
    category: "chat",
    displayName: "Qwen 3.7 Flash",
    model: "qwen3.7-flash",
    endpointType: "openai_compatible_chat",
    enabled: true,
    defaultEnabled: true,
    sort: 920,
  },
  {
    id: "mistral:mistral-medium-3-5",
    provider: "mistral",
    category: "chat",
    displayName: "Mistral Medium 3.5",
    model: "mistral-medium-3-5",
    endpointType: "openai_compatible_chat",
    enabled: true,
    defaultEnabled: true,
    sort: 1000,
  },
  {
    id: "mistral:mistral-small-2603",
    provider: "mistral",
    category: "chat",
    displayName: "Mistral Small 4",
    model: "mistral-small-2603",
    endpointType: "openai_compatible_chat",
    enabled: true,
    defaultEnabled: true,
    sort: 1010,
  },
  {
    id: "mistral:mistral-large-2512",
    provider: "mistral",
    category: "chat",
    displayName: "Mistral Large 3",
    model: "mistral-large-2512",
    endpointType: "openai_compatible_chat",
    enabled: true,
    defaultEnabled: true,
    sort: 1020,
  },
  {
    id: "zhipu:glm-5.2",
    provider: "zhipu",
    category: "chat",
    displayName: "GLM-5.2",
    model: "glm-5.2",
    endpointType: "openai_compatible_chat",
    enabled: true,
    defaultEnabled: true,
    sort: 1100,
    capabilities: { reasoning: true, tools: true },
  },
  {
    id: "zhipu:glm-5.1",
    provider: "zhipu",
    category: "chat",
    displayName: "GLM-5.1",
    model: "glm-5.1",
    endpointType: "openai_compatible_chat",
    enabled: true,
    defaultEnabled: true,
    sort: 1110,
    capabilities: { reasoning: true, tools: true },
  },
  {
    id: "zhipu:glm-4.7-flash",
    provider: "zhipu",
    category: "chat",
    displayName: "GLM-4.7 Flash",
    model: "glm-4.7-flash",
    endpointType: "openai_compatible_chat",
    enabled: true,
    defaultEnabled: true,
    sort: 1120,
    capabilities: { reasoning: true, tools: true },
  },
  {
    id: "openai:seedance-2-0",
    provider: "openai",
    category: "video",
    displayName: "Seedance 2.0 (即梦)",
    model: "bytedance/seedance-2.0",
    endpointType: "openai_compatible_video",
    enabled: false,
    defaultEnabled: false,
    sort: 1200,
    capabilities: { videoGeneration: true },
  },
  {
    id: "openai:kling-v3-0-pro",
    provider: "openai",
    category: "video",
    displayName: "Kling 3.0 Pro (可灵)",
    model: "kwaivgi/kling-v3.0-pro",
    endpointType: "openai_compatible_video",
    enabled: false,
    defaultEnabled: false,
    sort: 1210,
    capabilities: { videoGeneration: true },
  },
  {
    id: "openai:veo-3-1",
    provider: "openai",
    category: "video",
    displayName: "Veo 3.1 (Google)",
    model: "google/veo-3.1",
    endpointType: "openai_compatible_video",
    enabled: false,
    defaultEnabled: false,
    sort: 1220,
    capabilities: { videoGeneration: true },
  },
];

export function normalizeCompanyModel(
  input: Partial<CompanyModel>,
  fallback?: CompanyModel,
): CompanyModel {
  const provider = input.provider ?? fallback?.provider ?? "openai";
  const category = input.category ?? fallback?.category ?? "chat";
  const model = String(input.model ?? fallback?.model ?? "").trim();
  const id = String(input.id ?? fallback?.id ?? `${provider}:${model}`).trim();

  return {
    id,
    provider,
    category,
    displayName:
      String(
        input.displayName ?? fallback?.displayName ?? (model || id),
      ).trim() || id,
    model,
    endpointType:
      input.endpointType ?? fallback?.endpointType ?? "not_implemented",
    enabled: input.enabled ?? fallback?.enabled ?? false,
    defaultEnabled: input.defaultEnabled ?? fallback?.defaultEnabled ?? false,
    adminOnly: input.adminOnly ?? fallback?.adminOnly,
    legacy: input.legacy ?? fallback?.legacy,
    deprecated: input.deprecated ?? fallback?.deprecated,
    sort: Number.isFinite(input.sort)
      ? Number(input.sort)
      : fallback?.sort ?? 9999,
    capabilities: input.capabilities ?? fallback?.capabilities,
  };
}

export function mergeCompanyModels(models: Partial<CompanyModel>[] = []) {
  const persistedEnabled = new Map(
    models
      .filter(
        (model): model is Partial<CompanyModel> & { id: string } =>
          typeof model?.id === "string" && typeof model.enabled === "boolean",
      )
      .map((model) => [model.id, model.enabled] as const),
  );

  return DEFAULT_COMPANY_MODELS.map((model) => ({
    ...model,
    enabled: persistedEnabled.get(model.id) ?? model.enabled,
  })).sort((a, b) => a.sort - b.sort);
}

export function toCompanyLLMModel(model: CompanyModel) {
  return {
    name: model.model,
    displayName: model.displayName,
    category: model.category,
    available: true,
    sorted: model.sort,
    capabilities: model.capabilities,
    provider: {
      id: model.provider,
      providerName: MODEL_PROVIDER_LABELS[model.provider],
      providerType: model.provider,
      sorted: MODEL_PROVIDER_SORT[model.provider],
    },
  };
}

export function findCompanyModelByProviderModel(
  models: CompanyModel[],
  provider: ModelProvider,
  modelName: string,
) {
  const normalized = modelName.trim().toLowerCase();
  return models.find(
    (model) =>
      model.provider === provider && model.model.toLowerCase() === normalized,
  );
}
