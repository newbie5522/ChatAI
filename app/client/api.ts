import { getClientConfig } from "../config/client";
import {
  ACCESS_CODE_PREFIX,
  ModelProvider,
  ServiceProvider,
} from "../constant";
import {
  ChatMessageTool,
  ChatMessage,
  ModelType,
  useAccessStore,
  useAccountStore,
  useChatStore,
} from "../store";
import { ChatGPTApi, DalleRequestPayload } from "./platforms/openai";
import { GeminiProApi } from "./platforms/google";
import { PerplexityApi } from "./platforms/perplexity";
import { ClaudeApi } from "./platforms/anthropic";
import { QwenApi } from "./platforms/alibaba";
import { DeepSeekApi } from "./platforms/deepseek";
import { XAIApi } from "./platforms/xai";
import { ChatGLMApi } from "./platforms/glm";
import { CompanyOpenAICompatibleApi } from "./platforms/company-openai-compatible";
import type { CompanyModel } from "../config/model-registry";

export const ROLES = ["system", "user", "assistant"] as const;
export type MessageRole = (typeof ROLES)[number];

export const Models = ["gpt-3.5-turbo", "gpt-4"] as const;
export const TTSModels = ["tts-1", "tts-1-hd"] as const;
export type ChatModel = ModelType;

export interface MultimodalContent {
  type: "text" | "image_url";
  text?: string;
  image_url?: {
    url: string;
  };
}

export interface MultimodalContentForAlibaba {
  text?: string;
  image?: string;
}

export interface RequestMessage {
  role: MessageRole;
  content: string | MultimodalContent[];
}

export interface LLMConfig {
  model: string;
  providerName?: string;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  presence_penalty?: number;
  frequency_penalty?: number;
  size?: DalleRequestPayload["size"];
  quality?: DalleRequestPayload["quality"];
  style?: DalleRequestPayload["style"];
}

export interface SpeechOptions {
  model: string;
  input: string;
  voice: string;
  response_format?: string;
  speed?: number;
  onController?: (controller: AbortController) => void;
}

export interface ChatOptions {
  messages: RequestMessage[];
  config: LLMConfig;

  onUpdate?: (message: string, chunk: string) => void;
  onFinish: (message: string, responseRes: Response) => void;
  onError?: (err: Error) => void;
  onController?: (controller: AbortController) => void;
  onBeforeTool?: (tool: ChatMessageTool) => void;
  onAfterTool?: (tool: ChatMessageTool) => void;
}

export interface LLMUsage {
  used: number;
  total: number;
}

export interface LLMModel {
  name: string;
  displayName?: string;
  category?: "chat" | "search" | "image" | "video";
  available: boolean;
  provider: LLMModelProvider;
  sorted: number;
  capabilities?: CompanyModel["capabilities"];
}

export interface LLMModelProvider {
  id: string;
  providerName: string;
  providerType: string;
  sorted: number;
}

export abstract class LLMApi {
  abstract chat(options: ChatOptions): Promise<void>;
  abstract speech(options: SpeechOptions): Promise<ArrayBuffer>;
  abstract usage(): Promise<LLMUsage>;
  abstract models(): Promise<LLMModel[]>;
}

export class ClientApi {
  public llm: LLMApi;

  constructor(
    provider: ModelProvider = ModelProvider.GPT,
    companyApi?: LLMApi,
  ) {
    if (companyApi) {
      this.llm = companyApi;
      return;
    }

    switch (provider) {
      case ModelProvider.GeminiPro:
        this.llm = new GeminiProApi();
        break;
      case ModelProvider.Perplexity:
        this.llm = new PerplexityApi();
        break;
      case ModelProvider.Claude:
        this.llm = new ClaudeApi();
        break;
      case ModelProvider.Qwen:
        this.llm = new QwenApi();
        break;
      case ModelProvider.DeepSeek:
        this.llm = new DeepSeekApi();
        break;
      case ModelProvider.XAI:
        this.llm = new XAIApi();
        break;
      case ModelProvider.Mistral:
        this.llm = new CompanyOpenAICompatibleApi("mistral");
        break;
      case ModelProvider.Zhipu:
        this.llm = new CompanyOpenAICompatibleApi("zhipu");
        break;
      case ModelProvider.ChatGLM:
        this.llm = new ChatGLMApi();
        break;
      default:
        this.llm = new ChatGPTApi();
    }
  }

  async share(messages: ChatMessage[], avatarUrl: string | null = null) {
    const msgs = messages
      .map((m) => ({
        from: m.role === "user" ? "human" : "gpt",
        value: m.content,
      }))
      .concat([
        {
          from: "human",
          value: "Share from [NewbieChat]: Company internal AI workspace",
        },
      ]);
    // 敬告二开开发者们，为了开源大模型的发展，请不要修改上述消息，此消息用于后续数据清洗使用
    // Please do not modify this message

    console.log("[Share]", messages, msgs);
    const clientConfig = getClientConfig();
    const proxyUrl = "/sharegpt";
    const rawUrl = "https://sharegpt.com/api/conversations";
    const shareUrl = clientConfig?.isApp ? rawUrl : proxyUrl;
    const res = await fetch(shareUrl, {
      body: JSON.stringify({
        avatarUrl,
        items: msgs,
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    const resJson = await res.json();
    console.log("[Share]", resJson);
    if (resJson.id) {
      return `https://shareg.pt/${resJson.id}`;
    }
  }
}

export function getBearerToken(
  apiKey: string,
  noBearer: boolean = false,
): string {
  return validString(apiKey)
    ? `${noBearer ? "" : "Bearer "}${apiKey.trim()}`
    : "";
}

export function validString(x: string): boolean {
  return x?.length > 0;
}

export function getHeaders(ignoreHeaders: boolean = false) {
  const accessStore = useAccessStore.getState();
  const chatStore = useChatStore.getState();
  let headers: Record<string, string> = {};
  if (!ignoreHeaders) {
    headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }
  if (useAccountStore.getState().authenticated) {
    return headers;
  }

  const clientConfig = getClientConfig();

  function getConfig() {
    const modelConfig = chatStore.currentSession().mask.modelConfig;
    const isGoogle = modelConfig.providerName === ServiceProvider.Google;
    const isPerplexity =
      modelConfig.providerName === ServiceProvider.Perplexity;
    const isAzure = modelConfig.providerName === ServiceProvider.Azure;
    const isAnthropic = modelConfig.providerName === ServiceProvider.Anthropic;
    const isAlibaba = modelConfig.providerName === ServiceProvider.Alibaba;
    const isDeepSeek = modelConfig.providerName === ServiceProvider.DeepSeek;
    const isXAI = modelConfig.providerName === ServiceProvider.XAI;
    const isChatGLM = modelConfig.providerName === ServiceProvider.ChatGLM;
    const isEnabledAccessControl = accessStore.enabledAccessControl();
    const userApiKey =
      isPerplexity || isAnthropic
        ? ""
        : isGoogle
        ? accessStore.googleApiKey
        : isAzure
        ? accessStore.azureApiKey
        : isAnthropic
        ? accessStore.anthropicApiKey
        : isAlibaba
        ? accessStore.alibabaApiKey
        : isXAI
        ? accessStore.xaiApiKey
        : isDeepSeek
        ? accessStore.deepseekApiKey
        : isChatGLM
        ? accessStore.chatglmApiKey
        : accessStore.openaiApiKey;
    const apiKey = accessStore.hideUserApiKey ? "" : userApiKey;
    return {
      isGoogle,
      isPerplexity,
      isAzure,
      isAnthropic,
      isAlibaba,
      isDeepSeek,
      isXAI,
      isChatGLM,
      apiKey,
      isEnabledAccessControl,
    };
  }

  function getAuthHeader(): string {
    return isAzure
      ? "api-key"
      : isAnthropic
      ? "x-api-key"
      : isGoogle
      ? "x-goog-api-key"
      : "Authorization";
  }

  const {
    isGoogle,
    isAzure,
    isAnthropic,
    isAlibaba,
    isDeepSeek,
    isXAI,
    isChatGLM,
    apiKey,
    isEnabledAccessControl,
  } = getConfig();
  const authHeader = getAuthHeader();

  const bearerToken = getBearerToken(
    apiKey,
    isAzure || isAnthropic || isGoogle,
  );

  if (bearerToken) {
    headers[authHeader] = bearerToken;
  } else if (isEnabledAccessControl && validString(accessStore.accessCode)) {
    headers["Authorization"] = getBearerToken(
      ACCESS_CODE_PREFIX + accessStore.accessCode,
    );
  }

  return headers;
}

export function getClientApi(provider: ServiceProvider | string): ClientApi {
  switch (provider) {
    case ServiceProvider.Google:
      return new ClientApi(ModelProvider.GeminiPro);
    case ServiceProvider.Perplexity:
      return new ClientApi(ModelProvider.Perplexity);
    case ServiceProvider.Anthropic:
      return new ClientApi(ModelProvider.Claude);
    case ServiceProvider.Alibaba:
      return new ClientApi(ModelProvider.Qwen);
    case ServiceProvider.Qwen:
      return new ClientApi(
        ModelProvider.Qwen,
        new CompanyOpenAICompatibleApi("qwen"),
      );
    case ServiceProvider.DeepSeek:
      return useAccountStore.getState().authenticated
        ? new ClientApi(
            ModelProvider.DeepSeek,
            new CompanyOpenAICompatibleApi("deepseek"),
          )
        : new ClientApi(ModelProvider.DeepSeek);
    case "xAI":
      return new ClientApi(
        ModelProvider.XAI,
        new CompanyOpenAICompatibleApi("xai"),
      );
    case ServiceProvider.XAI:
      return useAccountStore.getState().authenticated
        ? new ClientApi(
            ModelProvider.XAI,
            new CompanyOpenAICompatibleApi("xai"),
          )
        : new ClientApi(ModelProvider.XAI);
    case ServiceProvider.Mistral:
      return new ClientApi(ModelProvider.Mistral);
    case "智谱 GLM":
      return new ClientApi(
        ModelProvider.Zhipu,
        new CompanyOpenAICompatibleApi("zhipu"),
      );
    case ServiceProvider.ChatGLM:
      return new ClientApi(ModelProvider.ChatGLM);
    default:
      return new ClientApi(ModelProvider.GPT);
  }
}
