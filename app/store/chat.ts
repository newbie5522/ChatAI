import {
  getMessageTextContent,
  isDalle3,
  safeLocalStorage,
  trimTopic,
} from "../utils";

import { indexedDBStorage } from "@/app/utils/indexedDB-storage";
import { nanoid } from "nanoid";
import type {
  ClientApi,
  MultimodalContent,
  RequestMessage,
} from "../client/api";
import { getClientApi } from "../client/api";
import { ChatControllerPool } from "../client/controller";
import { showToast } from "../components/ui-lib";
import {
  DEFAULT_INPUT_TEMPLATE,
  DEFAULT_MODELS,
  DEFAULT_SYSTEM_TEMPLATE,
  GEMINI_SUMMARIZE_MODEL,
  DEEPSEEK_SUMMARIZE_MODEL,
  KnowledgeCutOffDate,
  MCP_SYSTEM_TEMPLATE,
  MCP_TOOLS_TEMPLATE,
  ServiceProvider,
  StoreKey,
  SUMMARIZE_MODEL,
} from "../constant";
import Locale, { getLang } from "../locales";
import { createPersistStore } from "../utils/store";
import { estimateTokenLength } from "../utils/token";
import { ModelConfig, ModelType, useAppConfig } from "./config";
import { useAccessStore } from "./access";
import { useAccountStore } from "./account";
import {
  collectModelsWithDefaultModel,
  findAccountModel,
} from "../utils/model";
import { createEmptyMask, Mask } from "./mask";
import { executeMcpAction, getAllTools, isMcpEnabled } from "../mcp/actions";
import { extractMcpJson, isMcpJson } from "../mcp/utils";
import type {
  AttachmentContextResponse,
  AttachmentKind,
  StoredAttachmentMetadata,
  TransientChatAttachment,
} from "../types/attachment";
import {
  buildAttachmentContext,
  toStoredAttachmentMetadata,
} from "../utils/attachments";
import {
  clearMessageMedia,
  deleteUnreferencedMessageMedia,
} from "../utils/message-media-store";

const localStorage = safeLocalStorage();

export type ChatMessageTool = {
  id: string;
  index?: number;
  type?: string;
  function?: {
    name: string;
    arguments?: string;
  };
  content?: string;
  isError?: boolean;
  errorMsg?: string;
};

export type ChatMessage = RequestMessage & {
  date: string;
  streaming?: boolean;
  isError?: boolean;
  id: string;
  model?: ModelType;
  tools?: ChatMessageTool[];
  audio_url?: string;
  isMcpResponse?: boolean;
  attachments?: StoredAttachmentMetadata[];
  providerName?: string;
  canceled?: boolean;
};

export interface ChatRequestHandle {
  requestId: string;
  sessionId: string;
  messageId: string;
  accepted: boolean;
  completion: Promise<"finished" | "failed" | "canceled">;
}

export function createMessage(override: Partial<ChatMessage>): ChatMessage {
  return {
    id: nanoid(),
    date: new Date().toLocaleString(),
    role: "user",
    content: "",
    ...override,
  };
}

export interface ChatStat {
  tokenCount: number;
  wordCount: number;
  charCount: number;
}

export interface ChatSession {
  id: string;
  topic: string;

  memoryPrompt: string;
  messages: ChatMessage[];
  stat: ChatStat;
  lastUpdate: number;
  lastSummarizeIndex: number;
  clearContextIndex?: number;

  mask: Mask;
}

export const DEFAULT_TOPIC = Locale.Store.DefaultTopic;
export const BOT_HELLO: ChatMessage = createMessage({
  role: "assistant",
  content: Locale.Store.BotHello,
});
const CHAT_REQUEST_FAILED_MESSAGE =
  "请求失败，请检查服务商 Key、模型 API ID、余额或接口地址。";

function createEmptySession(): ChatSession {
  return {
    id: nanoid(),
    topic: DEFAULT_TOPIC,
    memoryPrompt: "",
    messages: [],
    stat: {
      tokenCount: 0,
      wordCount: 0,
      charCount: 0,
    },
    lastUpdate: Date.now(),
    lastSummarizeIndex: 0,

    mask: createEmptyMask(),
  };
}

function messageMediaIds(messages: ChatMessage[]) {
  return messages.flatMap((message) =>
    (message.attachments ?? [])
      .map((attachment) => attachment.mediaId)
      .filter((mediaId): mediaId is string => Boolean(mediaId)),
  );
}

function referencedMediaIds(sessions: ChatSession[]) {
  return new Set(
    sessions.flatMap((session) => messageMediaIds(session.messages)),
  );
}

function getSummarizeModel(
  currentModel: string,
  providerName: string,
): string[] {
  const safeCurrentModel = currentModel || "";
  // if it is using gpt-* models, force to use 4o-mini to summarize
  if (
    safeCurrentModel.startsWith("gpt") ||
    safeCurrentModel.startsWith("chatgpt")
  ) {
    const configStore = useAppConfig.getState();
    const accessStore = useAccessStore.getState();
    const allModel = collectModelsWithDefaultModel(
      configStore.models,
      [configStore.customModels, accessStore.customModels].join(","),
      accessStore.defaultModel,
    );
    const summarizeModel = allModel.find(
      (m) => m.name === SUMMARIZE_MODEL && m.available,
    );
    if (summarizeModel) {
      return [
        summarizeModel.name,
        summarizeModel.provider?.providerName as string,
      ];
    }
  }
  if (safeCurrentModel.startsWith("gemini")) {
    return [GEMINI_SUMMARIZE_MODEL, ServiceProvider.Google];
  } else if (safeCurrentModel.startsWith("deepseek-")) {
    return [DEEPSEEK_SUMMARIZE_MODEL, ServiceProvider.DeepSeek];
  }

  return [safeCurrentModel, providerName];
}

function getCompanyBackgroundModel(modelConfig: ModelConfig) {
  const accountStore = useAccountStore.getState();
  if (!accountStore.authenticated) return undefined;

  const configuredModel = findAccountModel(
    accountStore.models,
    modelConfig.compressModel,
    modelConfig.compressProviderName,
  );
  return (
    configuredModel ??
    findAccountModel(
      accountStore.models,
      modelConfig.model,
      modelConfig.providerName,
    )
  );
}

function isAttachmentKind(value: unknown): value is AttachmentKind {
  return ["image", "text", "document", "spreadsheet"].includes(String(value));
}

function stripTransientMessageData(message: ChatMessage): ChatMessage {
  const legacyMessage = message as ChatMessage & {
    requestContent?: RequestMessage["content"];
    attachments?: Array<Partial<TransientChatAttachment>>;
  };
  const attachments = Array.isArray(legacyMessage.attachments)
    ? legacyMessage.attachments
        .filter(
          (attachment) =>
            typeof attachment?.id === "string" &&
            typeof attachment.name === "string" &&
            typeof attachment.mimeType === "string" &&
            typeof attachment.size === "number" &&
            isAttachmentKind(attachment.kind),
        )
        .map((attachment) => ({
          id: attachment.id as string,
          name: attachment.name as string,
          mimeType: attachment.mimeType as string,
          size: attachment.size as number,
          kind: attachment.kind as StoredAttachmentMetadata["kind"],
          truncated:
            typeof attachment.truncated === "boolean"
              ? attachment.truncated
              : undefined,
          analysisMode:
            attachment.analysisMode === "direct" ||
            attachment.analysisMode === "document_index" ||
            attachment.analysisMode === "table_analysis"
              ? attachment.analysisMode
              : undefined,
          rowCount:
            typeof attachment.rowCount === "number"
              ? attachment.rowCount
              : undefined,
          columnCount:
            typeof attachment.columnCount === "number"
              ? attachment.columnCount
              : undefined,
          sheetCount:
            typeof attachment.sheetCount === "number"
              ? attachment.sheetCount
              : undefined,
          chunkCount:
            typeof attachment.chunkCount === "number"
              ? attachment.chunkCount
              : undefined,
          mediaId:
            typeof attachment.mediaId === "string"
              ? attachment.mediaId
              : undefined,
          width:
            typeof attachment.width === "number" ? attachment.width : undefined,
          height:
            typeof attachment.height === "number"
              ? attachment.height
              : undefined,
          previewAvailable:
            typeof attachment.previewAvailable === "boolean"
              ? attachment.previewAvailable
              : undefined,
        }))
    : undefined;

  const content = Array.isArray(message.content)
    ? message.content.filter((part) => {
        if (part.type !== "image_url") return true;
        const url = part.image_url?.url ?? "";
        return !url.startsWith("data:") && !url.startsWith("blob:");
      })
    : message.content;
  const sanitized: ChatMessage = {
    ...message,
    content,
    attachments: attachments?.length ? attachments : undefined,
  };
  delete (sanitized as typeof legacyMessage).requestContent;
  return sanitized;
}

function countMessages(msgs: ChatMessage[]) {
  return msgs.reduce(
    (pre, cur) => pre + estimateTokenLength(getMessageTextContent(cur)),
    0,
  );
}

function fillTemplateWith(input: string, modelConfig: ModelConfig) {
  const cutoff =
    KnowledgeCutOffDate[modelConfig.model] ?? KnowledgeCutOffDate.default;
  // Find the model in the DEFAULT_MODELS array that matches the modelConfig.model
  const modelInfo = DEFAULT_MODELS.find((m) => m.name === modelConfig.model);

  var serviceProvider = "OpenAI";
  if (modelInfo) {
    // TODO: auto detect the providerName from the modelConfig.model

    // Directly use the providerName from the modelInfo
    serviceProvider = modelInfo.provider.providerName;
  }

  const vars = {
    ServiceProvider: serviceProvider,
    cutoff,
    model: modelConfig.model,
    time: new Date().toString(),
    lang: getLang(),
    input: input,
  };

  let output = modelConfig.template ?? DEFAULT_INPUT_TEMPLATE;

  // remove duplicate
  if (input.startsWith(output)) {
    output = "";
  }

  // must contains {{input}}
  const inputVar = "{{input}}";
  if (!output.includes(inputVar)) {
    output += "\n" + inputVar;
  }

  Object.entries(vars).forEach(([name, value]) => {
    const regex = new RegExp(`{{${name}}}`, "g");
    output = output.replace(regex, value.toString()); // Ensure value is a string
  });

  return output;
}

async function getMcpSystemPrompt(): Promise<string> {
  const tools = await getAllTools();

  let toolsStr = "";

  tools.forEach((i) => {
    // error client has no tools
    if (!i.tools) return;

    toolsStr += MCP_TOOLS_TEMPLATE.replace(
      "{{ clientId }}",
      i.clientId,
    ).replace(
      "{{ tools }}",
      i.tools.tools.map((p: object) => JSON.stringify(p, null, 2)).join("\n"),
    );
  });

  return MCP_SYSTEM_TEMPLATE.replace("{{ MCP_TOOLS }}", toolsStr);
}

const DEFAULT_CHAT_STATE = {
  sessions: [createEmptySession()],
  currentSessionIndex: 0,
  lastInput: "",
};

export const useChatStore = createPersistStore(
  DEFAULT_CHAT_STATE,
  (set, _get) => {
    function get() {
      return {
        ..._get(),
        ...methods,
      };
    }

    const methods = {
      forkSession() {
        // 获取当前会话
        const currentSession = get().currentSession();
        if (!currentSession) return;

        const newSession = createEmptySession();

        newSession.topic = currentSession.topic;
        // 深拷贝消息
        newSession.messages = currentSession.messages.map((msg) => ({
          ...msg,
          id: nanoid(), // 生成新的消息 ID
        }));
        newSession.mask = {
          ...currentSession.mask,
          modelConfig: {
            ...currentSession.mask.modelConfig,
          },
        };

        set((state) => ({
          currentSessionIndex: 0,
          sessions: [newSession, ...state.sessions],
        }));
      },

      clearSessions() {
        const candidates = get().sessions.flatMap((session) =>
          messageMediaIds(session.messages),
        );
        set(() => ({
          sessions: [createEmptySession()],
          currentSessionIndex: 0,
        }));
        const accountId = useAccountStore.getState().user?.userId;
        if (accountId) {
          void deleteUnreferencedMessageMedia(
            accountId,
            candidates,
            referencedMediaIds(get().sessions),
          );
        }
      },

      selectSession(index: number) {
        set({
          currentSessionIndex: index,
        });
      },

      moveSession(from: number, to: number) {
        set((state) => {
          const { sessions, currentSessionIndex: oldIndex } = state;

          // move the session
          const newSessions = [...sessions];
          const session = newSessions[from];
          newSessions.splice(from, 1);
          newSessions.splice(to, 0, session);

          // modify current session id
          let newIndex = oldIndex === from ? to : oldIndex;
          if (oldIndex > from && oldIndex <= to) {
            newIndex -= 1;
          } else if (oldIndex < from && oldIndex >= to) {
            newIndex += 1;
          }

          return {
            currentSessionIndex: newIndex,
            sessions: newSessions,
          };
        });
      },

      newSession(mask?: Mask) {
        const session = createEmptySession();

        if (mask) {
          const config = useAppConfig.getState();
          const globalModelConfig = config.modelConfig;

          session.mask = {
            ...mask,
            modelConfig: {
              ...globalModelConfig,
              ...mask.modelConfig,
            },
          };
          session.topic = mask.name;
        }

        set((state) => ({
          currentSessionIndex: 0,
          sessions: [session].concat(state.sessions),
        }));
      },

      nextSession(delta: number) {
        const n = get().sessions.length;
        const limit = (x: number) => (x + n) % n;
        const i = get().currentSessionIndex;
        get().selectSession(limit(i + delta));
      },

      deleteSession(index: number) {
        const deletingLastSession = get().sessions.length === 1;
        const deletedSession = get().sessions.at(index);

        if (!deletedSession) return;

        const sessions = get().sessions.slice();
        sessions.splice(index, 1);

        const currentIndex = get().currentSessionIndex;
        let nextIndex = Math.min(
          currentIndex - Number(index < currentIndex),
          sessions.length - 1,
        );

        if (deletingLastSession) {
          nextIndex = 0;
          sessions.push(createEmptySession());
        }

        // for undo delete action
        const restoreState = {
          currentSessionIndex: get().currentSessionIndex,
          sessions: get().sessions.slice(),
        };

        set(() => ({
          currentSessionIndex: nextIndex,
          sessions,
        }));

        const accountId = useAccountStore.getState().user?.userId;
        const candidates = messageMediaIds(deletedSession.messages);
        if (accountId && candidates.length > 0) {
          window.setTimeout(() => {
            void deleteUnreferencedMessageMedia(
              accountId,
              candidates,
              referencedMediaIds(get().sessions),
            );
          }, 5200);
        }

        showToast(
          Locale.Home.DeleteToast,
          {
            text: Locale.Home.Revert,
            onClick() {
              set(() => restoreState);
            },
          },
          5000,
        );
      },

      currentSession() {
        let index = get().currentSessionIndex;
        const sessions = get().sessions;

        if (index < 0 || index >= sessions.length) {
          index = Math.min(sessions.length - 1, Math.max(0, index));
          set(() => ({ currentSessionIndex: index }));
        }

        const session = sessions[index];

        return session;
      },

      onNewMessage(message: ChatMessage, targetSession: ChatSession) {
        get().updateTargetSession(targetSession, (session) => {
          session.messages = session.messages.concat();
          session.lastUpdate = Date.now();
        });

        get().updateStat(message, targetSession);

        get().checkMcpJson(message);

        get().summarizeSession(false, targetSession);
      },

      async onUserInput(
        content: string,
        attachments?: TransientChatAttachment[],
        isMcpResponse?: boolean,
      ): Promise<ChatRequestHandle> {
        const session = get().currentSession();
        const modelConfig = session.mask.modelConfig;
        const attachmentList = isMcpResponse ? [] : attachments ?? [];
        const botMessage: ChatMessage = createMessage({
          role: "assistant",
          streaming: true,
          model: modelConfig.model,
          providerName: modelConfig.providerName,
        });
        const rootController = new AbortController();
        if (
          !ChatControllerPool.begin(session.id, botMessage.id, rootController)
        ) {
          throw new Error("当前会话已有请求正在生成。");
        }
        let resolveCompletion:
          | ((state: "finished" | "failed" | "canceled") => void)
          | undefined;
        const completion = new Promise<"finished" | "failed" | "canceled">(
          (resolve) => {
            resolveCompletion = resolve;
          },
        );
        const handle: ChatRequestHandle = {
          requestId: botMessage.id,
          sessionId: session.id,
          messageId: botMessage.id,
          accepted: false,
          completion,
        };
        let settled = false;
        const settle = (state: "finished" | "failed" | "canceled") => {
          if (settled) return;
          settled = true;
          ChatControllerPool.setState(session.id, botMessage.id, state);
          ChatControllerPool.remove(session.id, botMessage.id);
          resolveCompletion?.(state);
        };

        try {
          const queryContent =
            !isMcpResponse && !content.trim() && attachmentList.length > 0
              ? "请完整分析这些附件，并总结关键数据、异常和可执行结论。"
              : content;
          const analysisIds = attachmentList
            .map((attachment) => attachment.analysisId)
            .filter((analysisId): analysisId is string => Boolean(analysisId));
          let analysisContext = "";
          if (analysisIds.length > 0) {
            const response = await fetch("/api/account/attachments/context", {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ query: queryContent, analysisIds }),
              signal: rootController.signal,
            });
            const body = (await response.json()) as AttachmentContextResponse;
            if (!response.ok || body.error || !body.contexts) {
              throw new Error(body.message || "附件分析失败，请稍后重试。");
            }
            analysisContext = body.contexts
              .map((context) => {
                const content = context.content.replace(
                  /\[附件(?:开始|结束)\]/g,
                  "[附件标记]",
                );
                return `[附件开始]\n文件名：${context.name}\n文件类型：服务器临时分析上下文\n覆盖范围：${context.coverage}\n内容：\n${content}\n[附件结束]`;
              })
              .join("\n\n");
          }
          if (rootController.signal.aborted) {
            throw new DOMException("Request aborted", "AbortError");
          }
          const attachmentContext = buildAttachmentContext(attachmentList);
          const imageUrls = attachmentList
            .map((attachment) => attachment.dataUrl)
            .filter((url): url is string => !!url);
          const templatedContent = isMcpResponse
            ? content
            : fillTemplateWith(queryContent, modelConfig);
          const requestText = [
            templatedContent,
            attachmentContext,
            analysisContext,
          ]
            .filter(Boolean)
            .join("\n\n");
          const requestContent: string | MultimodalContent[] =
            imageUrls.length > 0
              ? [
                  ...(requestText
                    ? [{ type: "text" as const, text: requestText }]
                    : []),
                  ...imageUrls.map((url) => ({
                    type: "image_url" as const,
                    image_url: { url },
                  })),
                ]
              : requestText;

          const userMessage: ChatMessage = createMessage({
            role: "user",
            content,
            attachments: attachmentList.map(toStoredAttachmentMetadata),
            isMcpResponse,
          });
          const requestUserMessage: ChatMessage = {
            ...userMessage,
            content: requestContent,
          };

          // get recent messages
          const recentMessages = await get().getMessagesWithMemory();
          if (rootController.signal.aborted) {
            throw new DOMException("Request aborted", "AbortError");
          }
          const sendMessages = recentMessages.concat(requestUserMessage);
          // save the original visible input separately from the model request.
          get().updateTargetSession(session, (session) => {
            session.messages = session.messages.concat([
              userMessage,
              botMessage,
            ]);
          });
          handle.accepted = true;
          ChatControllerPool.setState(session.id, botMessage.id, "streaming");

          const api: ClientApi = getClientApi(modelConfig.providerName);
          const onRequestError = (error: Error) => {
            const canceled =
              rootController.signal.aborted ||
              error.name === "AbortError" ||
              /abort|cancel/i.test(error.message);
            botMessage.streaming = false;
            if (canceled) {
              botMessage.canceled = true;
              botMessage.isError = false;
              userMessage.isError = false;
              if (!getMessageTextContent(botMessage).trim()) {
                botMessage.content = "已停止生成";
              }
            } else {
              botMessage.content = CHAT_REQUEST_FAILED_MESSAGE;
              userMessage.isError = true;
              botMessage.isError = true;
              console.error("[Chat] request failed");
            }
            get().updateTargetSession(session, (target) => {
              target.messages = target.messages.concat();
            });
            settle(canceled ? "canceled" : "failed");
          };
          void api.llm
            .chat({
              messages: sendMessages,
              config: { ...modelConfig, stream: true },
              signal: rootController.signal,
              onUpdate(message) {
                if (rootController.signal.aborted) return;
                botMessage.streaming = true;
                if (message) {
                  botMessage.content = message;
                }
                get().updateTargetSession(session, (session) => {
                  session.messages = session.messages.concat();
                });
              },
              async onFinish(message) {
                if (rootController.signal.aborted) {
                  if (message) botMessage.content = message;
                  onRequestError(
                    new DOMException("Request aborted", "AbortError"),
                  );
                  return;
                }
                botMessage.streaming = false;
                if (message) {
                  botMessage.content = message;
                  botMessage.date = new Date().toLocaleString();
                  get().onNewMessage(botMessage, session);
                }
                settle("finished");
              },
              onBeforeTool(tool: ChatMessageTool) {
                if (rootController.signal.aborted) return;
                (botMessage.tools = botMessage?.tools || []).push(tool);
                get().updateTargetSession(session, (session) => {
                  session.messages = session.messages.concat();
                });
              },
              onAfterTool(tool: ChatMessageTool) {
                if (rootController.signal.aborted) return;
                botMessage?.tools?.forEach((t, i, tools) => {
                  if (tool.id == t.id) {
                    tools[i] = { ...tool };
                  }
                });
                get().updateTargetSession(session, (session) => {
                  session.messages = session.messages.concat();
                });
              },
              onError(error) {
                onRequestError(error);
              },
              onController(controller) {
                ChatControllerPool.addController(
                  session.id,
                  botMessage.id,
                  controller,
                );
              },
            })
            .catch((error: unknown) =>
              onRequestError(
                error instanceof Error ? error : new Error(String(error)),
              ),
            );
          return handle;
        } catch (error) {
          const canceled =
            rootController.signal.aborted ||
            (error instanceof Error && error.name === "AbortError");
          settle(canceled ? "canceled" : "failed");
          throw error;
        }
      },

      getMemoryPrompt() {
        const session = get().currentSession();

        if (session.memoryPrompt.length) {
          return {
            role: "system",
            content: Locale.Store.Prompt.History(session.memoryPrompt),
            date: "",
          } as ChatMessage;
        }
      },

      async getMessagesWithMemory() {
        const session = get().currentSession();
        const modelConfig = session.mask.modelConfig;
        const clearContextIndex = session.clearContextIndex ?? 0;
        const messages = session.messages.slice();
        const totalMessageCount = session.messages.length;

        // in-context prompts
        const contextPrompts = session.mask.context.slice();

        // system prompts, to get close to OpenAI Web ChatGPT
        const shouldInjectSystemPrompts =
          modelConfig.enableInjectSystemPrompts &&
          ((session.mask.modelConfig.model || "").startsWith("gpt-") ||
            (session.mask.modelConfig.model || "").startsWith("chatgpt-"));

        const mcpEnabled = await isMcpEnabled();
        const mcpSystemPrompt = mcpEnabled ? await getMcpSystemPrompt() : "";

        var systemPrompts: ChatMessage[] = [];

        if (shouldInjectSystemPrompts) {
          systemPrompts = [
            createMessage({
              role: "system",
              content:
                fillTemplateWith("", {
                  ...modelConfig,
                  template: DEFAULT_SYSTEM_TEMPLATE,
                }) + mcpSystemPrompt,
            }),
          ];
        } else if (mcpEnabled) {
          systemPrompts = [
            createMessage({
              role: "system",
              content: mcpSystemPrompt,
            }),
          ];
        }

        const memoryPrompt = get().getMemoryPrompt();
        // long term memory
        const shouldSendLongTermMemory =
          modelConfig.sendMemory &&
          session.memoryPrompt &&
          session.memoryPrompt.length > 0 &&
          session.lastSummarizeIndex > clearContextIndex;
        const longTermMemoryPrompts =
          shouldSendLongTermMemory && memoryPrompt ? [memoryPrompt] : [];
        const longTermMemoryStartIndex = session.lastSummarizeIndex;

        // short term memory
        const shortTermMemoryStartIndex = Math.max(
          0,
          totalMessageCount - modelConfig.historyMessageCount,
        );

        // lets concat send messages, including 4 parts:
        // 0. system prompt: to get close to OpenAI Web ChatGPT
        // 1. long term memory: summarized memory messages
        // 2. pre-defined in-context prompts
        // 3. short term memory: latest n messages
        // 4. newest input message
        const memoryStartIndex = shouldSendLongTermMemory
          ? Math.min(longTermMemoryStartIndex, shortTermMemoryStartIndex)
          : shortTermMemoryStartIndex;
        // and if user has cleared history messages, we should exclude the memory too.
        const contextStartIndex = Math.max(clearContextIndex, memoryStartIndex);
        const historyTokenThreshold =
          modelConfig.compressMessageLengthThreshold;

        // get recent messages as much as possible
        const reversedRecentMessages = [];
        for (
          let i = totalMessageCount - 1, tokenCount = 0;
          i >= contextStartIndex && tokenCount < historyTokenThreshold;
          i -= 1
        ) {
          const msg = messages[i];
          if (!msg || msg.isError) continue;
          tokenCount += estimateTokenLength(getMessageTextContent(msg));
          reversedRecentMessages.push({
            ...msg,
            content: msg.content,
          });
        }
        // concat all messages
        const recentMessages = [
          ...systemPrompts,
          ...longTermMemoryPrompts,
          ...contextPrompts,
          ...reversedRecentMessages.reverse(),
        ];

        return recentMessages;
      },

      updateMessage(
        sessionIndex: number,
        messageIndex: number,
        updater: (message?: ChatMessage) => void,
      ) {
        const sessions = get().sessions;
        const session = sessions.at(sessionIndex);
        const messages = session?.messages;
        updater(messages?.at(messageIndex));
        set(() => ({ sessions }));
      },

      resetSession(session: ChatSession) {
        const candidates = messageMediaIds(session.messages);
        get().updateTargetSession(session, (session) => {
          session.messages = [];
          session.memoryPrompt = "";
        });
        const accountId = useAccountStore.getState().user?.userId;
        if (accountId) {
          void deleteUnreferencedMessageMedia(
            accountId,
            candidates,
            referencedMediaIds(get().sessions),
          );
        }
      },

      summarizeSession(
        refreshTitle: boolean = false,
        targetSession: ChatSession,
      ) {
        const config = useAppConfig.getState();
        const session = targetSession;
        const modelConfig = session.mask.modelConfig;
        // skip summarize when using dalle3?
        if (isDalle3(modelConfig.model)) {
          return;
        }

        const accountStore = useAccountStore.getState();
        const companyModel = getCompanyBackgroundModel(modelConfig);
        if (accountStore.authenticated && !companyModel) return;

        const [model, providerName] = companyModel
          ? [companyModel.name, companyModel.provider.providerName]
          : modelConfig.compressModel
          ? [modelConfig.compressModel, modelConfig.compressProviderName]
          : getSummarizeModel(
              session.mask.modelConfig.model,
              session.mask.modelConfig.providerName,
            );
        const api: ClientApi = getClientApi(providerName as ServiceProvider);

        // remove error messages if any
        const messages = session.messages;

        // should summarize topic after chating more than 50 words
        const SUMMARIZE_MIN_LEN = 50;
        if (
          (config.enableAutoGenerateTitle &&
            session.topic === DEFAULT_TOPIC &&
            countMessages(messages) >= SUMMARIZE_MIN_LEN) ||
          refreshTitle
        ) {
          const startIndex = Math.max(
            0,
            messages.length - modelConfig.historyMessageCount,
          );
          const topicMessages = messages
            .slice(
              startIndex < messages.length ? startIndex : messages.length - 1,
              messages.length,
            )
            .concat(
              createMessage({
                role: "user",
                content: Locale.Store.Prompt.Topic,
              }),
            );
          api.llm.chat({
            messages: topicMessages,
            config: {
              model,
              stream: false,
              providerName,
            },
            onFinish(message, responseRes) {
              if (responseRes?.status === 200) {
                get().updateTargetSession(
                  session,
                  (session) =>
                    (session.topic =
                      message.length > 0 ? trimTopic(message) : DEFAULT_TOPIC),
                );
              }
            },
          });
        }
        const summarizeIndex = Math.max(
          session.lastSummarizeIndex,
          session.clearContextIndex ?? 0,
        );
        let toBeSummarizedMsgs = messages
          .filter((msg) => !msg.isError)
          .slice(summarizeIndex);

        const historyMsgLength = countMessages(toBeSummarizedMsgs);

        if (
          historyMsgLength >
          (modelConfig?.compressMessageLengthThreshold || 8000)
        ) {
          const n = toBeSummarizedMsgs.length;
          toBeSummarizedMsgs = toBeSummarizedMsgs.slice(
            Math.max(0, n - modelConfig.historyMessageCount),
          );
        }
        const memoryPrompt = get().getMemoryPrompt();
        if (memoryPrompt) {
          // add memory prompt
          toBeSummarizedMsgs.unshift(memoryPrompt);
        }

        const lastSummarizeIndex = session.messages.length;

        if (
          historyMsgLength > modelConfig.compressMessageLengthThreshold &&
          modelConfig.sendMemory
        ) {
          /** Destruct max_tokens while summarizing
           * this param is just shit
           **/
          const { max_tokens, ...modelcfg } = modelConfig;
          api.llm.chat({
            messages: toBeSummarizedMsgs.concat(
              createMessage({
                role: "system",
                content: Locale.Store.Prompt.Summarize,
                date: "",
              }),
            ),
            config: {
              ...modelcfg,
              stream: true,
              model,
              providerName,
            },
            onUpdate(message) {
              session.memoryPrompt = message;
            },
            onFinish(message, responseRes) {
              if (responseRes?.status === 200) {
                get().updateTargetSession(session, (session) => {
                  session.lastSummarizeIndex = lastSummarizeIndex;
                  session.memoryPrompt = message; // Update the memory prompt for stored it in local storage
                });
              }
            },
            onError() {
              console.error("[Summarize] request failed");
            },
          });
        }
      },

      updateStat(message: ChatMessage, session: ChatSession) {
        get().updateTargetSession(session, (session) => {
          session.stat.charCount += message.content.length;
          // TODO: should update chat count and word count
        });
      },
      updateTargetSession(
        targetSession: ChatSession,
        updater: (session: ChatSession) => void,
      ) {
        const sessions = get().sessions;
        const index = sessions.findIndex((s) => s.id === targetSession.id);
        if (index < 0) return;
        updater(sessions[index]);
        set(() => ({ sessions }));
      },
      async clearAllData() {
        await clearMessageMedia();
        await indexedDBStorage.clear();
        localStorage.clear();
        location.reload();
      },
      setLastInput(lastInput: string) {
        set({
          lastInput,
        });
      },

      /** check if the message contains MCP JSON and execute the MCP action */
      checkMcpJson(message: ChatMessage) {
        const mcpEnabled = isMcpEnabled();
        if (!mcpEnabled) return;
        const content = getMessageTextContent(message);
        if (isMcpJson(content)) {
          try {
            const mcpRequest = extractMcpJson(content);
            if (mcpRequest) {
              executeMcpAction(mcpRequest.clientId, mcpRequest.mcp)
                .then((result) => {
                  const mcpResponse =
                    typeof result === "object"
                      ? JSON.stringify(result)
                      : String(result);
                  return get()
                    .onUserInput(
                      `\`\`\`json:mcp-response:${mcpRequest.clientId}\n${mcpResponse}\n\`\`\``,
                      [],
                      true,
                    )
                    .then((handle) => handle.completion);
                })
                .catch((error) => showToast("MCP execution failed", error));
            }
          } catch {
            console.error("[Chat] MCP payload could not be processed");
          }
        }
      },
    };

    return methods;
  },
  {
    name: StoreKey.Chat,
    version: 3.4,
    migrate(persistedState, version) {
      const state = persistedState as any;
      const newState = JSON.parse(
        JSON.stringify(state),
      ) as typeof DEFAULT_CHAT_STATE;

      if (version < 2) {
        newState.sessions = [];

        const oldSessions = state.sessions;
        for (const oldSession of oldSessions) {
          const newSession = createEmptySession();
          newSession.topic = oldSession.topic;
          newSession.messages = [...oldSession.messages];
          newSession.mask.modelConfig.sendMemory = true;
          newSession.mask.modelConfig.historyMessageCount = 4;
          newSession.mask.modelConfig.compressMessageLengthThreshold = 1000;
          newState.sessions.push(newSession);
        }
      }

      if (version < 3) {
        // migrate id to nanoid
        newState.sessions.forEach((s) => {
          s.id = nanoid();
          s.messages.forEach((m) => (m.id = nanoid()));
        });
      }

      // Enable `enableInjectSystemPrompts` attribute for old sessions.
      // Resolve issue of old sessions not automatically enabling.
      if (version < 3.1) {
        newState.sessions.forEach((s) => {
          if (
            // Exclude those already set by user
            !s.mask.modelConfig.hasOwnProperty("enableInjectSystemPrompts")
          ) {
            // Because users may have changed this configuration,
            // the user's current configuration is used instead of the default
            const config = useAppConfig.getState();
            s.mask.modelConfig.enableInjectSystemPrompts =
              config.modelConfig.enableInjectSystemPrompts;
          }
        });
      }

      // add default summarize model for every session
      if (version < 3.2) {
        newState.sessions.forEach((s) => {
          const config = useAppConfig.getState();
          s.mask.modelConfig.compressModel = config.modelConfig.compressModel;
          s.mask.modelConfig.compressProviderName =
            config.modelConfig.compressProviderName;
        });
      }
      // revert default summarize model for every session
      if (version < 3.3) {
        newState.sessions.forEach((s) => {
          const config = useAppConfig.getState();
          s.mask.modelConfig.compressModel = "";
          s.mask.modelConfig.compressProviderName = "";
        });
      }

      if (version < 3.4) {
        newState.sessions.forEach((session) => {
          session.messages = session.messages.map(stripTransientMessageData);
          session.mask.context = session.mask.context.map(
            stripTransientMessageData,
          );
        });
      }

      return newState as any;
    },
  },
);
