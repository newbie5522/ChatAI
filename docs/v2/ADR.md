# V2 架构决策记录

## 使用方式

任何会影响数据模型、公共接口、存储、事件协议、权限、额度或部署方式的决定，必须先增加 ADR，再进入实现。

状态：Proposed / Accepted / Rejected / Superseded。

## ADR-001：服务端为会话唯一事实源

- 状态：Accepted
- 决定：Conversation、Message、Run、Attachment、Artifact 和 Usage 持久化在服务端；客户端仅保存草稿、视图状态和离线缓存。
- 原因：支持多端一致、刷新恢复、幂等、权限控制和审计。
- 影响：现有 localStorage 会话需兼容读取与渐进迁移。

## ADR-002：统一事件协议隔离供应商

- 状态：Accepted
- 决定：UI 只消费标准运行时事件，Provider Adapter 负责请求/响应转换。
- 原因：避免前端按供应商名称判断功能，支持中转协议差异和一致错误处理。

## ADR-003：媒体与附件使用持久 Artifact

- 状态：Accepted
- 决定：图片、视频和文件以 Artifact/Attachment ID 引用，对象存储保存内容。
- 原因：避免临时 URL、浏览器 Base64 和容器重启造成数据丢失。

## ADR-004：V2 灰度替换

- 状态：Accepted
- 决定：使用功能开关逐阶段启用V2，保留V1回滚通道。
- 原因：控制大规模重构风险。
