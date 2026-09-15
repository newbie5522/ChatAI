export const MEDIA_ERROR_CODES = [
  "MEDIA_EMPTY_RESPONSE",
  "MEDIA_INVALID_RESPONSE",
  "PROVIDER_ERROR",
  "PROVIDER_RATE_LIMIT",
  "REQUEST_TIMEOUT",
  "REQUEST_ABORTED",
  "ARTIFACT_UPLOAD_FAILED",
  "AUTH_OR_PERMISSION_ERROR",
  "QUOTA_EXCEEDED",
] as const;

export type MediaErrorCode = (typeof MEDIA_ERROR_CODES)[number];

export interface MediaErrorPayload {
  error: true;
  code: MediaErrorCode;
  message: string;
  retryable: boolean;
  requestId: string;
  provider: string;
  model: string;
  upstreamStatus?: number;
  safeDetails?: string;
}

const CODE_SET = new Set<string>(MEDIA_ERROR_CODES);

export function sanitizeMediaErrorText(value: unknown) {
  return String(value ?? "")
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "[image]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|AIza)[-_A-Za-z0-9]{16,}\b/g, "[redacted]")
    .replace(
      /(authorization|api[_-]?key|x-api-key)(["'\s:=]+)([^"',\s}]+)/gi,
      "$1$2[redacted]",
    )
    .replace(/(?:[A-Za-z]:\\|\/(?:home|opt|var|usr)\/)[^\s"']+/gi, "[path]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export function isMediaErrorPayload(
  value: unknown,
): value is MediaErrorPayload {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    item.error === true &&
    typeof item.code === "string" &&
    CODE_SET.has(item.code) &&
    typeof item.message === "string" &&
    typeof item.retryable === "boolean" &&
    typeof item.requestId === "string" &&
    typeof item.provider === "string" &&
    typeof item.model === "string"
  );
}

export class MediaRequestError extends Error {
  readonly code: MediaErrorCode;
  readonly retryable: boolean;
  readonly requestId: string;
  readonly provider: string;
  readonly model: string;
  readonly upstreamStatus?: number;

  constructor(payload: MediaErrorPayload) {
    super(
      sanitizeMediaErrorText(payload.message) || "媒体生成失败，请稍后重试。",
    );
    this.name = "MediaRequestError";
    this.code = payload.code;
    this.retryable = payload.retryable;
    this.requestId = payload.requestId;
    this.provider = payload.provider;
    this.model = payload.model;
    this.upstreamStatus = payload.upstreamStatus;
  }
}

export function mediaAbortError(
  timedOut: boolean,
  provider: string,
  model: string,
) {
  return new MediaRequestError({
    error: true,
    code: timedOut ? "REQUEST_TIMEOUT" : "REQUEST_ABORTED",
    message: timedOut ? "图片生成等待超时，请重新生成。" : "图片生成已取消。",
    retryable: timedOut,
    requestId: "",
    provider,
    model,
  });
}
