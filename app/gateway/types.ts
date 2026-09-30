/**
 * V2 统一 Model Gateway - 核心类型定义
 *
 * 目标（对应 Issue #20 / ADR-006）：
 * - 消除"模型名称 = 能力"的猜测，能力由注册表精确查询
 * - UI/业务层只消费标准事件，不感知具体 Provider 协议差异
 * - 官方 Adapter 与中转 Adapter 共享同一接口，但各自负责协议转换
 *
 * 本阶段范围（契约冻结，非破坏性引入）：
 * - 定义标准请求/事件/结果/错误类型
 * - 定义 CapabilityRegistry 查询接口
 * - 不改动、不替换现有 8 个平台适配器（app/client/platforms/*）
 * - 现有适配器的接入见 app/gateway/adapters/legacy-adapter.ts（后续任务）
 */

// ---------- 能力枚举（与 ADR-006 保持一致） ----------

export type Capability =
  | "TEXT"
  | "VISION"
  | "IMAGE_GENERATION"
  | "IMAGE_EDIT"
  | "IMAGE_REFERENCE"
  | "MULTI_IMAGE_REFERENCE"
  | "IMAGE_URL_INPUT"
  | "IMAGE_BASE64_INPUT"
  | "IMAGE_FILE_INPUT"
  | "TRANSPARENT_BACKGROUND"
  | "MASK_EDIT"
  | "OUTPUT_FORMAT"
  | "VIDEO_GENERATION"
  | "FUNCTION_CALLING"
  | "STREAMING"
  | "EMBEDDINGS";

export type CapabilityStatus = "supported" | "unsupported" | "unknown";
export type CapabilitySource = "official-static" | "probe" | "admin-declared";

/**
 * 能力查询的最小上下文。
 * 不能只按 providerId+modelId 存储，必须精确到 routeId/endpoint/schemaId，
 * 否则无法表达"同一模型在不同中转线路上能力不同"这一核心场景。
 */
export interface CapabilityKey {
  providerId: string;
  modelId: string;
  routeId: string;
  endpoint: string;
  schemaId: string;
}

export interface CapabilityEvidence {
  source: CapabilitySource;
  status: CapabilityStatus;
  observedAt: string;
  expiresAt?: string;
  evidenceRef?: string;
  reason?: string;
}

export interface ProviderCapabilityEntry extends CapabilityKey {
  adapterKind: "official-native" | "relay-compatible";
  capabilities: Partial<Record<Capability, CapabilityEvidence>>;
  version: number;
  updatedAt: string;
}

export interface CapabilityDecision {
  status: CapabilityStatus;
  source?: CapabilitySource;
  reason?: string;
  observedAt?: string;
}

// ---------- 统一请求/事件协议 ----------

export type StandardRole = "system" | "user" | "assistant";

export interface StandardMessage {
  role: StandardRole;
  content: string | StandardContentPart[];
}

export type StandardContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; imageUrl: { url: string } };

export interface StandardModelRequest {
  requestId: string; // 幂等标识，对应 V2 数据模型 Run.requestId
  providerId: string;
  modelId: string;
  routeId: string;
  messages: StandardMessage[];
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

/**
 * 统一运行时事件。UI 只消费这些事件，不判断 Provider 名称。
 */
export type ModelEvent =
  | { type: "delta"; requestId: string; text: string }
  | { type: "tool_call"; requestId: string; toolName: string; args: string }
  | { type: "media"; requestId: string; media: MediaResult }
  | { type: "done"; requestId: string; finishReason: string }
  | { type: "error"; requestId: string; error: ModelError }
  | { type: "aborted"; requestId: string };

export interface MediaResult {
  kind: "image" | "video" | "audio";
  url?: string;
  base64?: string;
  mimeType: string;
}

export type ModelErrorCode =
  | "NETWORK_ERROR"
  | "RATE_LIMIT"
  | "INVALID_REQUEST"
  | "QUOTA_EXCEEDED"
  | "CAPABILITY_UNSUPPORTED"
  | "CAPABILITY_UNKNOWN"
  | "UPSTREAM_ERROR"
  | "ABORTED";

export interface ModelError {
  code: ModelErrorCode;
  message: string;
  retryable: boolean;
}

// ---------- Adapter 接口（双轨共享） ----------

export interface CapabilityRequest extends CapabilityKey {
  capability: Capability;
}

export interface ModelAdapter {
  readonly adapterId: string;
  readonly kind: "official-native" | "relay-compatible";

  /** 查询本 Adapter 对某能力的支持情况（结合注册表结果） */
  supports(request: CapabilityRequest): CapabilityDecision;

  /** 执行标准请求，通过 onEvent 回调发出标准事件 */
  execute(
    request: StandardModelRequest,
    onEvent: (event: ModelEvent) => void,
  ): Promise<void>;
}
