import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * 错误恢复层的行为测试（#14）。
 *
 * 这里只验证组件自身的分支：什么时候自动刷新、什么时候不刷新、页面上给用户看什么。
 * "冷却窗口 / 会话上限 / 在线判断"这些判定规则由 test/chunk-recovery.test.ts 覆盖，
 * 因此此处把 attemptChunkRecovery 换成可控制的桩，避免两层测试互相重叠。
 */

const mockAttemptChunkRecovery = jest.fn();

jest.mock("../app/utils/chunk-recovery", () => {
  const actual = jest.requireActual("../app/utils/chunk-recovery");
  return {
    ...actual,
    attemptChunkRecovery: (...args: unknown[]) =>
      mockAttemptChunkRecovery(...args),
  };
});

import { ErrorBoundary } from "../app/components/error";
import { ErrorPage } from "../app/components/error-page";

function chunkError(message = "Loading CSS chunk 6814 failed") {
  const error = new Error(message);
  error.name = "ChunkLoadError";
  return error;
}

function Bomb({ error }: { error: Error }): React.ReactElement {
  throw error;
}

describe("ErrorBoundary", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockAttemptChunkRecovery.mockReset();
    // React 会把错误边界的错误打到 console.error，测试里静音，保持输出干净
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("renders children untouched while nothing is wrong", () => {
    render(
      <ErrorBoundary>
        <div>正常内容</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("正常内容")).toBeInTheDocument();
    expect(mockAttemptChunkRecovery).not.toHaveBeenCalled();
  });

  it("auto recovers once for a chunk load failure and tells the user what happened", async () => {
    mockAttemptChunkRecovery.mockReturnValue({
      reload: true,
      reason: "first-attempt",
    });

    render(
      <ErrorBoundary>
        <Bomb error={chunkError()} />
      </ErrorBoundary>,
    );

    expect(await screen.findByText("页面加载失败")).toBeInTheDocument();
    expect(screen.getByText("版本已更新")).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByText(/已经自动重新加载过一次，但问题还在/),
      ).toBeInTheDocument();
    });

    expect(mockAttemptChunkRecovery).toHaveBeenCalledTimes(1);
  });

  it("does not auto recover again while the cooldown is active, and explains why", async () => {
    mockAttemptChunkRecovery.mockReturnValue({
      reload: false,
      reason: "cooldown-active",
    });

    render(
      <ErrorBoundary>
        <Bomb error={chunkError()} />
      </ErrorBoundary>,
    );

    expect(await screen.findByText("页面加载失败")).toBeInTheDocument();
    expect(
      screen.getByText(/刚刚已经自动重新加载过一次。为避免反复刷新/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/已经自动重新加载过一次，但问题还在/),
    ).toBeNull();
  });

  it("explains an offline situation instead of reloading", async () => {
    mockAttemptChunkRecovery.mockReturnValue({
      reload: false,
      reason: "offline",
    });

    render(
      <ErrorBoundary>
        <Bomb error={chunkError()} />
      </ErrorBoundary>,
    );

    expect(await screen.findByText(/检测到当前网络已断开/)).toBeInTheDocument();
  });

  it("explains an exhausted session budget instead of reloading", async () => {
    mockAttemptChunkRecovery.mockReturnValue({
      reload: false,
      reason: "session-limit",
    });

    render(
      <ErrorBoundary>
        <Bomb error={chunkError()} />
      </ErrorBoundary>,
    );

    expect(
      await screen.findByText(/本次会话中的自动重试次数已经用完/),
    ).toBeInTheDocument();
  });

  it("never reloads for an ordinary runtime error", async () => {
    mockAttemptChunkRecovery.mockReturnValue({
      reload: false,
      reason: "not-chunk-error",
    });

    render(
      <ErrorBoundary>
        <Bomb error={new Error("服务端返回 500")} />
      </ErrorBoundary>,
    );

    expect(await screen.findByText("这一步没能完成")).toBeInTheDocument();
    expect(screen.queryByText("页面加载失败")).toBeNull();
    expect(mockAttemptChunkRecovery).not.toHaveBeenCalled();
  });

  it("keeps the recovery actionable and no longer offers a destructive reset", async () => {
    mockAttemptChunkRecovery.mockReturnValue({
      reload: false,
      reason: "cooldown-active",
    });

    render(
      <ErrorBoundary>
        <Bomb error={chunkError()} />
      </ErrorBoundary>,
    );

    expect(
      await screen.findByRole("button", { name: "重新加载页面" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "回到聊天" })).toBeInTheDocument();
    expect(
      screen.getByText("技术信息（反馈问题时请复制这里）"),
    ).toBeInTheDocument();

    // 关键回归保护：加载失败属于"刷新即可"的问题，
    // 不能把「清空全部数据」这种破坏性动作摆在用户面前。
    expect(screen.queryByText(/清空全部数据/)).toBeNull();
  });
});

describe("ErrorPage", () => {
  it("gives the not found page its own copy and a single useful action", () => {
    render(<ErrorPage kind="not-found" />);
    expect(screen.getByText("页面不存在")).toBeInTheDocument();
    expect(screen.getByText("地址无效")).toBeInTheDocument();
    // 404 场景下"重新加载"没有意义，只保留「回到聊天」
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link", { name: "回到聊天" })).toBeInTheDocument();
  });

  it("shows the underlying error only inside the collapsed details area", () => {
    render(<ErrorPage kind="chunk" error={chunkError()} />);
    expect(
      screen.getByText("ChunkLoadError: Loading CSS chunk 6814 failed"),
    ).toBeInTheDocument();
  });
});
