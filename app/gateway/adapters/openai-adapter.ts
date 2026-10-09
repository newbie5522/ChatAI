/**
 * V2 Model Gateway - OpenAI 官方 Adapter（契约示例）
 *
 * 本文件的目的：
 * 1. 证明 ModelAdapter 接口可以被正确实现
 * 2. 声明 OpenAI 官方 API 已知支持的能力（official-static）
 * 3. 为后续迁移现有 app/client/platforms/openai.ts 业务逻辑提供占位
 *
 * ⚠️ 当前 execute() 是占位实现，真实业务逻辑在 app/client/platforms/openai.ts
 *    迁移工作属于后续任务，本 PR 不修改现有生产路径。
 */

import { CapabilityRegistry } from "../capability-registry";
import type {
  Capability,
  CapabilityDecision,
  CapabilityRequest,
  ModelAdapter,
  ModelEvent,
  StandardModelRequest,
} from "../types";

// OpenAI 官方 API 已知静态能力（保守声明，仅填已验证的）
const OPENAI_STATIC_CAPABILITIES: Capability[] = [
  "TEXT",
  "STREAMING",
  "FUNCTION_CALLING",
  "VISION", // gpt-4o / gpt-4-vision 等支持
  "IMAGE_URL_INPUT",
  "IMAGE_BASE64_INPUT",
];

export class OpenAIAdapter implements ModelAdapter {
  readonly adapterId = "openai-official";
  readonly kind = "official-native" as const;

  private registry: CapabilityRegistry;

  constructor(registry?: CapabilityRegistry) {
    this.registry = registry ?? new CapabilityRegistry();
    this._registerStaticCapabilities();
  }

  supports(request: CapabilityRequest): CapabilityDecision {
    return this.registry.getCapability(request, request.capability);
  }

  /**
   * 占位执行方法。
   * 真实实现需从 app/client/platforms/openai.ts 迁移业务逻辑。
   */
  async execute(
    request: StandardModelRequest,
    onEvent: (event: ModelEvent) => void,
  ): Promise<void> {
    // 占位：直接发出 done 事件
    onEvent({
      type: "done",
      requestId: request.requestId,
      finishReason: "placeholder",
    });
  }

  private _registerStaticCapabilities(): void {
    // 使用通配 key 注册默认能力（routeId="*" 代表官方直连路由）
    const defaultKey = {
      providerId: "openai",
      modelId: "*",
      routeId: "openai-official",
      endpoint: "https://api.openai.com",
      schemaId: "openai-chat-v1",
    };
    this.registry.declareOfficialStatic(defaultKey, OPENAI_STATIC_CAPABILITIES, {
      evidenceRef: "https://platform.openai.com/docs/models",
    });
  }
}
