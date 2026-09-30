# V2 数据模型设计文档（ADR-006）

## 状态
Proposed（等待架构复核与用户批准）

## 背景

V1 使用 localStorage 保存会话数据，存在以下问题：
1. **无法多端同步**：数据绑定在单个浏览器
2. **刷新后状态丢失**：流式输出、运行状态无法恢复
3. **无法审计**：缺少用量统计、错误追踪
4. **扩展困难**：消息分支、持久附件、异步媒体难以实现
5. **数据风险**：浏览器清理缓存会导致数据永久丢失

V2 目标是建立服务端持久化的数据模型，作为唯一事实源（ADR-001）。

## 决策

采用 **Prisma + PostgreSQL** 实现以下核心实体：

### 1. Conversation（会话）
- 多轮对话的容器
- 关联到 `employeeId`（员工账号）
- 支持软删除（`deletedAt`）

### 2. Message（消息）
- 用户或助手的单条发言
- 支持消息分支（`parentId`）：实现"重新生成"时保留历史分支
- 关联到 `conversationId`
- 支持软删除

### 3. Run（运行）
- 单次模型调用的生命周期
- 状态机：`pending` → `running` → `completed/failed/cancelled`
- 包含 `requestId`（幂等标识）防止重复扣费
- 关联到 `messageId`（一个助手消息可能有多次运行，如重试）

### 4. Attachment（附件）
- 消息关联的文件引用
- 类型：`upload`（用户上传）、`image`/`video`/`audio`（模型生成）
- 关联到 `artifactId`（真实存储对象）

### 5. Artifact（产物）
- 持久化的二进制对象
- 存储在对象存储（S3/MinIO）
- 包含 `storageKey`、`mimeType`、`size`、`checksum`

### 6. Usage（用量）
- 记录每次 Run 的 token 消耗和成本
- 支持按员工 + 时间范围聚合统计

## 核心约束（契约冻结门禁）

按照规划师裁决的"启动门禁放宽"规则，以下 10 项内容构成契约冻结门禁：

### 1. 核心实体/关系/唯一约束/状态机
- **实体**：Conversation, Message, Run, Attachment, Artifact, Usage
- **关系**：
  - Conversation 1:N Message
  - Message 1:N Run
  - Message 1:N Attachment
  - Message 1:N Message（自关联，支持分支）
  - Attachment N:1 Artifact
  - Run 1:1 Usage
- **唯一约束**：
  - `Run.requestId`（幂等）
  - `Artifact.storageKey`（防重）
- **状态机**：
  - Run: `pending` → `running` → `completed/failed/cancelled`
  - Conversation/Message: 软删除（`deletedAt`）

### 2. ID/时间戳/版本号/软删除/撤销语义
- **ID**：使用 `cuid()`（Collision-resistant Unique ID）
- **时间戳**：`createdAt`（创建时间）、`updatedAt`（更新时间，仅 Conversation）
- **软删除**：`deletedAt`（Conversation, Message）
- **撤销**：暂不支持（V2 初版）

### 3. 事务边界与幂等
- **事务边界**：
  - 创建消息 + 创建 Run（原子操作）
  - 更新 Run 状态 + 记录 Usage（原子操作）
- **幂等**：
  - `Run.requestId` 唯一约束保证重复请求不会重复扣费
  - 前端重试时必须携带相同 `requestId`

### 4. 额度预留确认释放状态转换
- **预留**：创建 Run 时预扣额度（基于模型估算）
- **确认**：Run 完成时根据实际 Usage 结算
- **释放**：Run 失败/取消时释放预扣额度
- **状态转换**：
  ```
  pending（预扣） → running → completed（实际结算）
                            ↘ failed/cancelled（释放预扣）
  ```

### 5. 消息/附件/产物/运行记录生命周期
- **消息**：软删除（`deletedAt`），关联的 Run/Attachment 级联删除
- **附件**：跟随消息删除，但 Artifact 保留（可能被其他附件引用）
- **产物**：引用计数为 0 时由后台任务清理
- **运行记录**：跟随消息删除（Cascade）

### 6. Provider+Model+Endpoint/Route+CapabilityProfile 关系
- **V2 初版不实现 Provider/Model 表**（继承 V1 配置）
- **预留扩展**：Run 记录 `model` 和 `providerName`，未来可关联到 Model 表
- **Capability**：由 Model Gateway（#20）负责，不在数据模型层

### 7. 错误码与重试语义
- **错误码**：Run 失败时记录 `errorCode` 和 `errorMessage`
- **重试**：前端发起，创建新 Run（新 `requestId`），关联到同一 Message
- **错误分类**：
  - `NETWORK_ERROR`（可重试）
  - `RATE_LIMIT`（可重试，需延迟）
  - `INVALID_REQUEST`（不可重试）
  - `QUOTA_EXCEEDED`（不可重试）

### 8. 数据迁移映射与兼容策略
- **映射**：见 `docs/v2/MIGRATION.md`
- **兼容**：V2 上线后 V1 localStorage 只读，不再写入
- **灰度**：通过环境变量 `ENABLE_V2_DATA_MODEL` 开关

### 9. 类型定义/示例数据/契约测试
- **类型**：`app/types/v2-models.ts`
- **示例**：见测试文件 `tests/repositories.test.ts`
- **契约测试**：
  - 仓储层单元测试（Vitest）
  - 数据库约束测试（唯一性、外键、级联删除）

### 10. 契约负责人及变更审批规则
- **负责人**：WorkBuddy(WB-00)
- **变更审批**：
  - Schema 变更必须通过 Prisma migration
  - 破坏性变更（删除字段、改约束）需架构复核
  - 新增字段/表不影响现有功能的可直接合并

## 技术选型

### Prisma
- **优势**：
  - 类型安全的 ORM
  - 自动生成 TypeScript 类型
  - 内置迁移工具
  - 支持 PostgreSQL、MySQL、SQLite
- **劣势**：
  - 增加构建体积（~2MB）
  - 查询性能略低于原生 SQL（可接受）

### PostgreSQL
- **优势**：
  - 成熟稳定，ACID 保证
  - 支持 JSON 字段（`Attachment.metadata`）
  - 丰富的索引类型
  - Docker 部署简单
- **劣势**：
  - 需额外维护数据库（备份、监控）
  - 本地开发需运行 Docker

## 影响面

### 新增依赖
- `prisma`（dev）
- `@prisma/client`（runtime）

### 新增文件
- `prisma/schema.prisma`（数据模型定义）
- `prisma/migrations/`（数据库迁移脚本）
- `app/types/v2-models.ts`（TypeScript 类型）
- `app/repositories/index.ts`（仓储层）
- `tests/repositories.test.ts`（单元测试）
- `scripts/migrate-v1-to-v2.ts`（数据迁移脚本）
- `docs/v2/MIGRATION.md`（迁移指南）
- `docker-compose.dev.yml`（本地数据库）

### 不改动的文件
- `app/store/chat.ts`（V1 store 保持不变，V2 并行实现）
- `app/api/**`（API 路由暂不改动，等 S1 完成后再对接）

### 环境变量
新增：
```env
DATABASE_URL="postgresql://user:password@host:5432/dbname"
ENABLE_V2_DATA_MODEL=false  # 灰度开关
```

## 测试策略

### 单元测试
- 仓储层 CRUD 操作（Vitest）
- 数据库约束验证（唯一性、外键、级联删除）
- 软删除行为测试

### 集成测试
- V1 → V2 迁移脚本（真实 localStorage 数据）
- 并发写入测试（幂等性验证）

### 性能测试
- 查询性能：500 条消息加载时间 < 200ms
- 写入性能：创建消息 + Run < 50ms

## 回滚方式

本 PR 只添加数据模型定义和仓储层，**不改动现有功能**：

- **代码回滚**：直接 revert PR
- **数据库回滚**：
  ```bash
  npx prisma migrate reset  # 清空数据库（仅开发环境）
  ```
- **影响**：V1 功能完全不受影响（V2 尚未启用）

## 后续阶段

- **S1 本阶段**：完成数据模型定义、迁移脚本、测试
- **S2（#20）**：实现 Model Gateway，对接 V2 数据模型
- **S3（#17）**：实现流式运行时，读写 V2 Run 状态
- **S4（#18）**：实现附件管线，写入 Artifact
- **S8**：正式启用 V2，执行数据迁移

## 未决项

| 未决项 | 说明 | 可选取值 |
|---|---|---|
| 数据库备份策略 | 多久备份一次，保留多久 | 每日/每周，保留 30 天 |
| Artifact 清理策略 | 孤儿对象何时删除 | 引用计数=0 后 7 天 |
| 是否使用 Redis | 缓存热点会话，减少数据库查询 | 使用/不使用（首版不用） |

## 参考文档

- [ADR-001：服务端为会话唯一事实源](./ADR.md#adr-001)
- [Prisma 文档](https://www.prisma.io/docs)
- [V2 总体开发计划](./MASTER_PLAN.md)
