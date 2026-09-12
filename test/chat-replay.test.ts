import { useChatStore, createMessage } from "../app/store/chat";
import { getClientApi, ChatOptions } from "../app/client/api";

jest.mock("nanoid", () => {
  let id = 0;
  return { nanoid: () => `test-${++id}` };
});

jest.mock("../app/client/api", () => ({ getClientApi: jest.fn() }));
jest.mock("../app/components/ui-lib", () => ({ showToast: jest.fn() }));
jest.mock("../app/mcp/actions", () => ({
  isMcpEnabled: jest.fn().mockResolvedValue(false),
  getAllTools: jest.fn().mockResolvedValue([]),
}));
jest.mock("../app/utils/indexedDB-storage", () => ({
  indexedDBStorage: {
    getItem: async () => null,
    setItem: async () => undefined,
  },
}));
jest.mock("../app/store/account", () => ({
  useAccountStore: { getState: () => ({ authenticated: false, models: [] }) },
}));
jest.mock("../app/store/access", () => ({
  useAccessStore: { getState: () => ({ customModels: "", defaultModel: "" }) },
}));
jest.mock("../app/store/config", () => ({
  useAppConfig: {
    getState: () => ({ enableAutoGenerateTitle: false, models: [] }),
  },
}));
jest.mock("../app/store/mask", () => ({
  createEmptyMask: () => ({
    context: [],
    modelConfig: {
      model: "test-chat",
      providerName: "OpenAI",
      enableInjectSystemPrompts: false,
      template: "{{input}}",
    },
  }),
}));
jest.mock("../app/utils", () => ({
  safeLocalStorage: () => localStorage,
  isDalle3: () => false,
  trimTopic: (text: string) => text,
  getMessageTextContent: (message: {
    content: string | { type: string; text?: string }[];
  }) =>
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n"),
}));

beforeEach(() => {
  useChatStore.getState().newSession();
});

test("regeneration preserves the original user message, both images, and excludes future messages", async () => {
  const session = useChatStore.getState().currentSession();
  const original = createMessage({
    role: "user",
    content: [
      { type: "text", text: "keep product" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      { type: "image_url", image_url: { url: "data:image/png;base64,BBBB" } },
    ],
  });
  const oldAnswer = createMessage({ role: "assistant", content: "old output" });
  const future = createMessage({ role: "user", content: "future instruction" });
  session.messages = [original, oldAnswer, future];
  let sent: ChatOptions | undefined;
  jest.mocked(getClientApi).mockReturnValue({
    llm: {
      chat: async (options: ChatOptions) => {
        sent = options;
        options.onFinish("new output", { ok: true } as Response);
      },
      speech: jest.fn(),
      usage: jest.fn(),
      models: jest.fn(),
    },
    config: jest.fn(),
    prompts: jest.fn(),
    masks: jest.fn(),
    share: jest.fn(),
  });
  await useChatStore
    .getState()
    .onUserInput("keep product", undefined, false, original.id);
  expect(sent?.messages).toHaveLength(1);
  expect(sent?.messages[0].content).toEqual(original.content);
  expect(session.messages[0]).toBe(original);
  expect(session.messages[1].content).toBe("new output");
  expect(session.messages[2]).toBe(future);
});

test.each(["throw", "empty", "callback"])(
  "%s regeneration preserves the old answer and reference image",
  async (outcome) => {
    const session = useChatStore.getState().currentSession();
    const original = createMessage({
      role: "user",
      content: [
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      ],
    });
    const oldAnswer = createMessage({
      role: "assistant",
      content: "old output",
    });
    session.messages = [original, oldAnswer];
    jest.mocked(getClientApi).mockReturnValue({
      llm: {
        chat: async (options: ChatOptions) => {
          if (outcome === "throw") throw new Error("network error");
          if (outcome === "callback")
            options.onError?.(new Error("network error"));
          else options.onFinish("   ", { ok: true } as Response);
        },
        speech: jest.fn(),
        usage: jest.fn(),
        models: jest.fn(),
      },
      config: jest.fn(),
      prompts: jest.fn(),
      masks: jest.fn(),
      share: jest.fn(),
    });
    await useChatStore
      .getState()
      .onUserInput("", undefined, false, original.id);
    expect(session.messages).toEqual([original, oldAnswer]);
  },
);
