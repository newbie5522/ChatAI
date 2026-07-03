# NewbieChat 阶段排程补充

本文档记录当前开发阶段之外的排程补充项，避免在阶段实现时漏掉部署与验收要求。

## 阶段 3：Provider Gateway

- OpenAI 请求统一走 `/api/gateway/openai`
- Google Gemini 请求统一走 `/api/gateway/google`
- Perplexity 请求统一走 `/api/gateway/perplexity`
- Anthropic Claude 请求统一走 `/api/gateway/anthropic`
- 请求进入 Provider 前必须完成员工密钥校验
- 官方 Provider Key 只允许服务端读取和注入

## 阶段 4：用量统计与额度控制

- 每次 Gateway 请求记录员工、Provider、模型、时间、状态和估算 token
- 员工 `monthlyQuota` 按月生效，超额请求返回 429
- 员工可通过 `/api/usage` 查询自己的当月用量汇总与最近请求记录
- MVP 存储使用服务端 JSON 文件，默认路径为 `.data/newbiechat-usage.json`
- 后续管理员后台可复用同一存储层查询员工用量

## 阶段 5：管理员后台

- 管理员通过 `/#/admin` 进入后台
- 管理员认证使用 `ADMIN_PASSWORD`，会话 Cookie 使用 `ADMIN_SECRET` 签名
- 支持管理员创建、禁用员工密钥并设置月额度
- 支持管理员配置 OpenAI、Google、Perplexity、Anthropic 的服务端 Key 与 Base URL
- 支持管理员按 Provider 配置全局可用模型，未启用模型会从聊天模型列表隐藏并被网关拦截
- Provider Key 只在服务端保存，后台只展示脱敏状态
- 支持查看员工本月用量汇总与最近请求日志
- MVP 管理配置使用服务端 JSON 文件，默认路径为 `.data/newbiechat-admin.json`

## 阶段 6：安全、部署与最终验收

阶段 6 需要加入 Docker 一键部署能力，作为最终部署验收的一部分。

最低验收项：

- 保留并验证 `Dockerfile`
- 提供可直接使用的 `docker-compose.yml`
- 提供 `.env.template` 到 `.env` 的配置说明
- 支持通过 Docker 环境变量配置 `EMPLOYEE_ACCESS_KEYS`
- 支持通过 Docker 环境变量配置 `ADMIN_PASSWORD`、`ADMIN_SECRET`
- 支持通过 Docker 环境变量配置 `OPENAI_API_KEY`、`GOOGLE_API_KEY`、`PERPLEXITY_API_KEY`、`ANTHROPIC_API_KEY`
- 支持通过 Docker 环境变量或挂载卷配置 `NEWBIE_ADMIN_CONFIG_PATH`
- 支持通过 Docker 环境变量或挂载卷配置 `NEWBIE_USAGE_LOG_PATH`
- 支持 `docker compose up -d` 一键启动
- 容器启动后 `http://localhost:3000` 可访问
- Docker 部署下前端仍不暴露官方 Provider Key
- Docker 部署下员工密钥、Gateway、流式响应均可用
