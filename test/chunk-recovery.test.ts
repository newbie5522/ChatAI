import {
  CHUNK_RECOVERY_STORAGE_KEY,
  MAX_AUTO_RECOVERIES_PER_SESSION,
  RECOVERY_COOLDOWN_MS,
  attemptChunkRecovery,
  decideChunkRecovery,
  isChunkLoadError,
  readRecoveryRecord,
  writeRecoveryRecord,
} from "../app/utils/chunk-recovery";

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, String(value)),
  } as Storage;
}

function chunkError(message = "Loading CSS chunk 6814 failed") {
  const error = new Error(message);
  error.name = "ChunkLoadError";
  return error;
}

describe("isChunkLoadError", () => {
  it("recognises the webpack ChunkLoadError by name", () => {
    expect(isChunkLoadError(chunkError())).toBe(true);
  });

  it("recognises the CSS chunk failure message produced by the settings page", () => {
    const error = new Error("Loading CSS chunk 6814 failed");
    expect(isChunkLoadError(error)).toBe(true);
  });

  it("recognises plain JS chunk failures", () => {
    expect(isChunkLoadError(new Error("Loading chunk 1234 failed"))).toBe(true);
  });

  it("recognises native dynamic import failures", () => {
    expect(
      isChunkLoadError(new Error("Failed to fetch dynamically imported module")),
    ).toBe(true);
  });

  it("recognises webpack code based errors without a known name", () => {
    expect(isChunkLoadError({ code: "CSS_CHUNK_LOAD_FAILED" })).toBe(true);
  });

  it("does not treat ordinary errors as chunk failures", () => {
    expect(isChunkLoadError(new Error("Network request failed"))).toBe(false);
    expect(
      isChunkLoadError(new Error("Cannot read properties of undefined")),
    ).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe("decideChunkRecovery", () => {
  const now = 1_700_000_000_000;

  it("allows the first recovery attempt", () => {
    const decision = decideChunkRecovery({
      error: chunkError(),
      now,
      offline: false,
      record: null,
    });
    expect(decision).toEqual({ reload: true, reason: "first-attempt" });
  });

  it("never reloads for non chunk errors", () => {
    const decision = decideChunkRecovery({
      error: new Error("Network request failed"),
      now,
      offline: false,
      record: null,
    });
    expect(decision).toEqual({ reload: false, reason: "not-chunk-error" });
  });

  it("never reloads while the browser reports offline", () => {
    const decision = decideChunkRecovery({
      error: chunkError(),
      now,
      offline: true,
      record: null,
    });
    expect(decision).toEqual({ reload: false, reason: "offline" });
  });

  it("suppresses a second reload inside the cooldown window", () => {
    const decision = decideChunkRecovery({
      error: chunkError(),
      now,
      offline: false,
      record: { lastAttemptAt: now - 1_000, totalAttempts: 1 },
    });
    expect(decision).toEqual({ reload: false, reason: "cooldown-active" });
  });

  it("allows one more reload after the cooldown window has elapsed", () => {
    const decision = decideChunkRecovery({
      error: chunkError(),
      now,
      offline: false,
      record: {
        lastAttemptAt: now - RECOVERY_COOLDOWN_MS - 1,
        totalAttempts: 1,
      },
    });
    expect(decision).toEqual({ reload: true, reason: "cooldown-elapsed" });
  });

  it("stops reloading once the session limit is reached", () => {
    const decision = decideChunkRecovery({
      error: chunkError(),
      now,
      offline: false,
      record: {
        lastAttemptAt: now - RECOVERY_COOLDOWN_MS - 1,
        totalAttempts: MAX_AUTO_RECOVERIES_PER_SESSION,
      },
    });
    expect(decision).toEqual({ reload: false, reason: "session-limit" });
  });
});

describe("attemptChunkRecovery", () => {
  it("reloads once and records the attempt", () => {
    const storage = createMemoryStorage();
    const reload = jest.fn();

    const decision = attemptChunkRecovery({
      error: chunkError(),
      now: 1000,
      storage,
      reload,
    });

    expect(decision).toEqual({ reload: true, reason: "first-attempt" });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(readRecoveryRecord(storage)).toEqual({
      lastAttemptAt: 1000,
      totalAttempts: 1,
    });
  });

  it("does not loop: an immediate second failure is suppressed and shows the error page", () => {
    const storage = createMemoryStorage();
    const reload = jest.fn();

    attemptChunkRecovery({ error: chunkError(), now: 1000, storage, reload });
    const second = attemptChunkRecovery({
      error: chunkError(),
      now: 1000 + 500,
      storage,
      reload,
    });
    const third = attemptChunkRecovery({
      error: chunkError(),
      now: 1000 + 900,
      storage,
      reload,
    });

    expect(second).toEqual({ reload: false, reason: "cooldown-active" });
    expect(third).toEqual({ reload: false, reason: "cooldown-active" });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("stops for good after the session limit, even once the cooldown elapsed", () => {
    const storage = createMemoryStorage();
    const reload = jest.fn();

    let clock = 0;
    for (let index = 0; index < MAX_AUTO_RECOVERIES_PER_SESSION + 3; index++) {
      attemptChunkRecovery({ error: chunkError(), now: clock, storage, reload });
      clock += RECOVERY_COOLDOWN_MS + 1;
    }

    expect(reload).toHaveBeenCalledTimes(MAX_AUTO_RECOVERIES_PER_SESSION);
  });

  it("does not touch the network for unrelated errors", () => {
    const storage = createMemoryStorage();
    const reload = jest.fn();

    const decision = attemptChunkRecovery({
      error: new Error("500 from upstream"),
      now: 1000,
      storage,
      reload,
    });

    expect(decision).toEqual({ reload: false, reason: "not-chunk-error" });
    expect(reload).not.toHaveBeenCalled();
    expect(storage.getItem(CHUNK_RECOVERY_STORAGE_KEY)).toBeNull();
  });

  it("keeps working when storage is unavailable", () => {
    const reload = jest.fn();
    const decision = attemptChunkRecovery({
      error: chunkError(),
      now: 1000,
      storage: null,
      reload,
    });
    expect(decision.reload).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("ignores corrupted records instead of getting stuck", () => {
    const storage = createMemoryStorage();
    storage.setItem(CHUNK_RECOVERY_STORAGE_KEY, "{not json");
    expect(readRecoveryRecord(storage)).toBeNull();

    const reload = jest.fn();
    const decision = attemptChunkRecovery({
      error: chunkError(),
      now: 1000,
      storage,
      reload,
    });
    expect(decision.reload).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reads back what it wrote", () => {
    const storage = createMemoryStorage();
    writeRecoveryRecord({ lastAttemptAt: 42, totalAttempts: 2 }, storage);
    expect(readRecoveryRecord(storage)).toEqual({
      lastAttemptAt: 42,
      totalAttempts: 2,
    });
  });
});
