/**
 * OpenAI 官方 Adapter（示例实现）
 *
 * 说明：本阶段（契约冻结）只实现核心契约，不替换现有 8 个适配器。
 * 真实的流式响应解析、重试、上传等细节见后续任务，当前聚焦在：
 * - 标准请求 → 标准事件的转换
 * - 能力注册表查询逻辑
 * - 官方静态能力声明
 *
 * 真实生产实现时需要从现有 app/client/platforms/openai.ts 迁移业务逻辑。
 */

import type {
  ModelAdapter,
  StandardModelRequest,
  ModelEvent,
  CapabilityRequest,
  CapabilityDecision,
  CapabilityKey,
  Capability,
} from "../types";
import { capabilityRegistry } from "../capability-registry";

export class OpenAIAdapter implements ModelAdapter {
  readonly adapterId = "openai-official";
  readonly kind = "official-native" as const;

  constructor() {
    // 初始化时向注册表声明官方静态能力（基于 OpenAI 文档）
    this.initializeStaticCapabilities();
  }

  private initializeStaticCapabilities() {
    // 示例：gpt-4o 的能力
    const gpt4oKey: CapabilityKey = {
      providerId: "openai",
      modelId: "gpt-4o",
      routeId: "official-direct",
      endpoint: "https://api.openai.com/v1",
      schemaId: "openai-chat-completions-v1",
    };

    capabilityRegistry.declareOfficialStatic(gpt4oKey, [
      "TEXT",
      "VISION",
      "IMAGE_URL_INPUT",
      "IMAGE_BASE64_INPUT",
      "FUNCTION_CALLING",
      "STREAMING",
    ]);

    // 示例：dall-e-3 的能力
    const dalleKey: CapabilityKey = {
      providerId: "openai",
      modelId: "dall-e-3",
      routeId: "official-direct",
      endpoint: "https://api.openai.com/v1",
      schemaId: "openai-images-generations-v1",
    };

    capabilityRegistry.declareOfficialStatic(dalleKey, [
      "IMAGE_GENERATION",
      "OUTPUT_FORMAT",
    ]);
  }

  supports(request: CapabilityRequest): CapabilityDecision {
    return capabilityRegistry.getCapability(
      {
        providerId: request.providerId,
        modelId: request.modelId,
        routeId: request.routeId,
        endpoint: request.endpoint,
        schemaId: request.schemaId,
      },
      request.capability,
    );
  }

  async execute(
    request: StandardModelRequest,
    onEvent: (event: ModelEvent) => void,
  ): Promise<void> {
    // 【占位实现】真实实现需要：
    // 1. 从 config/store 获取 API Key
    // 2. 构造 OpenAI 请求 payload（转换 StandardMessage → OpenAI format）
    // 3. 使用 fetch-event-source 或类似库解析 SSE 流
    // 4. 将 OpenAI delta 事件转换为 StandardModelEvent
    // 5. 处理 OpenAI 特定错误码并映射为 ModelError
    //
    // 当前只做类型验证用的占位逻辑：
    onEvent({
      type: "delta",
      requestId: request.requestId,
      text: "[OpenAI placeholder response]",
    });

    onEvent({
      type: "done",
      requestId: request.requestId,
      finishReason: "stop",
    });
  }
}
