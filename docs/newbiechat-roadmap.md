# NewbieChat 阶段排程补充

本文档记录当前开发阶段之外的排程补充项，避免在阶段实现时漏掉部署与验收要求。

## 阶段 3：Provider Gateway

- OpenAI 请求统一走 `/api/gateway/openai`
- Google Gemini 请求统一走 `/api/gateway/google`
- Perplexity 请求统一走 `/api/gateway/perplexity`
- 请求进入 Provider 前必须完成员工密钥校验
- 官方 Provider Key 只允许服务端读取和注入

## 阶段 6：安全、部署与最终验收

阶段 6 需要加入 Docker 一键部署能力，作为最终部署验收的一部分。

最低验收项：

- 保留并验证 `Dockerfile`
- 提供可直接使用的 `docker-compose.yml`
- 提供 `.env.template` 到 `.env` 的配置说明
- 支持通过 Docker 环境变量配置 `EMPLOYEE_ACCESS_KEYS`
- 支持通过 Docker 环境变量配置 `OPENAI_API_KEY`、`GOOGLE_API_KEY`、`PERPLEXITY_API_KEY`
- 支持 `docker compose up -d` 一键启动
- 容器启动后 `http://localhost:3000` 可访问
- Docker 部署下前端仍不暴露官方 Provider Key
- Docker 部署下员工密钥、Gateway、流式响应均可用
