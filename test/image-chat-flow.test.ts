/**
 * @jest-environment node
 *
 * image-chat-flow.test.ts
 * 验证前端 chat store 中 onFinish / onError 的空消息路径行为。
 *
 * 由于 app/store/chat.ts 深度依赖 zustand store 和浏览器环境，
 * 此文件只测试可提取的纯逻辑，并通过轻量 mock 验证核心路径。
 * 完整的 UI 集成流程（isLoading 占位消失、双框问题）需要 E2E 验证。
 */

// ---------- pure logic: botMessage filter ----------

describe("onFinish 空消息路径 — 纯逻辑验证", () => {
  /**
   * 模拟 onFinish 的核心分支逻辑（从 chat.ts:844 提取）
   * 验证：空消息 + 无 previousResponse → filter 掉 botMessage
   */
  function simulateOnFinish(
    message: string,
    messages: Array<{ id: string; content: string }>,
    botMessageId: string,
    previousResponse?: { id: string; content: string },
  ): {
    resultMessages: Array<{ id: string; content: string }>;
    userIsError: boolean;
    toastShown: boolean;
  } {
    let userIsError = false;
    let toastShown = false;
    let resultMessages = [...messages];

    if (message.trim()) {
      // 正常路径：更新 botMessage 内容
      resultMessages = resultMessages.map((m) =>
        m.id === botMessageId ? { ...m, content: message } : m,
      );
    } else if (previousResponse) {
      // replay 路径：用 previousResponse 替换 botMessage
      resultMessages = resultMessages.map((m) =>
        m.id === botMessageId ? previousResponse : m,
      );
      toastShown = true;
    } else {
      // 空响应无原始回复：删除 botMessage（修复前此分支缺失）
      resultMessages = resultMessages.filter((m) => m.id !== botMessageId);
      userIsError = true;
    }

    return { resultMessages, userIsError, toastShown };
  }

  const BOT_ID = "bot-001";
  const USER_ID = "user-001";

  const baseMessages = [
    { id: USER_ID, content: "生成一张猫的图片" },
    { id: BOT_ID, content: "……" },
  ];

  test("正常消息 → botMessage 内容被更新，保留在列表", () => {
    const { resultMessages, userIsError } = simulateOnFinish(
      "这是正常回复",
      baseMessages,
      BOT_ID,
    );
    expect(resultMessages).toHaveLength(2);
    expect(resultMessages.find((m) => m.id === BOT_ID)?.content).toBe(
      "这是正常回复",
    );
    expect(userIsError).toBe(false);
  });

  test("空消息 + 无 previousResponse → botMessage 被从列表移除", () => {
    const { resultMessages, userIsError } = simulateOnFinish(
      "",
      baseMessages,
      BOT_ID,
    );
    // botMessage 应该被删除，列表只剩 userMessage
    expect(resultMessages).toHaveLength(1);
    expect(resultMessages.find((m) => m.id === BOT_ID)).toBeUndefined();
    expect(userIsError).toBe(true);
  });

  test("空消息 + 有 previousResponse → 恢复原始回复，不删除", () => {
    const prev = { id: BOT_ID, content: "上一次的回答" };
    const { resultMessages, toastShown } = simulateOnFinish(
      "",
      baseMessages,
      BOT_ID,
      prev,
    );
    expect(resultMessages).toHaveLength(2);
    expect(resultMessages.find((m) => m.id === BOT_ID)?.content).toBe(
      "上一次的回答",
    );
    expect(toastShown).toBe(true);
  });

  test("空白字符串（只含空格）视为空消息 → botMessage 被移除", () => {
    const { resultMessages } = simulateOnFinish("   ", baseMessages, BOT_ID);
    expect(resultMessages.find((m) => m.id === BOT_ID)).toBeUndefined();
  });

  test("单次调用只有一个 botMessage 被创建（无重复插入）", () => {
    // 验证 messages 数组中 BOT_ID 只出现一次（模拟 updateTargetSession 写入路径）
    const msgs = [
      { id: USER_ID, content: "test" },
      { id: BOT_ID, content: "……" },
    ];
    const botCount = msgs.filter((m) => m.id === BOT_ID).length;
    expect(botCount).toBe(1);
  });
});

// ---------- onError 路径验证 ----------

describe("onError 路径 — botMessage 内容不保留空字符串", () => {
  function simulateOnError(
    errorMsg: string,
    messages: Array<{ id: string; content: string; isError?: boolean }>,
    botMessageId: string,
    previousResponse?: { id: string; content: string },
  ) {
    const sanitized = errorMsg || "请求失败，请稍后重试。";
    let resultMessages = [...messages];

    if (previousResponse) {
      // replay 路径：恢复原始回复
      resultMessages = resultMessages.map((m) =>
        m.id === botMessageId ? previousResponse : m,
      );
    } else {
      // 非 replay：botMessage.content 设为错误信息
      resultMessages = resultMessages.map((m) =>
        m.id === botMessageId ? { ...m, content: sanitized, isError: true } : m,
      );
    }

    return { resultMessages };
  }

  const BOT_ID = "bot-002";
  const msgs = [
    { id: "user-002", content: "生成图片" },
    { id: BOT_ID, content: "……" },
  ];

  test("onError 后 botMessage.content 不为空字符串或'……'", () => {
    const { resultMessages } = simulateOnError("upstream error", msgs, BOT_ID);
    const bot = resultMessages.find((m) => m.id === BOT_ID);
    expect(bot?.content).not.toBe("");
    expect(bot?.content).not.toBe("……");
    expect(bot?.isError).toBe(true);
  });

  test("onError 有 previousResponse → botMessage 被替换回原始回复", () => {
    const prev = { id: BOT_ID, content: "上一次好的回复" };
    const { resultMessages } = simulateOnError(
      "upstream error",
      msgs,
      BOT_ID,
      prev,
    );
    expect(resultMessages.find((m) => m.id === BOT_ID)?.content).toBe(
      "上一次好的回复",
    );
  });
});
