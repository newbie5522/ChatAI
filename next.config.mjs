import webpack from "webpack";

const mode = process.env.BUILD_MODE ?? "standalone";
console.log("[Next] build mode", mode);

const disableChunk = !!process.env.DISABLE_CHUNK || mode === "export";
console.log("[Next] build with chunk: ", !disableChunk);

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config) {
    config.module.rules.push({
      test: /\.svg$/,
      use: ["@svgr/webpack"],
    });

    if (disableChunk) {
      config.plugins.push(
        new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
      );
    }

    config.resolve.fallback = {
      child_process: false,
    };

    return config;
  },
  output: mode,
  images: {
    unoptimized: mode === "export",
  },
  experimental: {
    forceSwcTransforms: true,
  },
};

if (mode !== "export") {
  /**
   * 缓存策略（#14）。
   *
   * 背景：`Loading CSS chunk failed` 的根因是"浏览器里仍是旧页面，去请求旧版本
   * 已被替换掉的分包文件"，属于**版本一致性**问题，单靠响应头无法解决，
   * 主要由 app/utils/chunk-recovery.ts 的一次性安全恢复 + 部署侧保留旧静态资源兜住。
   *
   * 这里只声明确实需要、且实测生效的一处：
   * Service Worker 相关脚本必须每次回源校验 —— 否则浏览器可能长期沿用旧脚本，
   * 新版本上线后仍在执行旧的刷新逻辑。
   *
   * ⚠️ 实测结论（2026-09-16，本地生产构建 + curl -I）：
   * - `/serviceWorker.js`、`/serviceWorkerRegister.js`：本配置生效 ✅
   * - `/_next/static/**`：Next 默认为 `public, max-age=31536000, immutable`，符合预期 ✅
   * - 文档入口 `/`：**本配置无法覆盖**。该路由被静态预渲染，Next 固定返回
   *   `Cache-Control: s-maxage=31536000, stale-while-revalidate`，
   *   在 `headers()` 里对 `/` 声明的规则会被忽略（已实测确认，故不再保留无效配置）。
   *   如需让文档每次都回源，必须在根页面改用动态渲染或在前置代理/CDN 侧加规则，
   *   这属于部署策略变更，已上报项目总控决定，不在本次改动内。
   */
  nextConfig.headers = async () => [
    {
      source: "/serviceWorker.js",
      headers: [
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
      ],
    },
    {
      source: "/serviceWorkerRegister.js",
      headers: [
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
      ],
    },
  ];

  nextConfig.rewrites = async () => {
    const ret = [
      // adjust for previous version directly using "/api/proxy/" as proxy base route
      // {
      //   source: "/api/proxy/v1/:path*",
      //   destination: "https://api.openai.com/v1/:path*",
      // },
      {
        // https://{resource_name}.openai.azure.com/openai/deployments/{deploy_name}/chat/completions
        source:
          "/api/proxy/azure/:resource_name/deployments/:deploy_name/:path*",
        destination:
          "https://:resource_name.openai.azure.com/openai/deployments/:deploy_name/:path*",
      },
      {
        source: "/api/proxy/google/:path*",
        destination: "https://generativelanguage.googleapis.com/:path*",
      },
      {
        source: "/api/proxy/openai/:path*",
        destination: "https://api.openai.com/:path*",
      },
      {
        source: "/api/proxy/anthropic/:path*",
        destination: "https://api.anthropic.com/:path*",
      },
      {
        source: "/google-fonts/:path*",
        destination: "https://fonts.googleapis.com/:path*",
      },
      {
        source: "/sharegpt",
        destination: "https://sharegpt.com/api/conversations",
      },
      {
        source: "/api/proxy/alibaba/:path*",
        destination: "https://dashscope.aliyuncs.com/api/:path*",
      },
    ];

    return {
      beforeFiles: ret,
    };
  };
}

export default nextConfig;
