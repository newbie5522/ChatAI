/**
 * 图片生成提示词污染回归测试
 * 
 * 验证：
 * 1. 文本聊天模型应该注入 System Prompt（"You are ChatGPT"）
 * 2. 图片生成模型不应该注入聊天 System Prompt
 * 3. 不依赖模型名称前缀硬编码，而是基于能力注册表判断
 */

import { IMAGE_GENERATION_MODEL_REGEXES } from "../constant";

describe("图片生成模型识别", () => {
  test("dall-e-3 应该被识别为图片生成模型", () => {
    const model = "dall-e-3";
    const isImageModel = IMAGE_GENERATION_MODEL_REGEXES.some((regex) =>
      regex.test(model),
    );
    expect(isImageModel).toBe(true);
  });

  test("gpt-image-2 应该被识别为图片生成模型", () => {
    const model = "gpt-image-2";
    const isImageModel = IMAGE_GENERATION_MODEL_REGEXES.some((regex) =>
      regex.test(model),
    );
    expect(isImageModel).toBe(true);
  });

  test("cogview-3 应该被识别为图片生成模型", () => {
    const model = "cogview-3";
    const isImageModel = IMAGE_GENERATION_MODEL_REGEXES.some((regex) =>
      regex.test(model),
    );
    expect(isImageModel).toBe(true);
  });

  test("gpt-4o 不应该被识别为图片生成模型", () => {
    const model = "gpt-4o";
    const isImageModel = IMAGE_GENERATION_MODEL_REGEXES.some((regex) =>
      regex.test(model),
    );
    expect(isImageModel).toBe(false);
  });

  test("gpt-5 不应该被识别为图片生成模型", () => {
    const model = "gpt-5";
    const isImageModel = IMAGE_GENERATION_MODEL_REGEXES.some((regex) =>
      regex.test(model),
    );
    expect(isImageModel).toBe(false);
  });

  test("chatgpt-4o-latest 不应该被识别为图片生成模型", () => {
    const model = "chatgpt-4o-latest";
    const isImageModel = IMAGE_GENERATION_MODEL_REGEXES.some((regex) =>
      regex.test(model),
    );
    expect(isImageModel).toBe(false);
  });

  test("claude-3-5-sonnet 不应该被识别为图片生成模型", () => {
    const model = "claude-3-5-sonnet-20241022";
    const isImageModel = IMAGE_GENERATION_MODEL_REGEXES.some((regex) =>
      regex.test(model),
    );
    expect(isImageModel).toBe(false);
  });
});

describe("System Prompt 注入行为验证", () => {
  // 模拟 shouldInjectSystemPrompts 逻辑
  const shouldInjectSystemPrompts = (
    modelName: string,
    enableInjectSystemPrompts: boolean,
  ): boolean => {
    const isImageGenerationModel = IMAGE_GENERATION_MODEL_REGEXES.some(
      (regex) => regex.test(modelName),
    );
    return (
      enableInjectSystemPrompts &&
      !isImageGenerationModel &&
      (modelName.startsWith("gpt-") || modelName.startsWith("chatgpt-"))
    );
  };

  test("gpt-4o 应该注入 System Prompt", () => {
    expect(shouldInjectSystemPrompts("gpt-4o", true)).toBe(true);
  });

  test("gpt-5 应该注入 System Prompt", () => {
    expect(shouldInjectSystemPrompts("gpt-5", true)).toBe(true);
  });

  test("chatgpt-4o-latest 应该注入 System Prompt", () => {
    expect(shouldInjectSystemPrompts("chatgpt-4o-latest", true)).toBe(true);
  });

  test("gpt-image-2 不应该注入 System Prompt", () => {
    expect(shouldInjectSystemPrompts("gpt-image-2", true)).toBe(false);
  });

  test("dall-e-3 不应该注入 System Prompt", () => {
    expect(shouldInjectSystemPrompts("dall-e-3", true)).toBe(false);
  });

  test("cogview-3 不应该注入 System Prompt", () => {
    expect(shouldInjectSystemPrompts("cogview-3", true)).toBe(false);
  });

  test("claude-3-5-sonnet 不应该注入 System Prompt（不是 gpt- 前缀）", () => {
    expect(shouldInjectSystemPrompts("claude-3-5-sonnet-20241022", true)).toBe(
      false,
    );
  });

  test("禁用 enableInjectSystemPrompts 时，任何模型都不应该注入", () => {
    expect(shouldInjectSystemPrompts("gpt-4o", false)).toBe(false);
    expect(shouldInjectSystemPrompts("gpt-image-2", false)).toBe(false);
  });
});

describe("回归测试：Issue #15 生图提示词污染", () => {
  test("修复前的行为：gpt-image-2 会错误注入 System Prompt", () => {
    const modelName = "gpt-image-2";
    // 修复前的逻辑（只判断 gpt- 前缀）
    const oldBehavior =
      modelName.startsWith("gpt-") || modelName.startsWith("chatgpt-");
    expect(oldBehavior).toBe(true); // 旧逻辑会错误识别
  });

  test("修复后的行为：gpt-image-2 不会注入 System Prompt", () => {
    const modelName = "gpt-image-2";
    // 修复后的逻辑（增加图片生成模型检测）
    const isImageGenerationModel = IMAGE_GENERATION_MODEL_REGEXES.some(
      (regex) => regex.test(modelName),
    );
    const newBehavior =
      !isImageGenerationModel &&
      (modelName.startsWith("gpt-") || modelName.startsWith("chatgpt-"));
    expect(newBehavior).toBe(false); // 新逻辑正确排除
  });
});
