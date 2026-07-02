# NewbieChat

NewbieChat 是基于开源 NextChat 项目进行二次开发的公司内部 AI 工作台。

本仓库用于公司级内部 AI 工具开发，计划包含：

* 员工内部访问密钥
* 公司统一管理 AI Provider
* OpenAI / Google Gemini / Perplexity 网关分流
* 员工用量统计与额度控制
* 管理员后台
* 公司 Prompt / Mask 模板
* 多模型聊天、图片识别、生图等工作流

## 当前状态

本项目处于内部开发阶段。

当前阶段：

* 项目底座：NextChat
* 项目品牌名：NewbieChat
* 开发方式：基于原项目结构，按任务包逐步二次开发

## 开发规则

本项目必须遵守以下规则：

1. 不从 0 重写项目。
2. 尽量保留 NextChat 原项目结构。
3. 不允许把官方 API Key 写入源码。
4. 不允许把官方 Provider Key 暴露到前端。
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

## 部署

本项目将作为公司内部 AI 工作台部署。

推荐部署方式：

* VPS + Docker
* Vercel
* 私有云环境

## 许可证

本项目基于开源 NextChat 项目进行二次开发，并保留原 MIT License。
