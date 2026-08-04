"use client";

import { COMPANY_API_PATH, REQUEST_TIMEOUT_MS } from "@/app/constant";
import {
  ChatMessageTool,
  useAccountStore,
  useAppConfig,
  useChatStore,
  usePluginStore,
} from "@/app/store";
import { preProcessImageContent, streamWithThink } from "@/app/utils/chat";
import { findAccountModel, getModelCategory } from "@/app/utils/model";
import {
  getMessageTextContent,
  getMessageTextContentWithoutThinking,
  getTimeoutMSByModel,
} from "@/app/utils";
import { fetch } from "@/app/utils/stream";

import {
  ChatOptions,
  LLMApi,
  LLMModel,
  LLMUsage,
  SpeechOptions,
  linkAbortSignal,
} from "../api";

export type CompanyOpenAICompatibleProvider =
  | "xai"
  | "deepseek"
  | "qwen"
  | "mistral"
  | "zhipu";

const CHAT_PATHS: Record<CompanyOpenAICompatibleProvider, string> = {
  xai: `${COMPANY_API_PATH.XAI}/v1/chat/completions`,
  deepseek: `${COMPANY_API_PATH.DeepSeek}/chat/completions`,
  qwen: `${COMPANY_API_PATH.Qwen}/chat/completions`,
  mistral: `${COMPANY_API_PATH.Mistral}/chat/completions`,
  zhipu: `${COMPANY_API_PATH.Zhipu}/chat/completions`,
};

const XAI_IMAGE_PATH = `${COMPANY_API_PATH.XAI}/v1/images/generations`;
const REQUEST_FAILED_MESSAGE =
  "请求失败，请检查服务商 Key、模型 API ID、余额或接口地址。";

interface CompatibleRequest {
  model: string;
  messages: ChatOptions["messages"];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
}

interface ToolCallDelta {
  index?: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface ChatCompletionChunk {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: ToolCallDelta[];
    };
  }>;
}

function jsonObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function responseMessage(value: unknown) {
  const chunk = value as ChatCompletionChunk;
  return chunk.choices?.[0]?.message?.content ?? "";
}

function responseImageUrl(value: unknown) {
  const body = jsonObject(value);
  const dataValue = body?.data;
  const data = Array.isArray(dataValue) ? dataValue : [];
  const first = jsonObject(data[0]);
  return typeof first?.url === "string" ? first.url : "";
}

function parseStreamChunk(text: string, runTools: ChatMessageTool[]) {
  const chunk = JSON.parse(text) as ChatCompletionChunk;
  const delta = chunk.choices?.[0]?.delta;

  for (const toolDelta of delta?.tool_calls ?? []) {
    const index = toolDelta.index ?? 0;
    const argumentsChunk = toolDelta.function?.arguments ?? "";
    if (toolDelta.id) {
      runTools[index] = {
        id: toolDelta.id,
        index,
        type: toolDelta.type,
        function: {
          name: toolDelta.function?.name ?? "",
          arguments: argumentsChunk,
        },
      };
      continue;
    }

    const currentTool = runTools[index];
    if (currentTool?.function && argumentsChunk) {
      currentTool.function.arguments =
        (currentTool.function.arguments ?? "") + argumentsChunk;
    }
  }

  const reasoning = delta?.reasoning_content ?? "";
  if (reasoning) {
    return { isThinking: true, content: reasoning };
  }
  return { isThinking: false, content: delta?.content ?? "" };
}

export class CompanyOpenAICompatibleApi implements LLMApi {
  constructor(private readonly provider: CompanyOpenAICompatibleProvider) {}

  private async requestImage(options: ChatOptions) {
    const lastMessage = options.messages.at(-1);
    const prompt = lastMessage ? getMessageTextContent(lastMessage) : "";
    if (!prompt.trim()) {
      throw new Error("image prompt is required");
    }

    const controller = new AbortController();
    linkAbortSignal(options.signal, controller);
    options.onController?.(controller);
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(XAI_IMAGE_PATH, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: options.config.model,
          prompt,
          messages: options.messages,
        }),
      });
      const json: unknown = await res.json();
      if (!res.ok) {
        throw new Error(REQUEST_FAILED_MESSAGE);
      }

      const url = responseImageUrl(json);
      if (!url) {
        throw new Error("image response did not include a URL");
      }
      options.onFinish(`![Grok Imagine Image](${url})`, res);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async chat(options: ChatOptions): Promise<void> {
    try {
      const accountModels = useAccountStore.getState().models;
      const category = getModelCategory(
        accountModels,
        options.config.model,
        options.config.providerName,
      );
      if (this.provider === "xai" && category === "image") {
        await this.requestImage(options);
        return;
      }

      const modelConfig = {
        ...useAppConfig.getState().modelConfig,
        ...useChatStore.getState().currentSession().mask.modelConfig,
        model: options.config.model,
        providerName: options.config.providerName,
      };
      const accountModel = findAccountModel(
        accountModels,
        modelConfig.model,
        modelConfig.providerName,
      );
      const vision = accountModel?.capabilities?.vision === true;
      const preserveImages = useAccountStore.getState().authenticated || vision;
      const messages: ChatOptions["messages"] = [];
      for (const message of options.messages) {
        const content = preserveImages
          ? await preProcessImageContent(message.content, options.signal)
          : message.role === "assistant"
          ? getMessageTextContentWithoutThinking(message)
          : getMessageTextContent(message);
        messages.push({ role: message.role, content });
      }

      const requestPayload: CompatibleRequest = {
        model: modelConfig.model,
        messages,
        stream: options.config.stream,
        temperature: modelConfig.temperature,
        top_p: modelConfig.top_p,
        max_tokens: modelConfig.max_tokens,
      };
      const controller = new AbortController();
      linkAbortSignal(options.signal, controller);
      options.onController?.(controller);
      const headers = { "Content-Type": "application/json" };
      const chatPath = CHAT_PATHS[this.provider];

      if (options.config.stream) {
        const [tools, funcs] = usePluginStore
          .getState()
          .getAsTools(
            useChatStore.getState().currentSession().mask?.plugin || [],
          );
        const toolList = Array.isArray(tools) ? tools : [];
        streamWithThink(
          chatPath,
          requestPayload,
          headers,
          toolList,
          funcs,
          controller,
          parseStreamChunk,
          (payload, toolCallMessage, toolCallResult) => {
            payload.messages.push(toolCallMessage, ...toolCallResult);
          },
          options,
        );
        return;
      }

      const timeoutId = setTimeout(
        () => controller.abort(),
        getTimeoutMSByModel(modelConfig.model),
      );
      try {
        const res = await fetch(chatPath, {
          method: "POST",
          credentials: "same-origin",
          headers,
          signal: controller.signal,
          body: JSON.stringify(requestPayload),
        });
        const json: unknown = await res.json();
        if (!res.ok) {
          throw new Error(REQUEST_FAILED_MESSAGE);
        }
        options.onFinish(responseMessage(json), res);
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      options.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  speech(_options: SpeechOptions): Promise<ArrayBuffer> {
    return Promise.reject(new Error("Speech is not supported."));
  }

  async usage(): Promise<LLMUsage> {
    return { used: 0, total: 0 };
  }

  async models(): Promise<LLMModel[]> {
    return [];
  }
}
