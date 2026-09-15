"use client";
// azure and openai, using same models. so using same LLMApi.
import { ApiPath, COMPANY_API_PATH, XAI_BASE_URL, XAI } from "@/app/constant";
import {
  useAccessStore,
  useAppConfig,
  useChatStore,
  useAccountStore,
  ChatMessageTool,
  usePluginStore,
} from "@/app/store";
import { base64Image2Blob, stream, uploadImage } from "@/app/utils/chat";
import {
  ChatOptions,
  getHeaders,
  LLMApi,
  LLMModel,
  SpeechOptions,
} from "../api";
import { getClientConfig } from "@/app/config/client";
import { getTimeoutMSByModel } from "@/app/utils";
import { preProcessImageContent } from "@/app/utils/chat";
import { prepareImageConversation } from "@/app/utils/image-conversation";
import {
  mediaResponseToMessage,
  readMediaResponse,
} from "@/app/utils/media-response";
import { mediaAbortError } from "@/app/utils/media-error";
import { getModelCategory } from "@/app/utils/model";
import { RequestPayload } from "./openai";
import { fetch } from "@/app/utils/stream";

export class XAIApi implements LLMApi {
  private disableListModels = true;

  path(path: string): string {
    const accessStore = useAccessStore.getState();

    let baseUrl = "";

    if (
      !useAccountStore.getState().authenticated &&
      accessStore.useCustomConfig &&
      !accessStore.hideUserApiKey
    ) {
      baseUrl = accessStore.xaiUrl;
    }

    if (baseUrl.length === 0) {
      const isApp = !!getClientConfig()?.isApp;
      const apiPath = COMPANY_API_PATH.XAI;
      baseUrl = isApp ? XAI_BASE_URL : apiPath;
    }

    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, baseUrl.length - 1);
    }
    if (
      !baseUrl.startsWith("http") &&
      !baseUrl.startsWith(ApiPath.XAI) &&
      !baseUrl.startsWith(COMPANY_API_PATH.XAI)
    ) {
      baseUrl = "https://" + baseUrl;
    }

    console.log("[Proxy Endpoint] ", baseUrl, path);

    return [baseUrl, path].join("/");
  }

  extractMessage(res: any) {
    return res.choices?.at(0)?.message?.content ?? "";
  }

  speech(options: SpeechOptions): Promise<ArrayBuffer> {
    throw new Error("Method not implemented.");
  }

  async chat(options: ChatOptions) {
    const modelCategory = getModelCategory(
      useAccountStore.getState().models,
      options.config.model,
      options.config.providerName,
    );
    if (modelCategory === "image") {
      const controller = new AbortController();
      options.onController?.(controller);
      let timedOut = false;
      try {
        const { prompt } = await prepareImageConversation(options.messages);
        const timeoutId = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, getTimeoutMSByModel(options.config.model));
        const res = await fetch(COMPANY_API_PATH.XAI, {
          method: "POST",
          body: JSON.stringify({ model: options.config.model, prompt }),
          signal: controller.signal,
          headers: getHeaders(),
        });
        clearTimeout(timeoutId);
        const json = await readMediaResponse(res);
        const message = await mediaResponseToMessage(
          json,
          (b64Json) => uploadImage(base64Image2Blob(b64Json, "image/png")),
          {
            requestId: res.headers.get("x-request-id") ?? "",
            provider: "xai",
            model: options.config.model,
          },
        );
        options.onFinish(message as any, res);
      } catch (error) {
        options.onError?.(
          (error as Error)?.name === "AbortError"
            ? mediaAbortError(timedOut, "xai", options.config.model)
            : (error as Error),
        );
      }
      return;
    }

    const messages: ChatOptions["messages"] = [];
    for (const v of options.messages) {
      const content = await preProcessImageContent(v.content);
      messages.push({ role: v.role, content });
    }

    const modelConfig = {
      ...useAppConfig.getState().modelConfig,
      ...useChatStore.getState().currentSession().mask.modelConfig,
      ...{
        model: options.config.model,
        providerName: options.config.providerName,
      },
    };

    const requestPayload: RequestPayload = {
      messages,
      stream: options.config.stream,
      model: modelConfig.model,
      temperature: modelConfig.temperature,
      presence_penalty: modelConfig.presence_penalty,
      frequency_penalty: modelConfig.frequency_penalty,
      top_p: modelConfig.top_p,
    };

    console.log("[Request] xai payload: ", requestPayload);

    const shouldStream = !!options.config.stream;
    const controller = new AbortController();
    options.onController?.(controller);

    try {
      const chatPath = this.path(XAI.ChatPath);
      const chatPayload = {
        method: "POST",
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
        headers: getHeaders(),
      };

      // make a fetch request
      const requestTimeoutId = setTimeout(
        () => controller.abort(),
        getTimeoutMSByModel(options.config.model),
      );

      if (shouldStream) {
        const [tools, funcs] = usePluginStore
          .getState()
          .getAsTools(
            useChatStore.getState().currentSession().mask?.plugin || [],
          );
        return stream(
          chatPath,
          requestPayload,
          getHeaders(),
          tools as any,
          funcs,
          controller,
          // parseSSE
          (text: string, runTools: ChatMessageTool[]) => {
            // console.log("parseSSE", text, runTools);
            const json = JSON.parse(text);
            const choices = json.choices as Array<{
              delta: {
                content: string;
                tool_calls: ChatMessageTool[];
              };
            }>;
            const tool_calls = choices[0]?.delta?.tool_calls;
            if (tool_calls?.length > 0) {
              const index = tool_calls[0]?.index;
              const id = tool_calls[0]?.id;
              const args = tool_calls[0]?.function?.arguments;
              if (id) {
                runTools.push({
                  id,
                  type: tool_calls[0]?.type,
                  function: {
                    name: tool_calls[0]?.function?.name as string,
                    arguments: args,
                  },
                });
              } else {
                // @ts-ignore
                runTools[index]["function"]["arguments"] += args;
              }
            }
            return choices[0]?.delta?.content;
          },
          // processToolMessage, include tool_calls message and tool call results
          (
            requestPayload: RequestPayload,
            toolCallMessage: any,
            toolCallResult: any[],
          ) => {
            // @ts-ignore
            requestPayload?.messages?.splice(
              // @ts-ignore
              requestPayload?.messages?.length,
              0,
              toolCallMessage,
              ...toolCallResult,
            );
          },
          options,
        );
      } else {
        const res = await fetch(chatPath, chatPayload);
        clearTimeout(requestTimeoutId);

        const resJson = await res.json();
        const message = this.extractMessage(resJson);
        options.onFinish(message, res);
      }
    } catch (e) {
      console.log("[Request] failed to make a chat request", e);
      options.onError?.(e as Error);
    }
  }
  async usage() {
    return {
      used: 0,
      total: 0,
    };
  }

  async models(): Promise<LLMModel[]> {
    return [];
  }
}
