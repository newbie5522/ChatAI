/**
 * 分包加载失败（ChunkLoadError）的一次性安全恢复。
 *
 * 背景：
 * 部署切换后，浏览器里仍在运行的旧页面会去请求旧版本的分包文件（JS/CSS），
 * 而新容器中已经不存在这些带哈希的文件，于是抛出 ChunkLoadError，
 * 典型报错为 `Loading CSS chunk 6814 failed`。
 * 这类错误刷新一次通常即可恢复，但如果没有保护，刷新本身就会变成死循环。
 *
 * 保护策略（三条同时生效，任一不满足都不自动刷新）：
 * 1. 冷却窗口：两次自动刷新之间至少间隔 RECOVERY_COOLDOWN_MS；
 *    刷新后问题依旧时，错误页会再次触发判定，此时仍在冷却窗口内 → 不刷新，展示错误页。
 * 2. 会话上限：同一标签页会话内自动刷新总次数不超过 MAX_AUTO_RECOVERIES_PER_SESSION。
 * 3. 前置条件：必须是"分包加载失败"，且浏览器处于在线状态才自动刷新。
 *
 * 判定与副作用分离：decideChunkRecovery 是纯函数（可测试），
 * attemptChunkRecovery 才会真正写存储并触发刷新。
 */

export const CHUNK_RECOVERY_STORAGE_KEY = "newbiechat:chunk-recovery";

/** 两次自动刷新之间的最小间隔，防止刷新循环 */
export const RECOVERY_COOLDOWN_MS = 60 * 1000;

/** 单个标签页会话内允许自动刷新的总次数上限 */
export const MAX_AUTO_RECOVERIES_PER_SESSION = 2;

export type ChunkRecoveryRecord = {
  /** 上一次自动刷新的时间戳（毫秒） */
  lastAttemptAt: number;
  /** 本会话内已自动刷新的总次数 */
  totalAttempts: number;
};

export type ChunkRecoverySkipReason =
  | "not-chunk-error"
  | "offline"
  | "cooldown-active"
  | "session-limit";

export type ChunkRecoveryDecision =
  | { reload: true; reason: "first-attempt" | "cooldown-elapsed" }
  | { reload: false; reason: ChunkRecoverySkipReason };

/** 取会话级存储；不可用（隐私模式、被禁用等）时返回 null */
export function getSessionStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    const storage = window.sessionStorage;
    const probe = "__newbiechat_probe__";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

function isChunkLoadErrorName(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; code?: unknown };
  if (candidate.name === "ChunkLoadError") return true;
  return (
    candidate.code === "CHUNK_LOAD_FAILED" ||
    candidate.code === "CSS_CHUNK_LOAD_FAILED"
  );
}

/**
 * 是否属于"分包加载失败"。
 * 覆盖 webpack 的 ChunkLoadError、CSS chunk 失败，以及浏览器原生的动态模块加载失败。
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  if (isChunkLoadErrorName(error)) return true;

  const message =
    typeof error === "string"
      ? error
      : typeof (error as { message?: unknown })?.message === "string"
      ? String((error as { message: string }).message)
      : "";

  if (!message) return false;

  return (
    /Loading (CSS )?chunk [\w-]+ failed/i.test(message) ||
    /Loading chunk [\w-]+ failed/i.test(message) ||
    /Loading CSS chunk [\w-]+ failed/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /Unable to preload CSS/i.test(message)
  );
}

export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** 把"为什么不自动刷新"翻译成给用户看的中文说明 */
export function describeRecoveryBlockedReason(
  reason: ChunkRecoverySkipReason,
): string {
  switch (reason) {
    case "cooldown-active":
      return "刚刚已经自动重新加载过一次。为避免反复刷新，短时间内不再自动重试，请点下面的按钮手动重试。";
    case "session-limit":
      return "本次会话中的自动重试次数已经用完，请点下面的按钮手动重试。";
    case "offline":
      return "检测到当前网络已断开，因此没有自动重新加载。网络恢复后请点下面的按钮重试。";
    default:
      return "";
  }
}

/** 读取上次的恢复记录；内容损坏时视为没有记录，避免因为脏数据卡死恢复能力 */
export function readRecoveryRecord(
  storage: Storage | null = getSessionStorage(),
): ChunkRecoveryRecord | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(CHUNK_RECOVERY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ChunkRecoveryRecord>;
    if (typeof parsed?.lastAttemptAt !== "number") return null;
    if (!Number.isFinite(parsed.lastAttemptAt)) return null;
    return {
      lastAttemptAt: parsed.lastAttemptAt,
      totalAttempts:
        typeof parsed.totalAttempts === "number" && parsed.totalAttempts >= 0
          ? parsed.totalAttempts
          : 1,
    };
  } catch {
    return null;
  }
}

export function writeRecoveryRecord(
  record: ChunkRecoveryRecord,
  storage: Storage | null = getSessionStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(CHUNK_RECOVERY_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // 写不进去时静默跳过：宁可少刷新一次，也不能因为没有记录而反复刷新
  }
}

/** 清空恢复记录。仅在用户手动点「重新加载」后调用，表示这是一次有意为之的新尝试。 */
export function clearRecoveryRecord(
  storage: Storage | null = getSessionStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(CHUNK_RECOVERY_STORAGE_KEY);
  } catch {
    // 忽略
  }
}

/**
 * 判定这一次分包加载失败是否允许自动刷新。纯函数，便于单测。
 */
export function decideChunkRecovery(options: {
  error: unknown;
  now?: number;
  offline?: boolean;
  record?: ChunkRecoveryRecord | null;
}): ChunkRecoveryDecision {
  const { error, now = Date.now(), offline = isOffline(), record } = options;

  if (!isChunkLoadError(error)) {
    return { reload: false, reason: "not-chunk-error" };
  }

  if (offline) {
    return { reload: false, reason: "offline" };
  }

  if (!record) {
    return { reload: true, reason: "first-attempt" };
  }

  if (record.totalAttempts >= MAX_AUTO_RECOVERIES_PER_SESSION) {
    return { reload: false, reason: "session-limit" };
  }

  if (now - record.lastAttemptAt < RECOVERY_COOLDOWN_MS) {
    return { reload: false, reason: "cooldown-active" };
  }

  return { reload: true, reason: "cooldown-elapsed" };
}

/**
 * 判定并在允许时执行一次安全刷新。
 * 返回是否真的触发了刷新，供调用方决定错误页文案。
 */
export function attemptChunkRecovery(options: {
  error: unknown;
  now?: number;
  storage?: Storage | null;
  reload?: () => void;
}): ChunkRecoveryDecision {
  const now = options.now ?? Date.now();
  const storage =
    options.storage === undefined ? getSessionStorage() : options.storage;
  const record = readRecoveryRecord(storage);

  const decision = decideChunkRecovery({
    error: options.error,
    now,
    record,
  });

  if (!decision.reload) return decision;

  writeRecoveryRecord(
    {
      lastAttemptAt: now,
      totalAttempts: (record?.totalAttempts ?? 0) + 1,
    },
    storage,
  );

  const doReload = options.reload ?? (() => window.location.reload());
  try {
    doReload();
  } catch {
    // 刷新调用失败时不抛出，交由错误页兜底展示
  }

  return decision;
}
