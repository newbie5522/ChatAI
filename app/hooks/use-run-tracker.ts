/**
 * useRunTracker — 可插拔的 ResponseRun 状态同步 hook
 *
 * Issue #17: 可恢复流式聊天运行时
 *
 * 用法：
 * ```typescript
 * const tracker = useRunTracker();
 * // 请求前：创建 run
 * const runId = await tracker.create({ messageId, providerId, modelId });
 * // 请求中：设置 streaming
 * await tracker.setStreaming(runId);
 * // 完成：设置 completed
 * await tracker.setCompleted(runId);
 * // 失败：设置 failed
 * await tracker.setFailed(runId, errorMessage);
 * // 停止：设置 aborted
 * await tracker.setAborted(runId);
 * ```
 *
 * 设计原则：
 * - 所有操作均为 fire-and-forget，失败时只 console.error，不影响聊天流程
 * - 适用于认证用户（未登录时调用均为 no-op）
 */

import { useCallback } from "react";
import { useAccountStore } from "@/app/store/account";

interface CreateRunInput {
  requestId: string;
  messageId: string;
  providerId: string;
  modelId: string;
  branchId?: string;
}

async function safePost(url: string, body: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.run?.id ?? null;
  } catch {
    return null;
  }
}

async function safePatch(url: string, body: unknown): Promise<void> {
  try {
    await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // fire-and-forget，失败静默忽略
  }
}

export function useRunTracker() {
  const authenticated = useAccountStore((s) => s.authenticated);

  const create = useCallback(
    async (input: CreateRunInput): Promise<string | null> => {
      if (!authenticated) return null;
      const runId = await safePost("/api/chat/runs", input);
      if (!runId) {
        console.error("[RunTracker] failed to create ResponseRun");
      }
      return runId;
    },
    [authenticated],
  );

  const setStreaming = useCallback(
    async (runId: string | null): Promise<void> => {
      if (!authenticated || !runId) return;
      await safePatch(`/api/chat/runs/${runId}`, { status: "streaming" });
    },
    [authenticated],
  );

  const setCompleted = useCallback(
    async (runId: string | null): Promise<void> => {
      if (!authenticated || !runId) return;
      await safePatch(`/api/chat/runs/${runId}`, { status: "completed" });
    },
    [authenticated],
  );

  const setFailed = useCallback(
    async (runId: string | null, errorMessage?: string): Promise<void> => {
      if (!authenticated || !runId) return;
      await safePatch(`/api/chat/runs/${runId}`, {
        status: "failed",
        errorMessage: errorMessage?.slice(0, 500),
      });
    },
    [authenticated],
  );

  const setAborted = useCallback(
    async (runId: string | null): Promise<void> => {
      if (!authenticated || !runId) return;
      await safePatch(`/api/chat/runs/${runId}`, { status: "aborted" });
    },
    [authenticated],
  );

  return { create, setStreaming, setCompleted, setFailed, setAborted };
}

/**
 * usePendingRunsDetector — 页面加载时检测是否有未完成的 run
 *
 * 在 app layout 或 home 组件 useEffect 里调用一次，
 * 有未完成的 run 时通过 onPending 回调通知 UI 展示恢复提示。
 */
export async function fetchPendingRuns(): Promise<
  Array<{ id: string; messageId: string; conversationId: string }>
> {
  try {
    const res = await fetch("/api/chat/runs/pending");
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.runs ?? []).map(
      (run: { id: string; message: { id: string; conversationId: string } }) => ({
        id: run.id,
        messageId: run.message.id,
        conversationId: run.message.conversationId,
      }),
    );
  } catch {
    return [];
  }
}
