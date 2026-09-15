import { useChatStore, createMessage } from "../app/store/chat";
import { getClientApi, ChatOptions } from "../app/client/api";
import { useAccountStore } from "../app/store/account";

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
  useAccountStore: {
    getState: jest.fn(() => ({ authenticated: false, models: [] })),
  },
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
  jest.mocked(useAccountStore.getState).mockReturnValue({
    ...useAccountStore.getState(),
    authenticated: false,
    models: [],
  });
  useChatStore.getState().newSession();
});

test.each(["success", "failure", "switch", "timeout"])(
  "preflight %s protects the actual send path",
  async (outcome) => {
    jest.mocked(useAccountStore.getState).mockReturnValue({
      ...useAccountStore.getState(),
      authenticated: true,
      models: [
        {
          name: "test-chat",
          category: "chat",
          available: true,
          sorted: 0,
          provider: {
            id: "openai",
            providerName: "OpenAI",
            providerType: "custom",
            sorted: 0,
          },
        },
      ],
    });
    const store = useChatStore.getState();
    const session = store.currentSession();
    session.messages = Array.from({ length: 60 }, (_, i) =>
      createMessage({
        role: i % 2 ? "assistant" : "user",
        content: "品牌要求".repeat(100),
      }),
    );
    const initial = session.messages.slice();
    const sent: ChatOptions[] = [];
    jest.mocked(getClientApi).mockReturnValue({
      llm: {
        chat: async (options: ChatOptions) => {
          sent.push(options);
          if (options.config.stream === false) {
            if (outcome === "timeout") return;
            if (outcome === "failure") {
              options.onError?.(new Error("unavailable"));
              return;
            }
            if (outcome === "switch") store.newSession();
            options.onFinish("约束摘要", { status: 200 } as Response);
          }
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
    if (outcome === "success") {
      await store.onUserInput("continue");
      const main = sent.find((options) => options.config.stream);
      expect(main?.messages.at(-1)?.content).toBe("continue");
      expect(main?.messages.length).toBeLessThan(61);
      expect(session.messages.slice(0, 60)).toEqual(initial);
    } else {
      if (outcome === "timeout") {
        jest.useFakeTimers();
        try {
          const result = expect(store.onUserInput("continue")).rejects.toThrow(
            "超时",
          );
          await jest.advanceTimersByTimeAsync(30001);
          await result;
        } finally {
          jest.useRealTimers();
        }
      } else await expect(store.onUserInput("continue")).rejects.toThrow();
      expect(sent.some((options) => options.config.stream)).toBe(false);
      expect(session.messages).toEqual(initial);
    }
  },
);

function captureRequest() {
  let sent: ChatOptions | undefined;
  jest.mocked(getClientApi).mockReturnValue({
    llm: {
      chat: async (options: ChatOptions) => {
        sent = options;
        options.onFinish("answer", { ok: true } as Response);
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
  return () => sent;
}

test("indexed follow-ups retrieve fresh source passages and replay excludes future attachments", async () => {
  const request = captureRequest();
  const originalFetch = globalThis.fetch;
  const fetchContext = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      error: false,
      contexts: [
        {
          name: "report.pdf",
          coverage: "1/3",
          content: "source passage",
          analysisId: "analysis",
          mode: "document_index",
        },
      ],
    }),
  });
  globalThis.fetch = fetchContext;
  try {
    const store = useChatStore.getState();
    const attachment = {
      id: "report",
      name: "report.pdf",
      kind: "document" as const,
      mimeType: "application/pdf",
      size: 8,
      analysisId: "analysis",
    };
    await store.onUserInput("分析", [attachment]);
    const original = store.currentSession().messages[0];
    expect(original.attachments?.[0].analysisId).toBe("analysis");
    await store.onUserInput("异常在哪");
    expect(JSON.parse(fetchContext.mock.calls[1][1].body)).toEqual({
      query: "异常在哪",
      analysisIds: ["analysis"],
    });
    expect(request()?.messages.at(-1)?.content).toContain("source passage");
    store.currentSession().messages.push(
      createMessage({
        role: "user",
        content: "future",
        attachments: [{ ...attachment, analysisId: "future" }],
      }),
    );
    await store.onUserInput("分析", undefined, false, original.id);
    expect(JSON.parse(fetchContext.mock.calls[2][1].body).analysisIds).toEqual([
      "analysis",
    ]);
    fetchContext.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: true, message: "附件已过期，请重新上传。" }),
    });
    const count = store.currentSession().messages.length;
    await expect(store.onUserInput("继续")).rejects.toThrow("过期");
    expect(store.currentSession().messages).toHaveLength(count);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("document text is recalled on follow-up and replay without duplicating visible attachments", async () => {
  const request = captureRequest();
  const store = useChatStore.getState();
  const attachment = {
    id: "brief",
    name: "brief.txt",
    kind: "document" as const,
    mimeType: "text/plain",
    size: 8,
    text: "Brand constraint: blue label must remain.",
  };
  await store.onUserInput("分析", [attachment]);
  const original = store.currentSession().messages[0];
  expect(original.attachments?.[0].text).toBe(attachment.text);
  await store.onUserInput("继续");
  expect(request()?.messages.at(-1)?.content).toContain(attachment.text);
  await store.onUserInput("分析", undefined, false, original.id);
  expect(request()?.messages.at(-1)?.content).toContain(attachment.text);
  expect(store.currentSession().messages[0]).toBe(original);
});

test("30 conversational turns retain original requirements before successful summarization", async () => {
  const session = useChatStore.getState().currentSession();
  session.messages = Array.from({ length: 60 }, (_, index) =>
    createMessage({
      role: index % 2 ? "assistant" : "user",
      content: `requirement ${index}`,
    }),
  );
  const history = await useChatStore.getState().getMessagesWithMemory(session);
  expect(history).toHaveLength(60);
  expect(history[0].content).toBe("requirement 0");
  session.clearContextIndex = 40;
  expect(
    await useChatStore.getState().getMessagesWithMemory(session),
  ).toHaveLength(20);
});

test.each(["success", "failure", "edit"])(
  "summary %s only advances coverage after a valid result",
  async (outcome) => {
    const session = useChatStore.getState().currentSession();
    session.messages = Array.from({ length: 60 }, (_, index) =>
      createMessage({
        role: index % 2 ? "assistant" : "user",
        content: "品牌要求".repeat(400),
      }),
    );
    const before = session.messages.slice();
    jest.mocked(getClientApi).mockReturnValue({
      llm: {
        chat: async (options: ChatOptions) => {
          if (outcome === "failure") {
            options.onError?.(new Error("failed"));
            return;
          }
          if (outcome === "edit") session.messages[0].content = "用户修正";
          options.onFinish("品牌约束摘要", { status: 200 } as Response);
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
    useChatStore.getState().summarizeSession(false, session);
    if (outcome === "success") {
      expect(session.lastSummarizeIndex).toBeGreaterThan(0);
      expect(session.lastSummarizeIndex).toBeLessThan(40);
      expect(session.memoryPrompt).toBe("品牌约束摘要");
      expect(session.messages).toEqual(before);
    } else {
      expect(session.lastSummarizeIndex).toBe(0);
      expect(session.memoryPrompt).toBe("");
      expect(
        await useChatStore.getState().getMessagesWithMemory(session),
      ).toHaveLength(60);
    }
  },
);

test("missing legacy document text fails before sending rather than inventing document contents", async () => {
  const request = captureRequest();
  const session = useChatStore.getState().currentSession();
  session.messages = [
    createMessage({
      role: "user",
      content: "分析",
      attachments: [
        {
          id: "old",
          name: "old.pdf",
          kind: "document",
          mimeType: "application/pdf",
          size: 1,
        },
      ],
    }),
  ];
  await expect(useChatStore.getState().onUserInput("继续")).rejects.toThrow(
    "重新上传",
  );
  expect(request()).toBeUndefined();
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
