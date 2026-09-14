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
import {
  summaryBoundary,
  summaryBatchEnd,
  historyStart,
} from "../utils/conversation-history";
import { conversationAttachments } from "../utils/conversation-attachments";
import {
  prepareRequestHistory,
  MEMORY_SUMMARY_PROMPT,
} from "../utils/request-history";
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

const localStorage = safeLocalStorage();
const pendingSummaries = new Set<string>();

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
};

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
  const textModels = accountStore.models.filter(
    (model) => model.category === "chat" || model.category === "search",
  );

  const configuredModel = findAccountModel(
    textModels,
    modelConfig.compressModel,
    modelConfig.compressProviderName,
  );
  return (
    configuredModel ??
    findAccountModel(textModels, modelConfig.model, modelConfig.providerName)
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

function sanitizeDisplayError(message: string) {
  return message
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "[image]")
    .replace(/\b[A-Za-z0-9+/]{120,}={0,2}\b/g, "[redacted]")
    .replace(
      /(authorization|api[_-]?key|x-api-key)(["'\s:=]+)([^"',\s}]+)/gi,
      "$1$2[redacted]",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function hasUsableMessageContent(message: ChatMessage) {
  const content = message.content;

  if (typeof content === "string") {
    return content.trim().length > 0;
  }

  if (Array.isArray(content)) {
    return content.some((part) => {
      if (!part || typeof part !== "object") return false;

      if (part.type === "text") {
        return typeof part.text === "string" && part.text.trim().length > 0;
      }

      if (part.type === "image_url") {
        const url = part.image_url?.url;
        return typeof url === "string" && url.trim().length > 0;
      }

      return false;
    });
  }

  return false;
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
        set(() => ({
          sessions: [createEmptySession()],
          currentSessionIndex: 0,
        }));
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
        replayMessageId?: string,
        onInputAccepted?: () => void,
      ) {
        const session = get().currentSession();
        const modelConfig = { ...session.mask.modelConfig };
        const replayIndex = replayMessageId
          ? session.messages.findIndex(
              (message) =>
                message.id === replayMessageId && message.role === "user",
            )
          : -1;
        if (replayMessageId && replayIndex < 0)
          throw new Error("原始消息已不存在。");
        const replayMessage =
          replayIndex >= 0 ? session.messages[replayIndex] : undefined;

        const attachmentList = isMcpResponse ? [] : attachments ?? [];
        const queryContent =
          !isMcpResponse && !content.trim() && attachmentList.length > 0
            ? "请完整分析这些附件，并总结关键数据、异常和可执行结论。"
            : content;
        const selectedModel = findAccountModel(
          useAccountStore.getState().models,
          modelConfig.model,
          modelConfig.providerName,
        );
        const documentAttachments =
          isMcpResponse ||
          selectedModel?.category === "image" ||
          selectedModel?.category === "video"
            ? []
            : conversationAttachments(
                session.messages.slice(
                  session.clearContextIndex ?? 0,
                  replayIndex >= 0 ? replayIndex : undefined,
                ),
                replayMessage?.attachments ?? attachmentList,
                queryContent,
              );
        if (
          documentAttachments.some(
            (item) => !item.analysisId && item.text === undefined,
          )
        ) {
          throw new Error(
            "这条历史消息的文档正文未保存，请重新上传文件后继续分析。",
          );
        }
        const analysisIds = documentAttachments
          .map((attachment) => attachment.analysisId)
          .filter((analysisId): analysisId is string => Boolean(analysisId));
        let analysisContext = "";
        for (let offset = 0; offset < analysisIds.length; offset += 4) {
          const response = await fetch("/api/account/attachments/context", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: queryContent,
              analysisIds: analysisIds.slice(offset, offset + 4),
            }),
          });
          const body = (await response.json()) as AttachmentContextResponse;
          if (!response.ok || body.error || !body.contexts) {
            throw new Error(body.message || "附件分析失败，请稍后重试。");
          }
          analysisContext +=
            body.contexts
              .map((context) => {
                const content = context.content.replace(
                  /\[附件(?:开始|结束)\]/g,
                  "[附件标记]",
                );
                return `[附件开始]\n文件名：${context.name}\n文件类型：服务器临时分析上下文\n覆盖范围：${context.coverage}\n内容：\n${content}\n[附件结束]`;
              })
              .join("\n\n") + "\n\n";
        }
        const attachmentContext = buildAttachmentContext(documentAttachments);
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
        const displayContent: string | MultimodalContent[] =
          imageUrls.length > 0
            ? [
                ...(content.trim()
                  ? [{ type: "text" as const, text: content }]
                  : []),
                ...imageUrls.map((url) => ({
                  type: "image_url" as const,
                  image_url: { url },
                })),
              ]
            : content;

        let userMessage: ChatMessage = createMessage({
          role: "user",
          content: displayContent,
          attachments: attachmentList.map(toStoredAttachmentMetadata),
          isMcpResponse,
        });
        const requestUserMessage: ChatMessage = {
          ...(replayMessage ?? userMessage),
          content: replayMessage
            ? Array.isArray(replayMessage.content)
              ? [
                  { type: "text", text: requestText },
                  ...replayMessage.content.filter(
                    (part) => part.type !== "text",
                  ),
                ]
              : requestText
            : requestContent,
        };
        if (replayMessage) userMessage = replayMessage;

        const botMessage: ChatMessage = createMessage({
          role: "assistant",
          streaming: true,
          model: modelConfig.model,
        });

        // get recent messages
        const recentMessages = await get().getMessagesWithMemory(
          session,
          replayIndex >= 0 ? replayIndex : undefined,
        );
        const backgroundModel = getCompanyBackgroundModel(modelConfig);
        const originalSnapshot = JSON.stringify(session.messages);
        const preparedHistory =
          !isMcpResponse &&
          backgroundModel &&
          selectedModel?.category !== "image" &&
          selectedModel?.category !== "video"
            ? await prepareRequestHistory(
                recentMessages,
                (batch) =>
                  new Promise<string>((resolve, reject) => {
                    let controller: AbortController | undefined;
                    let settled = false;
                    const finish = (message?: string, error?: Error) => {
                      if (settled) return;
                      settled = true;
                      clearTimeout(timer);
                      if (error) reject(error);
                      else resolve(message ?? "");
                    };
                    const timer = setTimeout(() => {
                      finish(
                        undefined,
                        new Error(
                          "历史整理超时，原始记录和输入已保留，请重试。",
                        ),
                      );
                      controller?.abort();
                    }, 30000);
                    Promise.resolve()
                      .then(() =>
                        getClientApi(
                          backgroundModel.provider.providerName,
                        ).llm.chat({
                          messages: [
                            ...batch,
                            { role: "system", content: MEMORY_SUMMARY_PROMPT },
                          ],
                          config: {
                            model: backgroundModel.name,
                            providerName: backgroundModel.provider.providerName,
                            stream: false,
                          },
                          onController(value) {
                            controller = value;
                            if (settled) value.abort();
                          },
                          onFinish(message, response) {
                            if (response?.status !== 200)
                              finish(
                                undefined,
                                new Error(
                                  "历史整理失败，原始记录已保留，请重试。",
                                ),
                              );
                            else finish(message);
                          },
                          onError() {
                            finish(
                              undefined,
                              new Error(
                                "历史整理失败，原始记录和输入已保留，请重试。",
                              ),
                            );
                          },
                        }),
                      )
                      .catch(() =>
                        finish(
                          undefined,
                          new Error("历史整理失败，原始记录已保留，请重试。"),
                        ),
                      );
                  }),
              )
            : recentMessages;
        if (
          JSON.stringify(session.messages) !== originalSnapshot ||
          get().currentSession().id !== session.id ||
          session.mask.modelConfig.model !== modelConfig.model ||
          session.mask.modelConfig.providerName !== modelConfig.providerName
        )
          throw new Error(
            "对话已发生变化，输入尚未发送，请在当前会话重新发送。",
          );
        const sendMessages = preparedHistory.concat(requestUserMessage);
        const messageIndex = session.messages.length + 1;
        const previousResponse =
          replayMessage &&
          session.messages[replayIndex + 1]?.role === "assistant"
            ? session.messages[replayIndex + 1]
            : undefined;

        // save the original visible input separately from the model request.
        get().updateTargetSession(session, (session) => {
          if (replayMessage) {
            session.messages = session.messages.slice();
            session.messages.splice(
              replayIndex + 1,
              previousResponse ? 1 : 0,
              botMessage,
            );
            session.memoryPrompt = "";
            session.lastSummarizeIndex = 0;
          } else {
            session.messages = session.messages.concat([
              userMessage,
              botMessage,
            ]);
          }
        });

        onInputAccepted?.();
        const api: ClientApi = getClientApi(modelConfig.providerName);
        // make request
        await api.llm
          .chat({
            messages: sendMessages,
            config: { ...modelConfig, stream: true },
            onUpdate(message) {
              botMessage.streaming = true;
              if (message) {
                botMessage.content = message;
              }
              get().updateTargetSession(session, (session) => {
                session.messages = session.messages.concat();
              });
            },
            async onFinish(message) {
              botMessage.streaming = false;
              if (message.trim()) {
                botMessage.content = message;
                botMessage.date = new Date().toLocaleString();
                userMessage.isError = false;
                get().onNewMessage(botMessage, session);
              } else if (previousResponse) {
                get().updateTargetSession(session, (target) => {
                  target.messages = target.messages.map((item) =>
                    item.id === botMessage.id ? previousResponse : item,
                  );
                });
                showToast("模型未返回内容，已保留原回复。");
              }
              ChatControllerPool.remove(session.id, botMessage.id);
            },
            onBeforeTool(tool: ChatMessageTool) {
              (botMessage.tools = botMessage?.tools || []).push(tool);
              get().updateTargetSession(session, (session) => {
                session.messages = session.messages.concat();
              });
            },
            onAfterTool(tool: ChatMessageTool) {
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
              const isAborted = error.message?.includes?.("aborted");
              const rawMessage =
                error instanceof Error && error.message
                  ? error.message
                  : "请求失败，请稍后重试。";
              botMessage.content =
                sanitizeDisplayError(rawMessage) || "请求失败，请稍后重试。";
              botMessage.streaming = false;
              if (!replayMessage) userMessage.isError = !isAborted;
              botMessage.isError = !isAborted;
              get().updateTargetSession(session, (session) => {
                if (previousResponse) {
                  const index = session.messages.findIndex(
                    (message) => message.id === botMessage.id,
                  );
                  if (index >= 0) session.messages[index] = previousResponse;
                  showToast(botMessage.content as string);
                }
                session.messages = session.messages.concat();
              });
              ChatControllerPool.remove(
                session.id,
                botMessage.id ?? messageIndex,
              );

              console.error("[Chat] request failed");
            },
            onController(controller) {
              // collect controller for stop/retry
              ChatControllerPool.addController(
                session.id,
                botMessage.id ?? messageIndex,
                controller,
              );
            },
          })
          .catch((error: unknown) => {
            botMessage.streaming = false;
            botMessage.isError = true;
            const message = sanitizeDisplayError(
              error instanceof Error ? error.message : "请求失败，请稍后重试。",
            );
            botMessage.content = message;
            get().updateTargetSession(session, (target) => {
              if (previousResponse) {
                const index = target.messages.findIndex(
                  (item) => item.id === botMessage.id,
                );
                if (index >= 0) target.messages[index] = previousResponse;
                showToast(message);
              }
              target.messages = target.messages.slice();
            });
            ChatControllerPool.remove(session.id, botMessage.id);
          });
      },

      getMemoryPrompt(targetSession?: ChatSession): ChatMessage | undefined {
        const session = targetSession ?? get().currentSession();
        if (session.memoryPrompt.length) {
          return {
            role: "system",
            content: Locale.Store.Prompt.History(session.memoryPrompt),
            date: "",
          } as ChatMessage;
        }
      },

      async getMessagesWithMemory(
        targetSession?: ChatSession,
        beforeIndex?: number,
      ): Promise<ChatMessage[]> {
        const session = targetSession ?? get().currentSession();
        const modelConfig = session.mask.modelConfig;
        const clearContextIndex = session.clearContextIndex ?? 0;
        const messages = session.messages.slice(0, beforeIndex);
        const totalMessageCount = messages.length;

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

        const memoryPrompt = get().getMemoryPrompt(session);
        // long term memory
        const shouldSendLongTermMemory =
          beforeIndex === undefined &&
          session.memoryPrompt &&
          session.memoryPrompt.length > 0 &&
          session.lastSummarizeIndex > clearContextIndex;
        const longTermMemoryPrompts =
          shouldSendLongTermMemory && memoryPrompt ? [memoryPrompt] : [];
        // Never omit a message until a completed summary covers it.
        const contextStartIndex = historyStart(
          clearContextIndex,
          session.lastSummarizeIndex,
          Boolean(shouldSendLongTermMemory),
          beforeIndex !== undefined,
        );

        // get recent messages as much as possible
        const reversedRecentMessages = [];
        for (let i = totalMessageCount - 1; i >= contextStartIndex; i -= 1) {
          const msg = messages[i];
          if (!msg || msg.isError || !hasUsableMessageContent(msg)) continue;
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
        get().updateTargetSession(session, (session) => {
          session.messages = [];
          session.memoryPrompt = "";
        });
      },

      summarizeSession(
        refreshTitle: boolean = false,
        targetSession: ChatSession,
      ) {
        const config = useAppConfig.getState();
        const session = targetSession;
        const modelConfig = session.mask.modelConfig;
        // skip summarize when using dalle3?
        const selected = findAccountModel(
          useAccountStore.getState().models,
          modelConfig.model,
          modelConfig.providerName,
        );
        if (
          selected?.category === "image" ||
          selected?.category === "video" ||
          isDalle3(modelConfig.model)
        ) {
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
        const eligibleEndIndex = summaryBoundary(messages, summarizeIndex);
        const summaryEndIndex = summaryBatchEnd(
          messages,
          summarizeIndex,
          eligibleEndIndex,
        );
        let toBeSummarizedMsgs = messages
          .slice(summarizeIndex, summaryEndIndex)
          .filter((msg) => !msg.isError && !msg.streaming);

        const historyMsgLength = countMessages(
          messages.slice(summarizeIndex, eligibleEndIndex),
        );

        const memoryPrompt = get().getMemoryPrompt(session);
        if (
          memoryPrompt &&
          session.lastSummarizeIndex > (session.clearContextIndex ?? 0)
        ) {
          // add memory prompt
          toBeSummarizedMsgs.unshift(memoryPrompt);
        }

        const lastSummarizeIndex = summaryEndIndex;

        if (
          historyMsgLength > 12000 &&
          !messages
            .slice(summarizeIndex, summaryEndIndex)
            .some((item) => item.streaming) &&
          !pendingSummaries.has(session.id)
        ) {
          pendingSummaries.add(session.id);
          const coveredMessages = messages
            .slice(0, lastSummarizeIndex)
            .map((item) =>
              JSON.stringify([item.id, item.content, item.isError]),
            );
          /** Destruct max_tokens while summarizing
           * this param is just shit
           **/
          const { max_tokens, ...modelcfg } = modelConfig;
          api.llm
            .chat({
              messages: toBeSummarizedMsgs.concat(
                createMessage({
                  role: "system",
                  content: MEMORY_SUMMARY_PROMPT,
                  date: "",
                }),
              ),
              config: {
                ...modelcfg,
                stream: true,
                model,
                providerName,
              },
              onFinish(message, responseRes) {
                pendingSummaries.delete(session.id);
                if (responseRes?.status === 200 && message.trim()) {
                  get().updateTargetSession(session, (session) => {
                    if (
                      Math.max(
                        session.lastSummarizeIndex,
                        session.clearContextIndex ?? 0,
                      ) !== summarizeIndex ||
                      coveredMessages.some((snapshot, index) => {
                        const item = session.messages[index];
                        return (
                          !item ||
                          snapshot !==
                            JSON.stringify([
                              item.id,
                              item.content,
                              item.isError,
                            ])
                        );
                      })
                    )
                      return;
                    session.lastSummarizeIndex = lastSummarizeIndex;
                    session.memoryPrompt = message; // Update the memory prompt for stored it in local storage
                  });
                }
              },
              onError() {
                pendingSummaries.delete(session.id);
                console.error("[Summarize] request failed");
              },
            })
            .catch(() => pendingSummaries.delete(session.id));
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
                  get().onUserInput(
                    `\`\`\`json:mcp-response:${mcpRequest.clientId}\n${mcpResponse}\n\`\`\``,
                    [],
                    true,
                  );
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
    version: 3.5,
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

      if (version < 3.5) {
        // Old summaries may have skipped messages. Rebuild from retained originals.
        newState.sessions.forEach((session) => {
          session.memoryPrompt = "";
          session.lastSummarizeIndex = 0;
        });
      }

      return newState as any;
    },
  },
);
