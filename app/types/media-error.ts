/**
 * 统一媒体错误协议（Issue #15）
 * 区分错误类型，支持前端可操作的错误处理
 */

export enum MediaErrorCode {
  // 用户错误（4xx）
  INVALID_PROMPT = "INVALID_PROMPT", // 提示词不合规
  INVALID_SIZE = "INVALID_SIZE", // 尺寸不支持
  CONTENT_POLICY_VIOLATION = "CONTENT_POLICY_VIOLATION", // 内容违规
  QUOTA_EXCEEDED = "QUOTA_EXCEEDED", // 用户额度不足
  UPLOAD_ERROR = "UPLOAD_ERROR", // 文件上传失败

  // Provider 错误（5xx）
  PROVIDER_ERROR = "PROVIDER_ERROR", // Provider 返回错误
  UPSTREAM_FORMAT_ERROR = "UPSTREAM_FORMAT_ERROR", // Provider 响应格式错误（HTTP 200 但无有效内容）
  EMPTY_RESPONSE = "EMPTY_RESPONSE", // Provider 返回空响应
  
  // 网络/超时
  TIMEOUT = "TIMEOUT", // 请求超时
  NETWORK_ERROR = "NETWORK_ERROR", // 网络错误
  ABORTED = "ABORTED", // 用户取消
  
  // 系统错误
  INTERNAL_ERROR = "INTERNAL_ERROR", // 内部错误
}

export interface MediaError {
  code: MediaErrorCode;
  message: string; // 用户可读错误信息
  provider?: string; // Provider 名称
  model?: string; // 模型名称
  requestId?: string; // 请求 ID（用于追踪）
  retryable: boolean; // 是否可重试
  details?: {
    upstreamError?: string; // Provider 原始错误
    upstreamCode?: string; // Provider 错误码
    statusCode?: number; // HTTP 状态码
  };
}

/**
 * 判断是否为可重试错误
 */
export function isRetryableError(code: MediaErrorCode): boolean {
  return [
    MediaErrorCode.TIMEOUT,
    MediaErrorCode.NETWORK_ERROR,
    MediaErrorCode.PROVIDER_ERROR,
    MediaErrorCode.INTERNAL_ERROR,
  ].includes(code);
}

/**
 * 判断是否为用户可操作错误
 */
export function isUserActionableError(code: MediaErrorCode): boolean {
  return [
    MediaErrorCode.INVALID_PROMPT,
    MediaErrorCode.INVALID_SIZE,
    MediaErrorCode.CONTENT_POLICY_VIOLATION,
    MediaErrorCode.QUOTA_EXCEEDED,
    MediaErrorCode.UPLOAD_ERROR,
  ].includes(code);
}

/**
 * 标准化 Provider 错误为 MediaError
 */
export function normalizeProviderError(
  error: unknown,
  provider: string,
  model: string,
): MediaError {
  // 用户取消
  if (error instanceof Error && error.name === "AbortError") {
    return {
      code: MediaErrorCode.ABORTED,
      message: "操作已取消",
      provider,
      model,
      retryable: false,
    };
  }

  // 超时
  if (error instanceof Error && error.message.includes("timeout")) {
    return {
      code: MediaErrorCode.TIMEOUT,
      message: "请求超时，请重试",
      provider,
      model,
      retryable: true,
    };
  }

  // Provider 返回的结构化错误
  if (typeof error === "object" && error !== null) {
    const err = error as any;
    
    // 检查是否为空响应
    if (err.message?.includes("empty response") || err.code === "EMPTY_RESPONSE") {
      return {
        code: MediaErrorCode.EMPTY_RESPONSE,
        message: "服务返回空响应，请重试",
        provider,
        model,
        retryable: true,
        details: {
          upstreamError: err.message,
        },
      };
    }

    // 检查是否为格式错误
    if (err.message?.includes("invalid format") || err.message?.includes("unexpected response")) {
      return {
        code: MediaErrorCode.UPSTREAM_FORMAT_ERROR,
        message: "服务返回格式错误，请重试",
        provider,
        model,
        retryable: true,
        details: {
          upstreamError: err.message,
          statusCode: err.statusCode,
        },
      };
    }

    // 内容违规
    if (err.message?.includes("content_policy") || err.code === "content_policy_violation") {
      return {
        code: MediaErrorCode.CONTENT_POLICY_VIOLATION,
        message: "内容不符合安全策略，请修改后重试",
        provider,
        model,
        retryable: false,
      };
    }

    // 额度不足
    if (err.message?.includes("quota") || err.message?.includes("insufficient")) {
      return {
        code: MediaErrorCode.QUOTA_EXCEEDED,
        message: "额度不足，请联系管理员",
        provider,
        model,
        retryable: false,
      };
    }

    // 通用 Provider 错误
    return {
      code: MediaErrorCode.PROVIDER_ERROR,
      message: err.message || "服务暂时不可用，请稍后重试",
      provider,
      model,
      requestId: err.requestId,
      retryable: true,
      details: {
        upstreamError: err.message,
        upstreamCode: err.code,
        statusCode: err.statusCode,
      },
    };
  }

  // 网络错误
  if (error instanceof Error && error.message.includes("fetch")) {
    return {
      code: MediaErrorCode.NETWORK_ERROR,
      message: "网络连接失败，请检查网络后重试",
      provider,
      model,
      retryable: true,
    };
  }

  // 兜底：未知错误
  return {
    code: MediaErrorCode.INTERNAL_ERROR,
    message: error instanceof Error ? error.message : "未知错误，请重试",
    provider,
    model,
    retryable: true,
  };
}
