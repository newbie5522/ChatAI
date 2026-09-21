"use client";

/**
 * App Router 段级错误页（#14）。
 *
 * 与 app/components/error.tsx 的 React 错误边界互补：
 * - React 错误边界只覆盖渲染期抛出的错误；
 * - 段级错误页还会覆盖路由切换、Server Component 渲染失败等情况。
 * 两者的恢复策略共用 app/utils/chunk-recovery.ts，保证刷新次数口径一致。
 */

import { useEffect, useState } from "react";
import { ErrorPage } from "./components/error-page";
import {
  attemptChunkRecovery,
  describeRecoveryBlockedReason,
  isChunkLoadError,
} from "./utils/chunk-recovery";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const chunkError = isChunkLoadError(error);
  const [autoRecoveryAttempted, setAutoRecoveryAttempted] = useState(false);
  const [blockedReason, setBlockedReason] = useState("");

  useEffect(() => {
    if (!chunkError) {
      console.error("[RouteError]", error);
      return;
    }

    const decision = attemptChunkRecovery({ error });

    if (decision.reload) {
      setAutoRecoveryAttempted(true);
      return;
    }

    setBlockedReason(describeRecoveryBlockedReason(decision.reason));
  }, [error, chunkError]);

  return (
    <ErrorPage
      kind={chunkError ? "chunk" : "runtime"}
      error={error}
      autoRecoveryAttempted={autoRecoveryAttempted}
      autoRecoveryBlockedReason={blockedReason}
      onRetry={() => {
        // 分包加载失败只有整页重新加载才可靠；其他错误交给 reset 重渲染即可。
        if (chunkError && typeof window !== "undefined") {
          window.location.reload();
          return;
        }
        reset();
      }}
    />
  );
}
