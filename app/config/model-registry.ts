export type ModelProvider = "openai" | "anthropic" | "google" | "perplexity";

export type ModelCategory = "chat" | "image" | "search" | "video";

export type ModelEndpointType =
  | "openai_responses"
  | "openai_images"
  | "anthropic_messages"
  | "google_interactions"
  | "google_generate_content"
  | "google_image"
  | "perplexity_sonar"
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
  anthropic: "Anthropic",
  google: "Google",
  perplexity: "Perplexity",
};

export const MODEL_PROVIDER_SORT: Record<ModelProvider, number> = {
  openai: 1,
  anthropic: 2,
  google: 3,
  perplexity: 4,
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
    enabled: false,
    defaultEnabled: false,
    legacy: true,
    sort: 190,
    capabilities: { reasoning: true, tools: true, vision: true },
  },
  {
    id: "openai:gpt-5.4",
    provider: "openai",
    category: "chat",
    displayName: "GPT-5.4",
    model: "gpt-5.4",
    endpointType: "openai_responses",
    enabled: false,
    defaultEnabled: false,
    legacy: true,
    sort: 195,
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
    sort: 610,
    capabilities: { imageGeneration: true },
  },
  {
    id: "anthropic:claude-fable-5",
    provider: "anthropic",
    category: "chat",
    displayName: "Claude Fable 5",
    model: "claude-fable-5",
    endpointType: "anthropic_messages",
    enabled: true,
    defaultEnabled: true,
    adminOnly: true,
    sort: 300,
    capabilities: { reasoning: true, tools: true, vision: true },
  },
  {
    id: "anthropic:claude-opus-5",
    provider: "anthropic",
    category: "chat",
    displayName: "Claude Opus 5",
    model: "claude-opus-5",
    endpointType: "anthropic_messages",
    enabled: true,
    defaultEnabled: true,
    sort: 310,
    capabilities: { reasoning: true, tools: true, vision: true },
  },
  {
    id: "anthropic:claude-sonnet-5",
    provider: "anthropic",
    category: "chat",
    displayName: "Claude Sonnet 5",
    model: "claude-sonnet-5",
    endpointType: "anthropic_messages",
    enabled: true,
    defaultEnabled: true,
    sort: 320,
    capabilities: { reasoning: true, tools: true, vision: true },
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
    capabilities: { vision: true, tools: true },
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
    capabilities: { vision: true, tools: true },
  },
  {
    id: "google:gemini-3.5-flash-lite",
    provider: "google",
    category: "chat",
    displayName: "Gemini 3.5 Flash Lite",
    model: "gemini-3.5-flash-lite",
    endpointType: "google_generate_content",
    enabled: true,
    defaultEnabled: true,
    sort: 420,
    capabilities: { vision: true },
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
    sort: 430,
    capabilities: { reasoning: true, vision: true, tools: true },
  },
  {
    id: "google:gemini-3-flash-preview",
    provider: "google",
    category: "chat",
    displayName: "Gemini 3 Flash Preview",
    model: "gemini-3-flash-preview",
    endpointType: "google_generate_content",
    enabled: false,
    defaultEnabled: false,
    adminOnly: true,
    sort: 440,
    capabilities: { vision: true, tools: true },
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
    id: "google:nano-banana",
    provider: "google",
    category: "image",
    displayName: "Nano Banana",
    model: "gemini-2.5-flash-image",
    endpointType: "google_image",
    enabled: false,
    defaultEnabled: false,
    legacy: true,
    sort: 590,
    capabilities: { imageGeneration: true },
  },
  {
    id: "google:imagen-4",
    provider: "google",
    category: "image",
    displayName: "Imagen 4",
    model: "imagen-4",
    endpointType: "not_implemented",
    enabled: false,
    defaultEnabled: false,
    legacy: true,
    deprecated: true,
    sort: 590,
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
    capabilities: { webSearch: true },
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
    capabilities: { webSearch: true },
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
    capabilities: { reasoning: true, webSearch: true },
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
    capabilities: { reasoning: true, webSearch: true },
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
  const modelMap = new Map<string, CompanyModel>();
  for (const seed of DEFAULT_COMPANY_MODELS) {
    modelMap.set(seed.id, { ...seed });
  }

  for (const rawModel of models) {
    if (!rawModel?.id) continue;
    const fallback = modelMap.get(rawModel.id);
    modelMap.set(rawModel.id, normalizeCompanyModel(rawModel, fallback));
  }

  return Array.from(modelMap.values()).sort((a, b) => a.sort - b.sort);
}

export function toCompanyLLMModel(model: CompanyModel) {
  return {
    name: model.model,
    displayName: model.displayName,
    category: model.category,
    available: true,
    sorted: model.sort,
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
