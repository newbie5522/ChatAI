import type { Config } from "jest";
import nextJest from "next/jest.js";

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: "./",
});

// Add any custom config to be passed to Jest
const config: Config = {
  coverageProvider: "v8",
  testEnvironment: "jsdom",
  testMatch: ["**/*.test.js", "**/*.test.ts", "**/*.test.jsx", "**/*.test.tsx"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  // `.worktrees/` 里是另一个执行端（并行窗口）的工作副本。
  // 如果不排除，本仓库执行测试时会连带跑起那份副本里的用例：
  // 既会出现同名模块冲突告警，也可能执行到"会改动文件"的用例，
  // 使本仓库的测试结果不可复现。并行开发场景下必须显式隔离。
  testPathIgnorePatterns: ["/node_modules/", "<rootDir>/.worktrees/"],
  modulePathIgnorePatterns: ["<rootDir>/.worktrees/"],
  // Keep next/jest transforms and jest.mock semantics consistent locally and in CI.
  extensionsToTreatAsEsm: [],
  injectGlobals: true,
};

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default createJestConfig(config);
