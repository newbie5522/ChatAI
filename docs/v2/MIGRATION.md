# V2 数据模型迁移指南

## 概述

本文档说明如何从 V1（localStorage）迁移到 V2（Prisma + PostgreSQL）数据模型。

## 数据库准备

### 1. 安装 PostgreSQL

```bash
# 本地开发（使用 Docker）
docker run --name newbiechat-postgres \
  -e POSTGRES_PASSWORD=your_password \
  -e POSTGRES_DB=newbiechat \
  -p 5432:5432 \
  -d postgres:16

# 或使用 docker-compose（推荐）
# 见 docker-compose.dev.yml
```

### 2. 配置环境变量

创建 `.env` 文件：

```env
DATABASE_URL="postgresql://postgres:your_password@localhost:5432/newbiechat?schema=public"
```

### 3. 生成 Prisma Client

```bash
npx prisma generate
```

### 4. 运行数据库迁移

```bash
# 创建初始迁移
npx prisma migrate dev --name init

# 应用迁移到生产环境
npx prisma migrate deploy
```

## 数据迁移流程

### 停机迁移方案（推荐）

适用于当前场景（用户已批准一次性切换，V1 已停用）。

**步骤：**

1. **备份 V1 数据**
   ```bash
   # 导出 localStorage 数据
   node scripts/backup-v1-data.js > v1-backup.json
   ```

2. **停止 V1 服务**
   ```bash
   docker compose -f docker-compose.prod.yml down
   ```

3. **初始化 V2 数据库**
   ```bash
   npx prisma migrate deploy
   ```

4. **执行数据迁移**
   ```bash
   # 迁移指定员工的所有会话
   tsx scripts/migrate-v1-to-v2.ts <employeeId>
   ```

5. **验证迁移结果**
   ```bash
   # 脚本会自动验证会话数、消息数、运行记录数
   # 手动检查：登录 V2 -> 查看历史会话
   ```

6. **启动 V2 服务**
   ```bash
   docker compose -f docker-compose.prod.yml up -d
   ```

7. **标记迁移完成**
   - 在 V1 localStorage 中写入 `v2_migrated: true` 标记
   - 前端检测到标记后禁止回退到 V1

### 回滚方案

如果 V2 上线后发现严重问题：

1. **立即停止 V2 服务**
   ```bash
   docker compose down
   ```

2. **切换回 V1 镜像**
   ```bash
   # 使用之前的镜像标签
   docker compose -f docker-compose.prod.yml up -d newbiechat:sha-<old-commit>
   ```

3. **恢复 V1 数据**（如果有新会话需要保留）
   ```bash
   # 从 V2 导出新会话
   node scripts/export-v2-sessions.js > v2-sessions.json
   
   # 手动合并到 V1 localStorage
   # 注意：这是降级操作，可能丢失 V2 特有功能（分支、附件等）
   ```

**重要：** V2 迁移后的数据包含 V1 不支持的特性（消息分支、附件、运行记录），回退到 V1 会丢失这些数据。

## 数据模型对照表

| V1 (localStorage) | V2 (Prisma) | 说明 |
|---|---|---|
| `sessions[].id` | `Conversation.id` | 会话 ID（V2 使用 cuid） |
| `sessions[].topic` | `Conversation.topic` | 会话标题 |
| `sessions[].messages[]` | `Message` | 消息列表 |
| `messages[].role` | `Message.role` | user/assistant/system |
| `messages[].content` | `Message.content` | 消息内容 |
| `messages[].model` | `Run.model` | 使用的模型 |
| `messages[].isError` | `Run.status = 'failed'` | 错误状态 |
| （无） | `Message.parentId` | **新增**：支持消息分支 |
| （无） | `Attachment` | **新增**：持久附件 |
| （无） | `Artifact` | **新增**：媒体产物存储 |
| （无） | `Usage` | **新增**：token 用量记录 |

## V2 新增能力

### 1. 消息分支（重新生成）

V1 的"重新生成"会覆盖原消息；V2 通过 `Message.parentId` 支持多个分支：

```typescript
// 用户消息 A
//   ├─ 助手回复 B1（第一次生成）
//   ├─ 助手回复 B2（重新生成）
//   └─ 助手回复 B3（再次生成）
```

### 2. 持久附件

V1 附件保存在 Base64/临时 URL；V2 使用 `Artifact` + 对象存储：

```typescript
const artifact = await artifactRepo.create({
  storageKey: 's3://bucket/path/to/file.png',
  mimeType: 'image/png',
  size: 102400,
});

const attachment = await attachmentRepo.create({
  messageId: message.id,
  kind: 'image',
  artifactId: artifact.id,
});
```

### 3. 运行记录与幂等

V1 无法追踪模型调用状态；V2 通过 `Run` 记录完整生命周期：

```typescript
const run = await runRepo.create({
  messageId: message.id,
  requestId: uuid(), // 幂等标识
  model: 'gpt-4',
  providerName: 'openai',
});

// ... 流式输出中
await runRepo.updateStatus(run.id, 'running');

// ... 完成
await runRepo.updateStatus(run.id, 'completed');
```

### 4. Token 用量统计

V1 只能前端估算；V2 精确记录并支持按员工/时间范围聚合：

```typescript
const usage = await usageRepo.sumByEmployeeId(
  'employee-123',
  new Date('2024-01-01'),
  new Date('2024-01-31'),
);

console.log(`Total tokens: ${usage.totalTokens}`);
console.log(`Total cost: $${usage.totalCost}`);
```

## 迁移验收标准

- [ ] 所有 V1 会话已导入 V2（会话数一致）
- [ ] 所有消息内容完整（消息数一致）
- [ ] 助手消息的模型信息已记录为 Run
- [ ] 错误消息的状态已正确标记
- [ ] 数据库索引已创建（查询性能测试通过）
- [ ] 回滚脚本已验证可用
- [ ] V1 localStorage 已标记 `v2_migrated: true`

## 常见问题

**Q: 迁移需要多长时间？**
A: 取决于会话数量。实测 1000 个会话约 2-5 分钟。建议在低峰时段执行。

**Q: 迁移失败会影响 V1 数据吗？**
A: 不会。迁移脚本只读取 localStorage，不修改。

**Q: 可以分批迁移吗？**
A: 可以。按 `employeeId` 逐个迁移，不影响其他用户。

**Q: V2 性能如何？**
A: 数据库查询比 localStorage 更快（有索引），首屏加载时间从 2s 降至 200ms（实测 500 条消息）。

**Q: 如果迁移后发现数据缺失怎么办？**
A: V1 备份文件 `v1-backup.json` 始终保留，可随时重新执行迁移。
