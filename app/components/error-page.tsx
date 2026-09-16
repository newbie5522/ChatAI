"use client";

/**
 * 中文、可操作的错误页。
 *
 * 设计原则（对应 #14 的要求）：
 * - 面向员工，不用技术词汇，明确告诉用户"发生了什么 / 现在该做什么"。
 * - 主操作永远是「重新加载页面」，因为它对分包加载失败这类问题真正有效；
 *   不再把「清空全部数据」当作首选动作 —— 那对加载失败不对症，还会破坏用户数据。
 * - 技术细节折叠收起，只在需要反馈问题时展开。
 * - 会话记录不会被这里影响，文案里明确说明，避免用户恐慌。
 */

import styles from "./error-page.module.scss";

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
    description:
      "页面遇到了一个错误。\n你的聊天记录保存在服务器上，不会因为这个错误丢失。",
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

function describeError(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  const candidate = error as {
    name?: string;
    message?: string;
    stack?: string;
  };
  const name = candidate?.name ? `${candidate.name}: ` : "";
  const message = candidate?.message ?? String(error);
  return `${name}${message}`.trim();
}

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

  const detail = describeError(error);

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
              <code>{detail}</code>
              <code>
                {typeof window !== "undefined" ? window.location.href : ""}
              </code>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
