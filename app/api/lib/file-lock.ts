import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { open, readFile, stat, unlink, writeFile } from "fs/promises";
import path from "path";

/**
 * 跨进程文件锁（基于锁文件原子创建）。
 * - 同步版：withFileLockSync（供 admin-store 等同步 API 使用）
 * - 异步版：withFileLock（供 usage 等异步 API 使用）
 * - 锁文件带创建时间戳，超过 TTL 可被强制夺取（防进程崩溃留下死锁）
 */

const DEFAULT_LOCK_TTL_MS = 10_000;
const LOCK_RETRY_INTERVAL_MS = 100;
const LOCK_MAX_WAIT_MS = 5_000;

function ensureDir(lockPath: string) {
  mkdirSync(path.dirname(lockPath), { recursive: true });
}

function isExpiredSync(lockPath: string): boolean {
  try {
    const raw = readFileSync(lockPath, "utf8").trim();
    const createdAt = Number(raw);
    if (Number.isFinite(createdAt) && createdAt > 0) {
      return Date.now() - createdAt > DEFAULT_LOCK_TTL_MS;
    }
  } catch {
    // fall through to mtime check
  }
  try {
    return Date.now() - statSync(lockPath).mtimeMs > DEFAULT_LOCK_TTL_MS;
  } catch {
    return false;
  }
}

function sleepSync(ms: number) {
  // Node.js 无内置 sleepSync，用 Atomics.wait 阻塞
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function tryAcquireSync(lockPath: string): boolean {
  try {
    ensureDir(lockPath);
    const fd = openSync(lockPath, "wx");
    closeSync(fd);
    writeFileSync(lockPath, String(Date.now()), "utf8");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      if (isExpiredSync(lockPath)) {
        try {
          unlinkSync(lockPath);
        } catch {
          // 被其他进程抢先删除，忽略
        }
        return tryAcquireSync(lockPath);
      }
    }
    return false;
  }
}

function acquireLockSync(lockPath: string) {
  const deadline = Date.now() + LOCK_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    if (tryAcquireSync(lockPath)) return;
    sleepSync(LOCK_RETRY_INTERVAL_MS);
  }
  throw new Error(`[file-lock] acquire lock timed out: ${lockPath}`);
}

function releaseLockSync(lockPath: string) {
  try {
    unlinkSync(lockPath);
  } catch {
    // 已被清理，忽略
  }
}

export function withFileLockSync<T>(lockPath: string, fn: () => T): T {
  acquireLockSync(lockPath);
  try {
    return fn();
  } finally {
    releaseLockSync(lockPath);
  }
}

async function isExpired(lockPath: string): Promise<boolean> {
  try {
    const raw = (await readFile(lockPath, "utf8")).trim();
    const createdAt = Number(raw);
    if (Number.isFinite(createdAt) && createdAt > 0) {
      return Date.now() - createdAt > DEFAULT_LOCK_TTL_MS;
    }
  } catch {
    // fall through to mtime check
  }
  try {
    return Date.now() - (await stat(lockPath)).mtimeMs > DEFAULT_LOCK_TTL_MS;
  } catch {
    return false;
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function tryAcquire(lockPath: string): Promise<boolean> {
  try {
    ensureDir(lockPath);
    const handle = await open(lockPath, "wx");
    await handle.close();
    await writeFile(lockPath, String(Date.now()), "utf8");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      if (await isExpired(lockPath)) {
        try {
          await unlink(lockPath);
        } catch {
          // 被其他进程抢先删除，忽略
        }
        return tryAcquire(lockPath);
      }
    }
    return false;
  }
}

async function acquireLock(lockPath: string) {
  const deadline = Date.now() + LOCK_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    if (await tryAcquire(lockPath)) return;
    await sleep(LOCK_RETRY_INTERVAL_MS);
  }
  throw new Error(`[file-lock] acquire lock timed out: ${lockPath}`);
}

async function releaseLock(lockPath: string) {
  try {
    await unlink(lockPath);
  } catch {
    // 已被清理，忽略
  }
}

export async function withFileLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
): Promise<T> {
  await acquireLock(lockPath);
  try {
    return await fn();
  } finally {
    await releaseLock(lockPath);
  }
}
