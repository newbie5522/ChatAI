#!/usr/bin/env node
/**
 * #14 E2E 专用：把「生产构建产物」跑起来。
 *
 * 为什么必须用构建产物而不是 `next dev`：
 * 这一号问题的成立条件是——浏览器里跑着旧页面，服务器上已经是新版本，
 * 旧页面去请求带哈希的旧分包文件，而新版本里已经不存在这些文件。
 * 只有生产构建才会产生带哈希的分包文件名，开发模式下不会复现，
 * 所以 E2E 必须跑真实构建产物，否则测试通过也没有意义。
 *
 * 这个脚本做三件事：
 * 1. 把 `public/` 与 `.next/static/` 补进 `.next/standalone/`。
 *    Next 生成的 standalone 产物默认不含这两者，Dockerfile 的 runner 阶段
 *    是手动 COPY 进去的，这里做同样的补齐，保证本地跑的和线上容器一致。
 * 2. 用临时目录承接管理配置与用量日志，避免污染开发机的 .data 数据。
 * 3. 启动 `.next/standalone/server.js`，并把退出信号转发给它。
 *
 * 前置条件：先在项目根目录执行一次生产构建
 *   BUILD_MODE=standalone npx next build
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..", "..");
const standaloneDir = path.join(projectRoot, ".next", "standalone");
const serverEntry = path.join(standaloneDir, "server.js");

const PORT = Number(process.env.E2E_PORT ?? 4183);
const HOST = "127.0.0.1";

if (!existsSync(serverEntry)) {
  console.error(
    [
      "",
      "找不到生产构建产物：",
      `  ${serverEntry}`,
      "",
      "请先在项目根目录执行一次生产构建（约需 3~5 分钟）：",
      "",
      "  BUILD_MODE=standalone npx next build",
      "",
      "构建完成后再重新运行 E2E。",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

/**
 * 递归复制目录内容，目标已存在同名文件时直接覆盖写入。
 *
 * 这里刻意不用 fs.cp：它在覆盖已存在文件前会先删除目标文件，
 * 而"删除文件"这类动作在本机会触发文件删除保护。
 * 只用 mkdir + copyFile 覆盖写入，不做任何删除，行为更可控。
 */
async function copyTree(sourceDir, targetDir) {
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const from = path.join(sourceDir, entry.name);
    const to = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyTree(from, to);
    } else if (entry.isFile()) {
      await copyFile(from, to);
    }
    // 其他类型（符号链接、设备文件）在构建产物里不应出现，直接忽略
  }
}

/**
 * 把项目里的某个目录同步到 standalone 产物中。
 *
 * @param {string} fromRelative 相对项目根目录的源路径
 * @param {string} toRelative   相对 .next/standalone 的目标路径
 * @param {{ onlyIfMissing?: boolean }} [options]
 */
async function copyInto(fromRelative, toRelative, options = {}) {
  const source = path.join(projectRoot, fromRelative);
  const target = path.join(standaloneDir, toRelative);

  if (!existsSync(source)) {
    console.log(`[e2e] 跳过（源目录不存在）：${fromRelative}`);
    return;
  }

  if (options.onlyIfMissing && existsSync(target)) {
    console.log(`[e2e] 已存在，跳过：.next/standalone/${toRelative}`);
    return;
  }

  await copyTree(source, target);
  console.log(`[e2e] 已补齐 ${fromRelative} -> .next/standalone/${toRelative}`);
}

await copyInto("public", "public");
await copyInto(path.join(".next", "static"), path.join(".next", "static"));

// standalone 产物本身已包含 .next/server；只有在缺失时才补，
// 保持与 Dockerfile runner 阶段一致，同时避免每次重复复制上百 MB。
await copyInto(path.join(".next", "server"), path.join(".next", "server"), {
  onlyIfMissing: true,
});

const dataDir = path.join(tmpdir(), "newbiechat-e2e-data");
await mkdir(dataDir, { recursive: true });

const child = spawn(process.execPath, ["server.js"], {
  cwd: standaloneDir,
  stdio: ["ignore", "inherit", "inherit"],
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOSTNAME: HOST,
    PORT: String(PORT),
    NEXT_TELEMETRY_DISABLED: "1",

    // 与 Dockerfile runner 阶段对齐的最小环境变量集合。
    // 指向临时目录，保证测试不会写入开发机的真实数据文件。
    NEWBIE_ADMIN_CONFIG_PATH: path.join(dataDir, "newbiechat-admin.json"),
    NEWBIE_USAGE_LOG_PATH: path.join(dataDir, "newbiechat-usage.json"),
    ADMIN_SECRET: "e2e-admin-secret",
    ADMIN_PASSWORD: "e2e-admin-password",
    EMPLOYEE_ACCESS_KEYS: "e2e-employee-key",
    PROXY_URL: "",
    BUILD_MODE: "standalone",
  },
});

console.log(`[e2e] standalone server 启动中：http://${HOST}:${PORT}`);

let stopping = false;
const stop = (signal) => {
  if (stopping) return;
  stopping = true;
  try {
    child.kill(signal);
  } catch {
    // 进程可能已经退出，忽略
  }
};

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stop(signal));
}

child.on("exit", (code, signal) => {
  if (!stopping) {
    console.error(`[e2e] standalone server 意外退出：code=${code} signal=${signal}`);
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error("[e2e] 无法启动 standalone server：", error);
  process.exit(1);
});
