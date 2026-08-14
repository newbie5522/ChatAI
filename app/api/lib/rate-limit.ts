/**
 * Lightweight in-memory sliding-window rate limiter.
 * No third-party dependencies.
 */

interface WindowEntry {
  /** Timestamps (ms) of requests within the current window */
  timestamps: number[];
}

const store = new Map<string, WindowEntry>();

/** Remove entries that have been idle for more than the window duration */
function pruneStaleKeys(windowMs: number) {
  const now = Date.now();
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);
    if (entry.timestamps.length === 0) {
      store.delete(key);
    }
  }
}

let lastPruneAt = Date.now();
const PRUNE_INTERVAL_MS = 60_000; // prune at most once per minute

export interface RateLimitOptions {
  /** Maximum number of requests allowed in the window */
  limit: number;
  /** Sliding window duration in milliseconds */
  windowMs: number;
}

export interface RateLimitResult {
  /** Whether the request should be allowed */
  allowed: boolean;
  /** Remaining allowed requests in this window */
  remaining: number;
  /** How many ms until the window resets for this key */
  retryAfterMs: number;
}

/**
 * Check whether `key` (e.g. an IP address or username) is within the rate limit.
 * Mutates internal state — call once per incoming request.
 */
export function checkRateLimit(
  key: string,
  options: RateLimitOptions,
): RateLimitResult {
  const now = Date.now();

  // Periodic pruning of stale keys to avoid unbounded memory growth
  if (now - lastPruneAt > PRUNE_INTERVAL_MS) {
    pruneStaleKeys(options.windowMs);
    lastPruneAt = now;
  }

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Remove timestamps outside the sliding window
  entry.timestamps = entry.timestamps.filter(
    (t) => now - t < options.windowMs,
  );

  const count = entry.timestamps.length;

  if (count >= options.limit) {
    const oldest = entry.timestamps[0];
    const retryAfterMs = options.windowMs - (now - oldest);
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  entry.timestamps.push(now);
  return {
    allowed: true,
    remaining: options.limit - entry.timestamps.length,
    retryAfterMs: 0,
  };
}
