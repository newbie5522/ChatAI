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
import { REDACTED, sanitizeErrorText } from "../app/utils/error-display";

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

  it("shows only the sanitized error type inside the collapsed details area", () => {
    render(<ErrorPage kind="chunk" error={chunkError()} />);

    // 折叠区里保留"错误类型"，方便管理员定位
    expect(screen.getByText(/错误类型：ChunkLoadError/)).toBeInTheDocument();
    expect(
      screen.getByText("技术信息（反馈问题时请复制这里）"),
    ).toBeInTheDocument();

    // 但错误原文（message）不再出现
    expect(document.body.textContent ?? "").not.toContain(
      "Loading CSS chunk 6814 failed",
    );
  });

  it("never promises that the chat data is stored or safe", () => {
    render(<ErrorPage kind="runtime" error={new Error("boom")} />);

    expect(screen.getByText("这一步没能完成")).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(
      /保存在服务器|保存在云端|不会丢失|已备份|不会丢/,
    );
  });
});

/**
 * #14 修复项 3：错误信息脱敏。
 *
 * 员工会把折叠区里的内容复制给管理员，因此这里必须保证：
 * 令牌、密钥、查询参数、服务器路径、内联 base64 图片都不能出现在页面上。
 */
describe("错误页技术信息脱敏", () => {
  /** 一条"什么都夹带"的错误，用来确认各类敏感内容都被挡住 */
  const SECRET_BEARER = "sk-live-abcdef0123456789";
  const SECRET_API_KEY = "hf_0123456789abcdef";
  const SECRET_QUERY = "token=supersecret&user=42";
  const SECRET_PATH = "/opt/newbiechat/.next/server/app/api/gateway/route.js";
  const SECRET_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg";

  function leakyError() {
    const error = new Error(
      [
        "请求处理失败",
        `Authorization: Bearer ${SECRET_BEARER}`,
        `x-api-key: ${SECRET_API_KEY}`,
        `url: https://api.example.com/v1/chat?${SECRET_QUERY}`,
        `path: ${SECRET_PATH}`,
        `image: ${SECRET_IMAGE}`,
      ].join("\n"),
    );
    error.name = "ChunkLoadError";
    return error;
  }

  it("does not render the raw error message anywhere on the page", () => {
    const error = leakyError();
    render(<ErrorPage kind="chunk" error={error} />);

    const text = document.body.textContent ?? "";
    expect(text).not.toContain(error.message);
    expect(text).not.toContain("请求处理失败");
  });

  it("does not leak bearer tokens or api keys", () => {
    render(<ErrorPage kind="chunk" error={leakyError()} />);

    const text = document.body.textContent ?? "";
    expect(text).not.toContain(SECRET_BEARER);
    expect(text).not.toContain(SECRET_API_KEY);
    expect(text).not.toContain("Bearer sk-live");
    expect(text).not.toContain("x-api-key:");
  });

  it("does not leak url query parameters, server paths or inline base64 images", () => {
    render(<ErrorPage kind="chunk" error={leakyError()} />);

    const text = document.body.textContent ?? "";
    expect(text).not.toContain(SECRET_QUERY);
    expect(text).not.toContain("?token=");
    expect(text).not.toContain(SECRET_PATH);
    expect(text).not.toContain("/opt/");
    expect(text).not.toContain(SECRET_IMAGE);
    expect(text).not.toContain("iVBORw0KGgoAAAANSUhEUg");
  });

  it("keeps the page usable: the reload action is still there", () => {
    render(<ErrorPage kind="chunk" error={leakyError()} />);
    expect(
      screen.getByRole("button", { name: "重新加载页面" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "回到聊天" })).toBeInTheDocument();
  });
});

describe("sanitizeErrorText", () => {
  it("redacts bearer tokens", () => {
    const output = sanitizeErrorText(
      "Authorization: Bearer sk-live-abcdef0123456789",
    );
    expect(output).not.toContain("sk-live-abcdef0123456789");
    expect(output).toContain(REDACTED);
  });

  it("redacts key=value credentials", () => {
    const output = sanitizeErrorText("api_key=abcdef123456&x=1");
    expect(output).not.toContain("abcdef123456");
    expect(output).toContain(REDACTED);
  });

  it("redacts url query parameters", () => {
    const output = sanitizeErrorText("failed on https://api.test/v1?a=1&b=2");
    expect(output).not.toContain("a=1");
    expect(output).not.toContain("b=2");
  });

  it("redacts server absolute paths on both platforms", () => {
    const posix = sanitizeErrorText("at /opt/newbiechat/server.js:12");
    expect(posix).not.toContain("/opt/newbiechat");

    const win = sanitizeErrorText("at C:\\Users\\MyPC\\secrets\\key.txt:1");
    expect(win).not.toContain("MyPC");
  });

  it("redacts inline base64 images", () => {
    const output = sanitizeErrorText("data:image/png;base64,AAAAAAAABBBBBBBBCCCC");
    expect(output).not.toContain("AAAAAAAABBBBBBBBCCCC");
  });

  it("leaves ordinary text untouched", () => {
    expect(sanitizeErrorText("Loading CSS chunk 6814 failed")).toBe(
      "Loading CSS chunk 6814 failed",
    );
  });
});
