"use client";

/**
 * 中文、可操作的错误页。
 *
 * 设计原则（对应 #14 的要求）：
 * - 面向员工，不用技术词汇，明确告诉用户"发生了什么 / 现在该做什么"。
 * - 主操作永远是「重新加载页面」，因为它对分包加载失败这类问题真正有效；
 *   不再把「清空全部数据」当作首选动作 —— 那对加载失败不对症，还会破坏用户数据。
 * - 技术细节折叠收起，只在需要反馈问题时展开；展开的也只是脱敏后的
 *   错误类型 / 错误码 / 请求标识，不含错误原文与完整地址（见 app/utils/error-display.ts）。
 * - 不对"数据是否已被保存"做任何承诺：当前系统仍以浏览器会话状态为中心，
 *   服务端权威持久化是 V2 后续目标，这里只能说明"该做什么"。
 */

import styles from "./error-page.module.scss";
import { toSafeErrorDisplay } from "../utils/error-display";

export type ErrorPageKind = "chunk" | "runtime" | "not-found";

type ErrorPageCopy = {
  badge: string;
  title: string;
  description: string;
};

const COPY: Record<ErrorPageKind, ErrorPageCopy> = {
  chunk: {
    badge: "版本已更新",
    title: "页面加载失败",
    description:
      "刚才没能取到打开这个页面所需的文件。\n这通常出现在系统刚发布新版本，而浏览器里还留着旧页面的时候。",
  },
  runtime: {
    badge: "页面出错",
    title: "这一步没能完成",
    // 这里只说明"发生了什么 / 该做什么"，不对聊天数据的存储位置或存活情况做任何保证。
    // 当前实现以浏览器会话状态为中心，服务端权威持久化是 V2 后续目标，
    // 无法被现实现证明的话一律不写进面向员工的文案。
    description:
      "页面遇到了一个错误。\n你可以重新加载页面；如果反复出现，请把技术信息发给管理员。",
  },
  "not-found": {
    badge: "地址无效",
    title: "页面不存在",
    description: "这个地址可能已经变更或失效。",
  },
};

export type ErrorPageProps = {
  kind?: ErrorPageKind;
  /** 原始错误，用于折叠区里的技术信息 */
  error?: unknown;
  /** 是否刚刚已经自动刷新过一次（对分包失败而言） */
  autoRecoveryAttempted?: boolean;
  /** 为什么不再自动刷新，用于向用户解释 */
  autoRecoveryBlockedReason?: string;
  /** 自定义「重新加载」的行为；默认刷新当前页面 */
  onRetry?: () => void;
  className?: string;
};

export function ErrorPage(props: ErrorPageProps) {
  const {
    kind = "runtime",
    error,
    autoRecoveryAttempted = false,
    autoRecoveryBlockedReason,
    onRetry,
    className,
  } = props;

  const copy = COPY[kind];

  const handleRetry = () => {
    if (onRetry) {
      onRetry();
      return;
    }
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  // 只展示脱敏后的信息：错误类型名、错误码、请求标识，以及"站点 + 路径"形式的来源。
  // 原始 error.message 与完整页面地址（含 query / hash 参数）一律不出现在页面上。
  const detail = toSafeErrorDisplay(
    error,
    typeof window !== "undefined" ? window.location.href : undefined,
  );

  return (
    <div
      className={[styles["error-page"], className].filter(Boolean).join(" ")}
    >
      <div className={styles.card} role="alert">
        <span className={styles.badge}>{copy.badge}</span>
        <h1 className={styles.title}>{copy.title}</h1>
        <p className={styles.description}>{copy.description}</p>

        {autoRecoveryAttempted && (
          <p className={styles.note}>
            已经自动重新加载过一次，但问题还在，所以不再重复刷新。
            <br />
            请点下面的按钮手动重试；如果仍然打不开，请把下面的技术信息发给管理员。
          </p>
        )}

        {!autoRecoveryAttempted && autoRecoveryBlockedReason && (
          <p className={styles.note}>{autoRecoveryBlockedReason}</p>
        )}

        <div className={styles.actions}>
          {kind === "not-found" ? (
            // 404 场景下"重新加载"没有意义，直接给出唯一有用的动作。
            <a className={styles.primaryButton} href="#/">
              回到聊天
            </a>
          ) : (
            <>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={handleRetry}
              >
                重新加载页面
              </button>
              <a className={styles.secondaryButton} href="#/">
                回到聊天
              </a>
            </>
          )}
        </div>

        {detail && (
          <details className={styles.details}>
            <summary>技术信息（反馈问题时请复制这里）</summary>
            <div className={styles.detailBody}>
              {detail.name && <code>错误类型：{detail.name}</code>}
              {detail.code && <code>错误码：{detail.code}</code>}
              {detail.requestId && <code>请求标识：{detail.requestId}</code>}
              {detail.location && <code>来源：{detail.location}</code>}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
