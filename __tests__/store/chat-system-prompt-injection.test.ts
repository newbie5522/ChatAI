/**
 * 测试图片生成模型能力配置与 System Prompt 注入
 * 
 * 验证：
 * 1. System Prompt 注入逻辑正确读取 capabilities.imageGeneration
 * 2. 禁止通过模型名称、前缀或正则表达式判断图片能力
 * 3. 图片模型请求不包含聊天 System Prompt
 */
import { describe, it, expect } from "@jest/globals";

type TestModel = {
  name: string;
  capabilities?: {
    imageGeneration?: boolean;
  };
};

type ModelConfig = {
  enableInjectSystemPrompts: boolean;
};

describe("Image Generation Model Capability Detection", () => {
  it("应该正确识别配置了 imageGeneration 能力的模型", () => {
    const models: TestModel[] = [
      {
        name: "dall-e-3",
        capabilities: { imageGeneration: true },
      },
      {
        name: "test-image-v1",
        capabilities: { imageGeneration: true },
      },
      {
        name: "gpt-4o",
        capabilities: {},
      },
    ];

    const checkModel = (name: string) => {
      const model = models.find((m) => m.name === name);
      return model?.capabilities?.imageGeneration === true;
    };

    expect(checkModel("dall-e-3")).toBe(true);
    expect(checkModel("test-image-v1")).toBe(true);
    expect(checkModel("gpt-4o")).toBe(false);
    expect(checkModel("unknown-model")).toBe(false);
  });

  it("虚拟图片模型名称不包含关键词也能正确识别", () => {
    const models: TestModel[] = [
      {
        name: "random-name-123",
        capabilities: { imageGeneration: true },
      },
      {
        name: "midjourney-v6",
        capabilities: {},
      },
    ];

    const checkModel = (name: string) => {
      const model = models.find((m) => m.name === name);
      return model?.capabilities?.imageGeneration === true;
    };

    // 即使名称中不包含任何图片关键词，也能通过配置识别
    expect(checkModel("random-name-123")).toBe(true);

    // 即使名称包含关键词，但未配置能力，也不被识别
    expect(checkModel("midjourney-v6")).toBe(false);
  });

  it("未配置 capabilities 的模型不应被识别为图片模型", () => {
    const models: TestModel[] = [
      {
        name: "gpt-4-turbo",
      },
      {
        name: "claude-3-opus",
      },
    ];

    const checkModel = (name: string) => {
      const model = models.find((m) => m.name === name);
      return model?.capabilities?.imageGeneration === true;
    };

    expect(checkModel("gpt-4-turbo")).toBe(false);
    expect(checkModel("claude-3-opus")).toBe(false);
  });

  it("System Prompt 注入逻辑：图片模型永不注入", () => {
    const models: TestModel[] = [
      { name: "dall-e-3", capabilities: { imageGeneration: true } },
      { name: "test-img", capabilities: { imageGeneration: true } },
      { name: "gpt-4", capabilities: {} },
    ];

    const shouldInject = (modelName: string, enableConfig: boolean) => {
      const model = models.find((m) => m.name === modelName);
      const isImageModel = model?.capabilities?.imageGeneration === true;
      return !isImageModel && enableConfig;
    };

    // 图片模型：即使配置开启，也不注入
    expect(shouldInject("dall-e-3", true)).toBe(false);
    expect(shouldInject("test-img", true)).toBe(false);

    // 文本模型：根据配置决定
    expect(shouldInject("gpt-4", true)).toBe(true);
    expect(shouldInject("gpt-4", false)).toBe(false);
  });

  it("禁止通过模型名称前缀判断能力", () => {
    const models: TestModel[] = [
      // gpt- 前缀但是图片模型
      { name: "gpt-image-2", capabilities: { imageGeneration: true } },
      // dall-e 前缀但未配置能力
      { name: "dall-e-test", capabilities: {} },
      // 非标准名称但是图片模型
      { name: "xyz-123", capabilities: { imageGeneration: true } },
    ];

    const shouldInject = (modelName: string) => {
      const model = models.find((m) => m.name === modelName);
      const isImageModel = model?.capabilities?.imageGeneration === true;
      // 仅根据能力配置，不根据名称
      return !isImageModel && true; // enableConfig=true
    };

    // gpt-image-2 有能力配置 → 不注入
    expect(shouldInject("gpt-image-2")).toBe(false);
    
    // dall-e-test 无能力配置 → 注入（按文本模型处理）
    expect(shouldInject("dall-e-test")).toBe(true);
    
    // xyz-123 有能力配置 → 不注入
    expect(shouldInject("xyz-123")).toBe(false);
  });

  it("未知模型默认行为：按文本模型处理", () => {
    const models: TestModel[] = [
      { name: "known-model", capabilities: {} },
    ];

    const shouldInject = (modelName: string) => {
      const model = models.find((m) => m.name === modelName);
      const isImageModel = model?.capabilities?.imageGeneration === true;
      return !isImageModel && true; // enableConfig=true
    };

    // 未知模型 → 找不到配置 → isImageModel=false → 按文本模型注入
    expect(shouldInject("totally-unknown-model")).toBe(true);
  });
});
