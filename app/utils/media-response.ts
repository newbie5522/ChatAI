import type { MultimodalContent } from "../client/api";
import {
  isMediaErrorPayload,
  MediaErrorPayload,
  MediaRequestError,
  sanitizeMediaErrorText,
} from "./media-error";

interface MediaDataItem {
  url?: string;
  b64_json?: string;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function upstreamErrorText(value: unknown) {
  const body = objectValue(value);
  const error = objectValue(body?.error);
  const candidates = [
    error?.message,
    body?.message,
    body?.detail,
    body?.details,
  ];
  const message = candidates.find(
    (item) => typeof item === "string" && item.trim().length > 0,
  );
  return message ? sanitizeMediaErrorText(message) : undefined;
}

export function classifyMediaJson(value: unknown):
  | { valid: true }
  | {
      valid: false;
      code:
        | "MEDIA_EMPTY_RESPONSE"
        | "MEDIA_INVALID_RESPONSE"
        | "PROVIDER_ERROR";
      safeDetails?: string;
    } {
  const body = objectValue(value);
  if (body?.error) {
    return {
      valid: false,
      code: "PROVIDER_ERROR",
      safeDetails: upstreamErrorText(value),
    };
  }
  if (extractValidMediaData(value).length > 0) return { valid: true };
  if (Array.isArray(body?.data) && body?.data.length === 0) {
    return { valid: false, code: "MEDIA_EMPTY_RESPONSE" };
  }
  return { valid: false, code: "MEDIA_INVALID_RESPONSE" };
}

export function extractValidMediaData(value: unknown): MediaDataItem[] {
  const body = objectValue(value);
  if (!body || !Array.isArray(body.data)) return [];

  return body.data.flatMap((entry) => {
    const item = objectValue(entry);
    const url = typeof item?.url === "string" ? item.url.trim() : "";
    const b64 = typeof item?.b64_json === "string" ? item.b64_json.trim() : "";
    return url || b64
      ? [{ url: url || undefined, b64_json: b64 || undefined }]
      : [];
  });
}

export async function readMediaResponse(res: Response): Promise<unknown> {
  let value: unknown;
  try {
    value = await res.json();
  } catch {
    throw new MediaRequestError({
      error: true,
      code: "MEDIA_INVALID_RESPONSE",
      message: "图片服务返回了无法识别的响应，请稍后重试。",
      retryable: res.status >= 500,
      requestId: res.headers.get("x-request-id") ?? "",
      provider: "",
      model: "",
      upstreamStatus: res.status,
    });
  }

  if (isMediaErrorPayload(value)) throw new MediaRequestError(value);
  const classified = classifyMediaJson(value);
  if (res.ok && !classified.valid) {
    throw new MediaRequestError({
      error: true,
      code: classified.code,
      message:
        classified.code === "MEDIA_EMPTY_RESPONSE"
          ? "图片服务没有返回有效图片，请重新生成。"
          : classified.code === "PROVIDER_ERROR"
          ? "图片服务返回错误，请稍后重试。"
          : "图片服务返回了不兼容的响应，请联系管理员检查线路。",
      retryable: true,
      requestId: res.headers.get("x-request-id") ?? "",
      provider: "",
      model: "",
      upstreamStatus: res.status,
    });
  }
  if (!res.ok) {
    throw new MediaRequestError({
      error: true,
      code: res.status === 429 ? "PROVIDER_RATE_LIMIT" : "PROVIDER_ERROR",
      message: "图片服务请求失败，请稍后重试。",
      retryable: res.status === 429 || res.status >= 500,
      requestId: res.headers.get("x-request-id") ?? "",
      provider: "",
      model: "",
      upstreamStatus: res.status,
    });
  }
  return value;
}

export async function mediaResponseToMessage(
  value: unknown,
  uploadBase64: (base64: string) => Promise<string>,
  context: Pick<MediaErrorPayload, "requestId" | "provider" | "model"> = {
    requestId: "",
    provider: "",
    model: "",
  },
): Promise<MultimodalContent[]> {
  const data = extractValidMediaData(value);
  if (data.length === 0) {
    throw new MediaRequestError({
      error: true,
      code: "MEDIA_EMPTY_RESPONSE",
      message: "图片服务没有返回有效图片，请重新生成。",
      retryable: true,
      ...context,
    });
  }

  const messages: MultimodalContent[] = [];
  for (const item of data) {
    let url = item.url;
    if (!url && item.b64_json) {
      try {
        url = await uploadBase64(item.b64_json);
      } catch {
        throw new MediaRequestError({
          error: true,
          code: "ARTIFACT_UPLOAD_FAILED",
          message: "图片已生成，但保存失败，请重新生成。",
          retryable: true,
          ...context,
        });
      }
    }
    if (!url?.trim()) {
      throw new MediaRequestError({
        error: true,
        code: "ARTIFACT_UPLOAD_FAILED",
        message: "图片已生成，但保存失败，请重新生成。",
        retryable: true,
        ...context,
      });
    }
    messages.push({ type: "image_url", image_url: { url } });
  }
  return messages;
}
