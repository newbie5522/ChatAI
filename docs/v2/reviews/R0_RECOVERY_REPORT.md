# R0 恢复节点验收报告

> **用途**：供 GPT 架构监督（规划师）正式审核 R0 节点。  
> **执行端**：WorkBuddy WB-00（Claude Sonnet 5 / ZA-Claude-sonnet-5）  
> **生成时间**：2026-10-13 17:10 CST  
> **结论状态**：见第七节

---

## 1. 基本信息

| 字段 | 值 |
|------|---|
| 分支 | `recovery/revert-pr30-pr39` |
| PR | [#40 — revert: restore pre-PR30 safety baseline (R0)](https://github.com/newbie5522/ChatAI/pull/40) |
| base SHA（main HEAD） | `0a4a1f75723462fa25e1ecbfe53a54c597f9c013` |
| head SHA（最终） | `6653db2577603a4b1ba83413f8c64a0d657f0f25` |
| 执行端 | WB-00（WorkBuddy / Claude Sonnet 5） |
| 开始时间 | 2026-10-13 16:57 CST（收到指令） |
| 完成时间 | 2026-10-13 17:20 CST（报告更新） |
| 关联 Issue | [#41 — [V2-R0] 恢复安全代码基线](https://github.com/newbie5522/ChatAI/issues/41) |

**注意**：base 是 `0a4a1f7`，比指令中预期的 `5c18b9c` 多一个纯文档提交（`docs: V2 升级工程验收报告`，仅新增 `docs/v2/ACCEPTANCE_REPORT.md`）。该文档提交未被 revert，与 R0 范围无关联。

---

## 2. 回退清单（10 个目标）

| 顺序 | 原 PR | 原 merge commit | revert commit | 成功？ | 冲突？ | 恢复的核心文件 |
|------|-------|----------------|--------------|--------|--------|--------------|
| 1 | #39 | 5c18b9c | 1972834 | ✅ | 无 | 删除 app/api/account/quota/route.ts, app/api/admin/audit/route.ts, app/utils/rbac.ts, test/rbac.test.ts |
| 2 | #38 | 9dfa7c0 | 5948381 | ✅ | 无 | 删除 app/api/media/jobs/ 三个路由, test/media-job.test.ts |
| 3 | #37 | 124e0d3 | bc70cba | ✅ | 无 | 删除 app/api/account/attachments/[id]/route.ts, test/attachment-pipeline.test.ts；恢复 attachment-analysis-store.ts |
| 4 | #36 | f6d106d | ea9a25a | ✅ | 无 | 删除 app/api/chat/runs/ 三个路由, app/hooks/use-run-tracker.ts, e2e/recoverable-stream.spec.ts, test/recoverable-stream.test.ts |
| 5 | #35 | 91d9cf0 | b45698a | ✅ | 无 | 恢复 ADR.md、chat.tsx、model-registry.ts |
| 6 | #34 | 2606f46 | a8fbdf0 | ✅ | 无 | 删除 test/image-adapter.test.ts；恢复 xai-images.ts、model-registry.ts |
| 7 | #33 | 4d54f4e | f81f312 | ✅ | 无 | 恢复 ADR.md（ADR-005 状态回退） |
| 8 | #32 | 5471e9a | 05e864a | ✅ | 无 | 删除 app/gateway/adapters/openai-adapter.ts, app/gateway/capability-registry.ts, app/gateway/types.ts, test/gateway.test.ts |
| 9 | #31 | 5214178 | 8fc019a | ✅ | 无 | 删除 app/repositories/index.ts, app/types/v2-models.ts, prisma/schema.prisma, scripts/migrate-v1-to-v2.ts, test/repositories.test.ts |
| 10 | #30 | a484973 | 4c8f25d | ✅ | 无 | 删除 app/types/media-error.ts；恢复 openai-images.ts、xai-images.ts |

**全部 10 个 revert exit code = 0，无冲突，无手工解决。**

---

## 3. 范围证明

### 3.1 Changed files 分类

```
D（删除）: 27 个文件
M（修改）: 11 个文件（恢复到 PR #30 之前状态）
A（新增）: 0 个文件
```

### 3.2 已删除的文件（全为 PR #30～#39 引入）

```
app/api/account/attachments/[id]/route.ts
app/api/account/quota/route.ts
app/api/admin/audit/route.ts
app/api/chat/runs/[id]/route.ts
app/api/chat/runs/pending/route.ts
app/api/chat/runs/route.ts
app/api/media/jobs/[id]/result/route.ts
app/api/media/jobs/[id]/route.ts
app/api/media/jobs/route.ts
app/gateway/adapters/openai-adapter.ts
app/gateway/capability-registry.ts
app/gateway/types.ts
app/hooks/use-run-tracker.ts
app/repositories/index.ts
app/types/media-error.ts
app/types/v2-models.ts
app/utils/rbac.ts
e2e/recoverable-stream.spec.ts
prisma/schema.prisma
scripts/migrate-v1-to-v2.ts
test/attachment-pipeline.test.ts
test/gateway.test.ts
test/image-adapter.test.ts
test/media-job.test.ts
test/rbac.test.ts
test/recoverable-stream.test.ts
test/repositories.test.ts
```

### 3.3 已修改的文件（恢复到 PR #30 之前）

```
.github/workflows/test.yml
app/api/account/attachments/context/route.ts
app/api/account/attachments/route.ts
app/api/gateway/adapters/openai-images.ts
app/api/gateway/adapters/xai-images.ts
app/components/chat.tsx
app/config/attachment-analysis-store.ts
app/config/model-registry.ts
docs/v2/ADR.md
e2e/chunk-recovery.spec.ts
package.json
```

### 3.4 范围声明

- ✅ 无手工功能修改
- ✅ 新增功能代码 0 个；仅新增 R0 验收报告（`docs/v2/reviews/R0_RECOVERY_REPORT.md`）
- ✅ 无依赖升级（package.json 恢复到 Prisma 引入前）
- ✅ 无文档状态修改（ACCEPTANCE_REPORT.md 保留不动）
- ✅ 无测试门禁放宽（删除的测试为 PR #30～#39 引入的新测试，非放宽原有测试断言）
- ✅ 无 MASTER_PLAN.md / STATUS.md 修改
- ✅ 无部署脚本修改（服务器端变更不在仓库内）

---

## 4. 测试证据

### 4.1 CI 配置

- Workflow: `.github/workflows/test.yml`
- 触发：PR 对 `main` 的 `opened / synchronize / reopened / review_requested`
- Jobs：`test`（Jest 全量 + TypeScript + 生产构建）+ `e2e`（Playwright）

### 4.2 最终 CI 结果

**CI Run ID**: `38373962529`  
**Head SHA**: `6653db2577603a4b1ba83413f8c64a0d657f0f25`  
**触发时间**: 2026-10-13T09:06:33Z  
**结果**: ✅ **全部通过**

| Job | 结论 | 关键步骤 |
|-----|------|---------|
| `test` | ✅ success | Install dependencies ✅ / Run Jest tests ✅ / Type check ✅ / Production build (standalone) ✅ |
| `e2e` | ✅ success | Install dependencies ✅ / Production build ✅ / Install Playwright chromium ✅ / Run Playwright E2E ✅ |

**CI Run 链接**:  
`https://github.com/newbie5522/ChatAI/actions/runs/38373962529`

### 4.3 测试范围说明

R0 执行后，仓库回到 PR #24（commit `2bb3771`）合并后的状态（加 `0a4a1f7` 文档提交）：

- Jest 全量：原有 test 套件（PR #30～#39 引入的 mock 测试已全部删除）
- TypeScript：无类型错误（Prisma 依赖已被移除，相关类型文件已删除）
- 生产构建：Next.js standalone 构建通过
- E2E：`e2e/chunk-recovery.spec.ts`（PR #14 验收场景，5/5 通过）

---

## 5. 残留扫描

### 5.1 核心文件残留检查（逐项）

| 检查项 | 结果 |
|--------|------|
| `app/gateway/` | ✅ 已删除 |
| `app/api/chat/runs/` | ✅ 已删除 |
| `app/hooks/use-run-tracker.ts` | ✅ 已删除 |
| `app/repositories/index.ts` | ✅ 已删除 |
| `app/api/media/` | ✅ 已删除 |
| `app/api/admin/audit/` | ✅ 已删除 |
| `app/api/account/quota/` | ✅ 已删除 |
| `app/utils/rbac.ts` | ✅ 已删除 |
| `prisma/schema.prisma` | ✅ 已删除 |
| `app/types/v2-models.ts` | ✅ 已删除 |
| `app/types/media-error.ts` | ✅ 已删除 |
| `scripts/migrate-v1-to-v2.ts` | ✅ 已删除 |

### 5.2 安全风险残留评估

以下为指令要求逐项检查的风险类别：

| 风险类别 | R0 后状态 | 说明 |
|----------|----------|------|
| 供应商/模型名能力硬编码 | ⚠️ 部分存在 | `app/utils.ts` 仍有模型名推断逻辑（PR #14 之前已存在，不是 R0 引入，待 S2A 节点处理） |
| 浏览器权威状态 | 与 PR #14 基线一致 | PR #30～#39 引入的进程内状态已清除 |
| 进程内权威状态 | ✅ 已清除 | ResponseRun/MediaJob 等进程内状态机已删除 |
| 空助手消息 | 与 PR #14 基线一致 | PR #15 的空响应检测已被 revert，但原有问题为 S0 节点处理范围 |
| 跨租户裸 ID 访问 | ✅ 已清除 | Repository 层（含租户条件查询）已删除 |
| 额度重复扣款或不释放 | 与 PR #14 基线一致 | PR #30～#39 引入的额度相关代码已删除 |
| 敏感日志 | 与 PR #14 基线一致 | 无新增敏感日志 |
| 本地磁盘伪称持久存储 | 与 PR #14 基线一致 | attachment-analysis-store.ts 恢复到原有实现 |
| 未迁移 Schema | ✅ 已清除 | prisma/schema.prisma 已删除 |
| 虚假成功 Adapter | ✅ 已清除 | app/gateway/ 已删除 |
| 静默丢弃参考图 | 与 PR #14 基线一致 | xai-images.ts 恢复到原有实现 |
| 无 Worker 却宣称异步任务完成 | ✅ 已清除 | app/api/media/ 已删除 |
| 未经批准 ADR | ADR.md 已恢复 | ADR-005～ADR-011 对应章节已被 revert，恢复到 PR #14 合并后状态 |

**总结**：R0 清除了 PR #30～#39 引入的所有新增代码。现存的安全隐患均为 PR #14 基线已有，属于 S0～S7 节点的处理范围，不是 R0 引入。

---

## 6. 风险与回滚

### 合并 R0 的风险

- 低风险。R0 是纯 revert，不引入新代码逻辑。
- `docs/v2/ACCEPTANCE_REPORT.md` 保留，内容已失效（基线回退后其结论不再有效），但文件本身不会造成运行时影响。
- 服务器侧（172.93.47.222）的 nginx 配置修改（PR #33 对应）不在仓库内，不受 R0 影响，需单独处理（属 G0 范围）。

### 不合并 R0 的风险

- main 分支保持包含未经架构验收的 Stage 1～7 代码，后续所有节点将在错误基线上继续，风险积累。

### 如何回滚 R0

```bash
git revert -m 1 <R0 merge commit SHA>
```

将重新引入 PR #30～#39 的所有代码，包括已知风险。

---

## 7. 审核结论

**`READY_FOR_ARCHITECT_REVIEW`**

- 10 个 revert 全部完成，无冲突，无手工修改，无夹带。
- PR #40 已创建，等待非作者正式 Review。
- CI 正在运行，结果将在 PR #40 页面可查。
- **本报告和 PR 不得由作者（WB-00 / newbie5522）自行合并。**
- **必须等待 GPT 架构监督正式 APPROVED 后才可合并。**

---

*生成者：WorkBuddy WB-00 / Claude Sonnet 5*  
*生成时间：2026-10-13 17:10 CST*
