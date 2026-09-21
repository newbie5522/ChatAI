/**
 * 错误信息的展示脱敏（#14）。
 *
 * 背景：
 * 错误页会把「技术信息」折叠展示给员工，方便员工复制给管理员反馈问题。
 * 但原始错误的 message 与完整页面地址里可能夹带敏感内容：
 *   - 上游返回体里回显的 Bearer 令牌 / API Key；
 *   - 图生图请求里内联的 base64 图片（体积巨大且属于用户数据）；
 *   - 服务器上的绝对路径（暴露目录结构）；
 *   - 地址栏里的查询参数（可能带签名、邀请码、回调参数等）。
 *
 * 因此这里的策略是"能不给就不给"：
 *   1. 默认只输出**错误类型名 + 错误码 + 请求标识**，不输出 message 原文；
 *   2. 页面地址只保留 origin + pathname，query 与 hash 一律剥掉；
 *   3. 任何要落到页面上的字符串，都先过一遍 sanitizeErrorText 做兜底过滤。
 *
 * 只做展示层过滤，不改变错误对象的本身，也不参与任何业务判定。
 */

/** 被过滤掉的内容用这个占位，便于人一眼看出"这里原本有东西被隐藏了" */
export const REDACTED = "[已隐藏]";

/** 内联 base64 图片：data:image/png;base64,AAAA... */
const BASE64_IMAGE_RE = /data:image\/[a-z0-9.+-]*;base64,[A-Za-z0-9+/=\s]+/gi;

/** Authorization: Bearer xxx （含 token 里的 - _ . ~ + / =） */
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{4,}/gi;

/** 常见服务商的密钥前缀：sk-、sk-or-v1-、gsk_、hf_、xai-、rk-、pk-、AIza */
const PREFIXED_KEY_RE =
  /\b(?:sk|rk|pk|gsk|hf|xai|api)[-_][A-Za-z0-9_-]{8,}|\bAIza[A-Za-z0-9_-]{10,}/g;

/** key=value / token: value 形式的凭据赋值 */
const SECRET_ASSIGNMENT_RE =
  /\b(api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|auth[_-]?token|id[_-]?token|client[_-]?secret|authorization|signature|password|passwd|pwd|secret|token)\b(\s*[:=]\s*)(["']?)([^\s"'&,;]{3,})\3/gi;

/** Windows 绝对路径：C:\Users\... */
const WINDOWS_PATH_RE = /\b[A-Za-z]:\\(?:[^\\\s"']+\\?)+/g;

/** POSIX 绝对路径：/home/... /opt/... /app/... 等 */
const POSIX_PATH_RE =
  /(^|[\s"'(=:])(\/(?:home|root|opt|var|usr|etc|srv|tmp|app|Users|workspace|workspaces|builder|data)\/[^\s"')]*)/g;

/** URL 查询参数：?key=value&... （要求形如 key=value，避免误伤普通问号） */
const QUERY_PARAM_RE = /\?[A-Za-z0-9_%[\].-]+=[^\s"'<>)\]]*/g;

/** hash 里的查询参数：#/route?key=value */
const HASH_QUERY_PARAM_RE = /#([^\s"'<>)\]]*?)\?[^\s"'<>)\]]*/g;

/**
 * 对准备展示的字符串做脱敏兜底。
 * 任何要出现在页面上的错误文本都应该先过这里。
 */
export function sanitizeErrorText(input: string): string {
  if (!input) return "";
  return input
    .replace(BASE64_IMAGE_RE, `data:image/base64,${REDACTED}`)
    .replace(BEARER_RE, `Bearer ${REDACTED}`)
    .replace(PREFIXED_KEY_RE, REDACTED)
    .replace(SECRET_ASSIGNMENT_RE, `$1$2$3${REDACTED}$3`)
    .replace(WINDOWS_PATH_RE, REDACTED)
    .replace(POSIX_PATH_RE, `$1${REDACTED}`)
    .replace(HASH_QUERY_PARAM_RE, "$1")
    .replace(QUERY_PARAM_RE, REDACTED);
}

/**
 * 把页面地址收敛为"只保留站点 + 路径"。
 *
 * query 与 hash 一律剥掉：hash 路由下的参数、以及 ?redirect=... 这类回调参数
 * 都可能带敏感信息，而反馈问题时这两个都不是必需的。
 * 解析失败时退化为"取 ? 与 # 之前的部分"，同样不会把参数带出去。
 */
export function toSafeLocationHref(href: string | undefined): string {
  if (!href) return "";
  try {
    const url = new URL(href);
    return `${url.origin}${url.pathname}`;
  } catch {
    return href.split("#")[0].split("?")[0];
  }
}

export type SafeErrorDisplay = {
  /** 安全的错误类型名，例如 ChunkLoadError / TypeError */
  name: string;
  /** 错误码，例如 CSS_CHUNK_LOAD_FAILED；没有时为空串 */
  code: string;
  /** 请求标识（例如 Next.js 的 digest）；没有时为空串 */
  requestId: string;
  /** 只保留 origin + pathname 的页面地址；没有时为空串 */
  location: string;
};

/** 只接受"像标识符"的短字符串，其余一律丢弃，避免把 message 夹带进来 */
const SAFE_TOKEN_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

function readSafeToken(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || !SAFE_TOKEN_RE.test(trimmed)) return "";
  return trimmed;
}

/**
 * 把任意错误对象收敛成"可以安全展示"的结构。
 *
 * 刻意不读取 error.message：那里是最容易夹带令牌、路径、base64 图片的地方，
 * 而折叠区只需要"错误类型 + 错误码"就足够管理员定位问题。
 *
 * 没有可展示内容时返回 null（例如 not-found 场景没有错误对象）。
 */
export function toSafeErrorDisplay(
  error: unknown,
  href?: string,
): SafeErrorDisplay | null {
  if (error === null || error === undefined) return null;
  if (typeof error === "string" && !error.trim()) return null;

  const candidate =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)
      : null;

  let name = readSafeToken(candidate?.name);

  if (!name && candidate?.constructor) {
    name = readSafeToken((candidate.constructor as { name?: unknown })?.name);
  }

  // 字符串形式的错误只当作"有错误发生"，同样不展示原文
  if (!name) name = "Error";

  const code = readSafeToken(candidate?.code);
  const requestId =
    readSafeToken(candidate?.requestId) ||
    readSafeToken(candidate?.requestID) ||
    readSafeToken(candidate?.digest);

  const location = toSafeLocationHref(href);

  return {
    name: sanitizeErrorText(name),
    code: sanitizeErrorText(code),
    requestId: sanitizeErrorText(requestId),
    location: sanitizeErrorText(location),
  };
}
