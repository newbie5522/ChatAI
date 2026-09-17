"use client";

/**
 * 全局错误边界（#14）。
 *
 * 变更要点：
 * 1. 识别「分包加载失败（ChunkLoadError）」，这类问题刷新一次即可恢复，
 *    因此走一次安全的自动刷新（最多一次、有冷却窗口、有会话上限）。
 * 2. 其他错误一律不刷新，直接展示中文、可操作的错误页，避免把刷新当成万能药。
 * 3. 不再把「清空全部数据」作为错误页的首选动作 —— 对加载失败不对症且有破坏性。
 *
 * 自动刷新的保护逻辑集中在 app/utils/chunk-recovery.ts，其判定为纯函数并有单测覆盖。
 */

import React from "react";
import { ErrorPage } from "./error-page";
import {
  attemptChunkRecovery,
  describeRecoveryBlockedReason,
  isChunkLoadError,
} from "../utils/chunk-recovery";

interface IErrorBoundaryState {
  error: Error | null;
  chunkError: boolean;
  autoRecoveryAttempted: boolean;
  blockedReason: string;
}

export class ErrorBoundary extends React.Component<any, IErrorBoundaryState> {
  constructor(props: any) {
    super(props);
    this.state = {
      error: null,
      chunkError: false,
      autoRecoveryAttempted: false,
      blockedReason: "",
    };
  }

  static getDerivedStateFromError(error: Error): Partial<IErrorBoundaryState> {
    return { error, chunkError: isChunkLoadError(error) };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info?.componentStack);

    if (!isChunkLoadError(error)) return;

    const decision = attemptChunkRecovery({ error });

    if (!decision.reload) {
      this.setState({
        autoRecoveryAttempted: false,
        blockedReason: describeRecoveryBlockedReason(decision.reason),
      });
      return;
    }

    this.setState({ autoRecoveryAttempted: true, blockedReason: "" });
  }

  render() {
    const { error, chunkError, autoRecoveryAttempted, blockedReason } =
      this.state;

    if (!error) {
      return this.props.children;
    }

    return (
      <ErrorPage
        kind={chunkError ? "chunk" : "runtime"}
        error={error}
        autoRecoveryAttempted={autoRecoveryAttempted}
        autoRecoveryBlockedReason={blockedReason}
      />
    );
  }
}
