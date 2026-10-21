/**
 * @jest-environment jsdom
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useChatStore, createEmptySession } from "@/app/store/chat";
import { useAppConfig } from "@/app/store/config";
import type { LLMModel } from "@/app/client/api";

// Mock 客户端 API
jest.mock("@/app/client/api", () => ({
  getClientApi: jest.fn(() => ({
    llm: {
      chat: jest.fn(async () => {}),
    },
  })),
}));

// Mock UI 组件
jest.mock("@/app/components/ui-lib", () => ({
  showToast: jest.fn(),
}));

describe("System Prompt Injection for Image Generation Models", () => {
  beforeEach(() => {
    // 清空所有 Store
    useChatStore.getState().clearSessions();
  });

  it("应为文本聊天模型注入 System Prompt", async () => {
    const { result: chatResult } = renderHook(() => useChatStore());
    const { result: configResult } = renderHook(() => useAppConfig());

    // 配置文本聊天模型
    act(() => {
      configResult.current.mergeModels([
        {
          name: "gpt-4o",
          available: true,
          provider: { id: "openai", providerName: "OpenAI", providerType: "openai" },
          capabilities: {},
        } as LLMModel,
      ]);
    });

    let sessionId: string;
    act(() => {
      sessionId = chatResult.current.newSession();
      chatResult.current.updateCurrentSession((session) => {
        session.mask.modelConfig.model = "gpt-4o";
        session.mask.modelConfig.enableInjectSystemPrompts = true;
      });
    });

    // 发送消息并检查是否注入了 System Prompt
    const chatSpy = jest.spyOn(
      require("@/app/client/api").getClientApi().llm,
      "chat",
    );

    await act(async () => {
      chatResult.current.onUserInput("测试文本聊天");
      await waitFor(() => {
        expect(chatSpy).toHaveBeenCalled();
      });
    });

    const callArgs = chatSpy.mock.calls[0][0];
    const messages = callArgs.messages as any[];
    
    // 验证第一条消息是 system 角色
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("You are ChatGPT");
  });

  it("不应为图片生成模型注入 System Prompt", async () => {
    const { result: chatResult } = renderHook(() => useChatStore());
    const { result: configResult } = renderHook(() => useAppConfig());

    // 配置图片生成模型
    act(() => {
      configResult.current.mergeModels([
        {
          name: "dall-e-3",
          available: true,
          provider: { id: "openai", providerName: "OpenAI", providerType: "openai" },
          capabilities: { imageGeneration: true },
        } as LLMModel,
      ]);
    });

    let sessionId: string;
    act(() => {
      sessionId = chatResult.current.newSession();
      chatResult.current.updateCurrentSession((session) => {
        session.mask.modelConfig.model = "dall-e-3";
        session.mask.modelConfig.enableInjectSystemPrompts = true;
      });
    });

    const chatSpy = jest.spyOn(
      require("@/app/client/api").getClientApi().llm,
      "chat",
    );

    await act(async () => {
      chatResult.current.onUserInput("生成一张图片");
      await waitFor(() => {
        expect(chatSpy).toHaveBeenCalled();
      });
    });

    const callArgs = chatSpy.mock.calls[0][0];
    const messages = callArgs.messages as any[];
    
    // 验证第一条消息不是 system 角色，或者不包含 ChatGPT System Prompt
    if (messages[0].role === "system") {
      expect(messages[0].content).not.toContain("You are ChatGPT");
    }
  });

  it("应为虚拟图片模型（名称无关键词）正确识别能力", async () => {
    const { result: chatResult } = renderHook(() => useChatStore());
    const { result: configResult } = renderHook(() => useAppConfig());

    // 配置一个名称中不包含任何图片关键词的虚拟图片模型
    act(() => {
      configResult.current.mergeModels([
        {
          name: "test-image-model-v1",
          available: true,
          provider: { id: "test", providerName: "Test", providerType: "openai" },
          capabilities: { imageGeneration: true },
        } as LLMModel,
      ]);
    });

    let sessionId: string;
    act(() => {
      sessionId = chatResult.current.newSession();
      chatResult.current.updateCurrentSession((session) => {
        session.mask.modelConfig.model = "test-image-model-v1";
        session.mask.modelConfig.enableInjectSystemPrompts = true;
      });
    });

    const chatSpy = jest.spyOn(
      require("@/app/client/api").getClientApi().llm,
      "chat",
    );

    await act(async () => {
      chatResult.current.onUserInput("生成一张图片");
      await waitFor(() => {
        expect(chatSpy).toHaveBeenCalled();
      });
    });

    const callArgs = chatSpy.mock.calls[0][0];
    const messages = callArgs.messages as any[];
    
    // 验证该模型被正确识别为图片模型，不注入 ChatGPT System Prompt
    if (messages[0].role === "system") {
      expect(messages[0].content).not.toContain("You are ChatGPT");
    }
  });

  it("未配置能力的模型应回退到名称判断", async () => {
    const { result: chatResult } = renderHook(() => useChatStore());
    const { result: configResult } = renderHook(() => useAppConfig());

    // 配置一个未指定 capabilities 的模型
    act(() => {
      configResult.current.mergeModels([
        {
          name: "gpt-4-turbo",
          available: true,
          provider: { id: "openai", providerName: "OpenAI", providerType: "openai" },
        } as LLMModel,
      ]);
    });

    let sessionId: string;
    act(() => {
      sessionId = chatResult.current.newSession();
      chatResult.current.updateCurrentSession((session) => {
        session.mask.modelConfig.model = "gpt-4-turbo";
        session.mask.modelConfig.enableInjectSystemPrompts = true;
      });
    });

    const chatSpy = jest.spyOn(
      require("@/app/client/api").getClientApi().llm,
      "chat",
    );

    await act(async () => {
      chatResult.current.onUserInput("测试未知能力模型");
      await waitFor(() => {
        expect(chatSpy).toHaveBeenCalled();
      });
    });

    const callArgs = chatSpy.mock.calls[0][0];
    const messages = callArgs.messages as any[];
    
    // 验证模型名称以 gpt- 开头，应该注入 System Prompt
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("You are ChatGPT");
  });
});
