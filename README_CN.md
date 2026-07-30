# NewbieChat

NewbieChat 是基于开源 NextChat 项目进行二次开发的公司内部 AI 工作台。

本仓库用于公司级内部 AI 工具开发，计划包含：

- 员工账号密码登录
- 公司统一管理 AI Provider Credential
- OpenAI / Google Gemini / Perplexity / Claude 网关分流
- 员工 prompt 用量统计与额度控制
- 管理员后台
- 公司 Prompt / Mask 模板
- 多模型聊天、图片识别、生图等工作流

## 当前状态

本项目处于内部开发阶段。

当前阶段：

- 项目底座：NextChat
- 项目品牌名：NewbieChat
- 开发方式：基于原项目结构，按任务包逐步二次开发

## 开发规则

本项目必须遵守以下规则：

1. 不从 0 重写项目。
2. 尽量保留 NextChat 原项目结构。
3. 不允许把官方 API Key 写入源码。
4. 不允许把官方 Provider Key 暴露给普通员工。
5. 未明确批准前，不新增新的模型服务商。
6. 未明确要求前，不修改核心聊天逻辑。
7. 每个任务必须明确列出修改文件。
8. 每次修改完成后必须先审核，再进入下一步。

## 本地开发

安装依赖：

```bash
yarn install
```

启动开发服务：

```bash
yarn dev
```

打开：

```text
http://localhost:3000
```

## 构建

```bash
yarn build
```

## 首次初始化流程

1. 部署 NewbieChat。
2. 打开 `/#/admin`。
3. 使用 bootstrap 的 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 登录。
4. 在后台配置 OpenAI / Google / Perplexity / Anthropic Provider Credential。
5. 一个 Provider Credential 默认适用于该 Provider 下的聊天、搜索和生图模型。
6. “测试连接”仅用于排障，不是正常使用前的必需步骤。
7. 管理员启用需要开放给员工的模型，不需要逐个验证模型。
8. 创建员工账号和密码。
9. 给员工分配额度、允许分类和允许模型 ID。
10. 员工通过原版风格 Auth 页面登录。
11. 员工在模型选择器中看到“聊天、搜索、生图、视频”四个栏目。
12. 员工可以在现有聊天输入框中使用已授权的聊天、搜索和生图模型。
13. 生图第一版使用默认参数，不提供比例、清晰度、风格和数量设置。
14. 视频栏目暂时显示“待加入”。
15. 普通员工不会看到、也不需要填写官方 Provider API Key。

`.env` 只保存启动级配置。Provider Key、员工账号、额度和模型权限都在 `/#/admin` 管理。

feature 分支完成后不能直接投入使用。正式开放前必须先进行 GitHub diff 验收，验收通过后合并 `main`，确认 GitHub Actions 成功构建 GHCR 镜像，再由 VPS 拉取新镜像，并完成真实账号、聊天、搜索、生图和日志验收。

## 部署

本项目将作为公司内部 AI 工作台部署。

推荐部署方式：

- VPS + Docker
- Vercel
- 私有云环境

Docker 部署说明：[docs/docker-deployment.md](docs/docker-deployment.md)。

## 许可证

本项目基于开源 NextChat 项目进行二次开发，并保留原 MIT License。
