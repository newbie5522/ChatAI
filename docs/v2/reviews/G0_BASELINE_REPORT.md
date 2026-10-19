# G0 基线校准报告

> **用途**：供 GPT 架构监督审核 G0 节点，确认当前 main 代码状态与文档状态对齐。
> **执行端**：WorkBuddy WB-00（Claude Sonnet 5）
> **生成时间**：2026-10-19 17:10 CST
> **分支**：`governance/g0-baseline-calibration`
> **关联 Issue**：Refs #41

---

## 1. 当前 main SHA

**main HEAD**：`c1db2bb2686a908bc6f1a080d7379bc5e354acfd`

```
c1db2bb revert: restore pre-PR30 safety baseline (R0) (#40)
eec7d8d docs(R0): update R0 report with final CI results and ACCEPTANCE_REPORT denial notice
6653db2 docs(R0): add R0 recovery acceptance report
4c8f25d Revert "fix(#15): 统一媒体错误协议，拒绝HTTP 200但无有效内容的响应"
8fc019a Revert "feat(#16): V2 服务端数据模型完整实现"
```

---

## 2. PR #40 合并证据及 CI 结果

| 字段 | 值 |
|------|---|
| PR | #40 — revert: restore pre-PR30 safety baseline (R0) |
| merge commit SHA | `c1db2bb2686a908bc6f1a080d7379bc5e354acfd` |
| 合并时间 | 2026-10-13T09:55:48Z |
| 合并者 | newbie5522 |

**合并后 main CI**（commit `c1db2bb2`）：

| Run ID | Job | 结论 |
|--------|-----|------|
| 38379828300 | test（Jest + TypeScript + Production build）| ✅ success |
| 38379828300 | e2e（Playwright）| ✅ success |
| 38379828233 | docker | ✅ success |

---

## 3. PR #40 流程违规记录

**违规事实**：PR #40 合并时 Reviews 字段为空（无任何正式 Review 记录），合并者为 newbie5522（即 WB-00 操作账号），属于作者自行合并。

**裁决结论**（来自架构监督）：
- 该违规记录为"历史流程违规"
- 不要求仅因缺少 Review 再次回退 PR #40
- 从 G0 起，任何阶段 PR 不得由作者自行验收并合并，必须等待非作者正式审核

---

## 4. Stage 0～8 当前真实状态

| Stage | Issue | 原 PR | 当前代码状态 | GitHub Issue 状态 | G0 处理 |
|-------|-------|-------|-------------|------------------|---------|
| S0-01 | #14 | PR #24 | **代码在 main**，chunk-recovery + 错误页完整 | CLOSED（原始关闭，2026-09-21）| 保持 CLOSED，这是 R0 后唯一合法 DONE |
| S0-02 | #15 | PR #30（已撤销）| **代码已删除**，media-error.ts 不存在 | CLOSED（2026-09-22，错误关闭）| **已重新打开** |
| S0-03 | #26 | PR #33（已撤销）| **代码已回退**，ADR-005 恢复为 Proposed | CLOSED（2026-10-09，错误关闭）| **已重新打开** |
| S1-01 | #16 | PR #31（已撤销）| **代码已删除**，prisma/schema.prisma 不存在 | CLOSED（2026-10-09，错误关闭）| **已重新打开** |
| S2-01 | #20 | PR #32（已撤销）| **代码已删除**，app/gateway/ 不存在 | CLOSED（2026-10-09，错误关闭）| **已重新打开** |
| S2-02 | #25 | PR #34+#35（已撤销）| **代码已删除**，capabilities 扩展不存在 | CLOSED（2026-10-10，错误关闭）| **已重新打开** |
| S3-01 | #17 | PR #36（已撤销）| **代码已删除**，ResponseRun API 不存在 | CLOSED（2026-10-13，错误关闭）| **已重新打开** |
| S4-01 | #18 | PR #37（已撤销）| **代码已删除**，Attachment 模型不存在 | CLOSED（2026-10-13，错误关闭）| **已重新打开** |
| S5-01 | #19 | PR #38（已撤销）| **代码已删除**，MediaJob 模型不存在 | CLOSED（2026-10-13，错误关闭）| **已重新打开** |
| S7-01 | #21 | PR #39（已撤销）| **代码已删除**，RBAC/审计/额度 API 不存在 | CLOSED（2026-10-13，错误关闭）| **已重新打开** |
| S6 | 待拆 | 无 | 未规划 | 无 Issue | 不处理 |
| S8 | 待拆 | 无 | 未规划 | 无 Issue | 不处理 |

---

## 5. 各 Issue 状态及处理建议

| Issue | 标题 | G0 处理动作 | 建议下一步 |
|-------|------|------------|----------|
| #14 | CSS Chunk 崩溃与全局恢复 | 保持 CLOSED | S0-01 已完成。S0 门禁通过后可进入 S1。 |
| #15 | 生图空响应与统一错误协议 | **重新打开** | 在 main 当前基线上重新实现，须覆盖真实 Provider 线路测试，不得用 mock 代替。 |
| #16 | Conversation/Message/Run 数据模型 | **重新打开** | 等 S0（#15）通过后才可进入实现。须有真实 PostgreSQL migration、dry-run、回滚演练。 |
| #17 | 可恢复流式聊天运行时 | **重新打开** | 等 S1（#16）通过后才可进入实现。须真实接入发送主流程，不得用手工 fetch 代替 E2E。 |
| #18 | 持久附件管线 | **重新打开** | 等 S1（#16）通过后。内容必须进对象存储，数据库只存 key。 |
| #19 | 图片与视频异步任务系统 | **重新打开** | 等 S2（#20）通过后。必须有真正队列和 Worker，不得用同步 API 调用假装异步。 |
| #20 | 统一 Model Gateway | **重新打开** | 等 S1（#16）通过后。能力注册必须持久化，不得按模型名猜能力。 |
| #21 | 员工权限、额度账本、审计 | **重新打开** | 等 S2（#20）通过后。须真实 RBAC 接入路由，真实并发额度测试。 |
| #25 | 图片 Provider 双轨适配 | **重新打开** | 等 S2A（#20）通过后。须真实 Provider 或可审计 sandbox 测试，不得静默丢弃图片。 |
| #26 | 部署切换旧静态资源保留 | **重新打开** | 等 S0（#15）通过后。须有服务器实测证据才可将 ADR-005 改为 Accepted。 |
| #41 | V2-R0 恢复安全代码基线 | 保持 OPEN | G0 完成后关闭；先等架构监督验收 G0。 |

---

## 6. 当前代码中的风险清单

### 6.1 浏览器持久状态（localStorage / IndexedDB）

main 中存在大量以 localStorage 为会话唯一事实源的代码：

| 文件 | 用途 | 风险 |
|------|------|------|
| `app/store/chat.ts` | 聊天记录（Conversation、Message）| 与 ADR-001（服务端为唯一事实源）直接冲突；无法多端同步，刷新丢失风险 |
| `app/utils/indexedDB-storage.ts` | 数据持久化兜底 | 仍以浏览器存储为主要路径 |
| `app/components/chat.tsx` | 输入草稿 | 低风险（草稿），但结构上仍依赖浏览器 |
| `app/utils/chunk-recovery.ts` | chunk 恢复计数器 | 使用 sessionStorage（#14 实现），属于视图状态，可接受 |

**结论**：`chat.ts` 的 localStorage 会话是 S1 前的临时状态，需要在 #16 实现服务端模型后迁移。不得在 S1 之前把更多业务状态写入 localStorage。

### 6.2 进程内状态

额度相关处理在 `app/config/usage.ts` 中，通过进程内 Map 维护 requestId → 预留记录：

```
app/config/usage.ts  →  reserveCategoryQuota / confirmCategoryQuota / releaseCategoryQuota
```

**风险**：多实例部署时额度状态不一致；进程重启后预留记录丢失可能导致额度不释放。属于 S7（#21）的修复范围。

`app/api/gateway/[provider]/[[...path]]/route.ts` 调用了 reserve/confirm/release，当前实现为进程内 Map，不是数据库事务。

### 6.3 空助手消息风险

`app/components/chat.tsx:1323` 存在 `message: "empty response"` 的处理路径：

```typescript
// chat.tsx:1323
message: "empty response",
```

`app/utils/chat.ts:278` 和 `:496` 也有 `"empty response from server"` 的错误回调。

**风险**：当前实现在收到空响应时会创建包含 `"empty response"` 的助手消息并落入 localStorage，但不会创建真实的服务端错误记录。这是 #15 需要解决的问题。

### 6.4 额度一致性风险

- 额度 reserve/confirm/release 均在进程内 Map（`usage.ts`），多实例时无原子性保障
- gateway route 中有多个 `await releaseCategoryQuota` 调用路径（9 处），但依赖同一进程内 Map
- 无数据库事务保障；进程崩溃时预留不会自动释放
- **结论**：S7（#21）必须改为数据库事务实现，不可绕过

### 6.5 租户隔离风险

- 当前 gateway route 从 `requireAccount(req)` 获取账号，后续查询中基本依赖该账号 ID 过滤
- `app/config/admin-store.ts` 中有 `employeeId` 字段的使用
- **已删除的 repositories/index.ts** 中曾有强制租户条件，R0 后该层已不存在
- **结论**：S1（#16）重新实现 Repository 层时，必须在每个查询中强制附加 employeeId 条件，不得存在裸 ID 查询路径

### 6.6 供应商能力硬编码

`app/config/server.ts:174` 存在：
```typescript
const isXAI = !!process.env.XAI_API_KEY;
```

多处文件（`app/client/platforms/*.ts`、`app/utils/model.ts`、`app/config/model-registry.ts` 等）存在 `provider === "xxx"` 的硬编码能力判断。

**结论**：这是 S2（#20）需要解决的核心问题。在 Model Gateway 建立之前，供应商名称判断是唯一可用路径，但不得在 S2 后继续存在。

### 6.7 数据库、迁移、回滚、并发、E2E 证据缺失

R0 后：
- `prisma/schema.prisma` **不存在**
- `scripts/migrate-v1-to-v2.ts` **不存在**
- `app/repositories/index.ts` **不存在**
- `test/repositories.test.ts` **不存在**

**结论**：S1（#16）需要从零重新实现以上内容，且必须有真实 PostgreSQL migration 文件（非 Prisma 生成产物）、dry-run 证据、回滚演练、并发测试和 E2E 证据。

---

## 7. ADR-005 状态核对

**仓库状态**（docs/v2/ADR.md）：`Proposed`（PR #33 被 R0 撤销后恢复）

**服务器实际状态**：`UNKNOWN`

- 根据 R0 前的执行记录（R0_RECOVERY_REPORT.md），曾于 2026-10-09 在服务器 172.93.47.222 执行了：
  - nginx 配置修改（新增 `/_next/static/` alias + try_files）
  - 快照目录创建（`/opt/newbiechat/static-history/`）
  - 部署脚本写入（`/opt/newbiechat/newbiechat-deploy.sh`）
- 但 R0 仅撤销了**仓库代码变更**，服务器侧的 nginx 配置和目录**未被回退**
- 本轮（G0）不得修改生产服务器
- **没有本轮实测证据，服务器实际状态标记为 UNKNOWN**

**G0 处置**：ADR-005 保持 `Proposed`，仓库记录与服务器实际状态之间存在潜在不一致，需要在 S0（#26）节点通过实测验证后才可更新。

---

## 8. S0 明确范围、验收条件和预计影响文件

### S0-01（#14）已完成，无需重做

验收证据：PR #24，CI run 37882638978，E2E 5/5 通过。

### S0-02（#15）— 下一个要做的 Issue

**目标**：统一媒体错误协议，HTTP 200 但 body/data 为空时不创建空助手消息，失败时自动释放已预留额度，错误日志脱敏。

**验收条件**：
- [ ] 真实 OpenAI 官方线路和 Relay 均有独立测试
- [ ] HTTP 200 + 空 data 不会创建助手消息，而是展示明确错误
- [ ] 失败路径自动调用 releaseCategoryQuota
- [ ] 错误日志不泄露 API Key 或用户输入
- [ ] UI/E2E 验证用户看到明确中文错误提示
- [ ] Jest + TypeScript + 生产构建 + E2E 全通过
- [ ] 非作者正式 APPROVED Review

**预计影响文件**：
- `app/api/gateway/adapters/openai-images.ts`（主要修改点）
- `app/api/gateway/adapters/xai-images.ts`
- `app/components/chat.tsx`（避免创建空消息的处理逻辑）
- `app/utils/chat.ts`（error 回调处理）
- 新增：`app/types/media-error.ts`（统一错误类型）
- 新增：对应测试文件

### S0-03（#26）— S0-02 通过后才可开始

**目标**：验证并实施 ADR-005（旧静态资源保留）。须有服务器实测证据。

**验收条件**：
- [ ] 服务器 nginx 配置实测验证（curl 返回 200）
- [ ] 快照目录存在且内容正确
- [ ] 部署脚本可执行并有测试记录
- [ ] ADR-005 改为 Accepted 须基于实测，不得基于文字声明
- [ ] 本轮不得修改服务器

---

## 9. G0 变更文件清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `docs/v2/STATUS.md` | M（修改）| 全面重写，反映 main 当前真实状态 |
| `docs/v2/reviews/G0_BASELINE_REPORT.md` | A（新增）| 本报告 |

**无功能代码修改，无数据库变更，无服务器变更，无 ADR 状态修改。**

---

## 10. 下一步唯一动作

**等待 GPT 架构监督验收 G0（本 PR）。**

未收到明确 PASS 后，下一步唯一动作为：**重新打开 #15（生图空响应/错误协议），按 S0-02 验收条件重新实现。**

不得：
- 自行合并本 PR
- 开始 S0 的任何实现
- 修改服务器或部署配置
- 修改功能代码

---

## 11. 审核结论

**`READY_FOR_ARCHITECT_REVIEW`**

---

*生成者：WB-00 / Claude Sonnet 5*
*生成时间：2026-10-19 17:10 CST*
