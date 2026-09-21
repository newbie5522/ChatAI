import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * #14 端到端测试配置。
 *
 * 目的：把"旧版本页面跨一次新部署后打开设置页"这个验收场景真正跑起来，
 * 而不是只靠单元测试推断。
 *
 * 前置条件：先执行一次生产构建（BUILD_MODE=standalone）。
 * e2e/scripts/serve-standalone.mjs 会把 public 与 .next/static 补齐到 standalone 产物并启动服务。
 *
 * 运行：
 *   node node_modules/@playwright/test/cli.js test
 */
const PORT = Number(process.env.E2E_PORT ?? 4183);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * 失败时的截图与 trace 放在系统临时目录。
 *
 * 原因：Playwright 每轮开始都会先清空输出目录，
 * 而这个清空动作会撞上本机的文件删除保护；系统临时目录是被明确放行的位置。
 * 失败时 Playwright 会在日志里打印实际的 trace 路径，照着找即可。
 */
const OUTPUT_DIR = path.join(tmpdir(), "newbiechat-e2e-artifacts");

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  outputDir: OUTPUT_DIR,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    // 真实用户是中文员工；固定中文语言环境，保证界面文案与线上一致。
    locale: "zh-CN",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node e2e/scripts/serve-standalone.mjs",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { E2E_PORT: String(PORT) },
  },
});
