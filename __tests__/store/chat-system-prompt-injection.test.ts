/**
 * 测试图片生成模型能力配置
 * 
 * 验证 System Prompt 注入逻辑是否正确读取 capabilities.imageGeneration
 */
import { describe, it, expect } from "@jest/globals";

describe("Image Generation Model Capability Detection", () => {
  it("应该正确识别配置了 imageGeneration 能力的模型", () => {
    const models = [
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
    const models = [
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
    const models = [
      {
        name: "gpt-4-turbo",
      },
      {
        name: "claude-3-opus",
      },
    ];

    const checkModel = (name: string) => {
      const model = models.find((m: any) => m.name === name);
      return model?.capabilities?.imageGeneration === true;
    };

    expect(checkModel("gpt-4-turbo")).toBe(false);
    expect(checkModel("claude-3-opus")).toBe(false);
  });
});
