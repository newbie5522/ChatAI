"use client";

/**
 * App Router 根级兜底错误页（#14）。
 *
 * 当根布局本身渲染失败时，Next.js 会用这个文件替换整个根布局，
 * 因此这里必须自行输出 <html> / <body>。
 * 注意：这种情形下 globals.scss 的主题变量可能尚未生效，
 * 错误页样式已通过 --ep-* 变量兜底，不会退化成无样式裸页面。
 *
 * 恢复策略与 React 错误边界、段级错误页共用 app/utils/chunk-recovery.ts，
 * 确保"分包加载失败最多自动刷新一次"这一约束在三条路径上口径一致。
 */

import { useEffect, useState } from "react";
import { ErrorPage } from "./components/error-page";
import {
  attemptChunkRecovery,
  describeRecoveryBlockedReason,
  isChunkLoadError,
} from "./utils/chunk-recovery";

export default function GlobalError({
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
      console.error("[GlobalError]", error);
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
    <html lang="zh-CN">
      <body style={{ margin: 0 }}>
        <ErrorPage
          kind={chunkError ? "chunk" : "runtime"}
          error={error}
          autoRecoveryAttempted={autoRecoveryAttempted}
          autoRecoveryBlockedReason={blockedReason}
          onRetry={() => {
            if (chunkError && typeof window !== "undefined") {
              window.location.reload();
              return;
            }
            reset();
          }}
        />
      </body>
    </html>
  );
}
