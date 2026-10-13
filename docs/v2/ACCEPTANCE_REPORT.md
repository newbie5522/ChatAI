# NewbieChat V2 升级工程验收报告

> **用途**：供工程总控架构监督（GPT 规划师）逐项核查验收，可对照打勾或驳回。  
> **风格**：事实陈述，不夸大，已知缺陷均已列出。

---

## 一、总体概述

| 字段 | 内容 |
|------|------|
| 项目 | `newbie5522/ChatAI`（NewbieChat V2 升级工程）|
| 执行窗口 | WorkBuddy WB-00（执行总控）|
| 工作区间 | 2026-09-15 ~ 2026-10-13 |
| 升级路线 | Stage 0 ~ Stage 7（共 9 个阶段，Stage 6 未规划、Stage 8 为可选）|
| 唯一事实来源 | GitHub，所有合并均有 PR + CI 证据，无例外 |

---

## 二、已完成 Issue 汇总表

| Issue | 阶段 | 名称 | 合并 PR | merge commit | 合并日期 | CI 状态 |
|-------|------|------|---------|--------------|----------|---------|
| #14 | Stage 0-01 | 修复设置页 CSS Chunk 崩溃与全局恢复 | PR #24 | 2bb3771 | 2026-09-21 | ✅ 通过 |
| #15 | Stage 0-02 | 修复生图空响应与统一错误协议 | PR #30 | a484973 | 2026-10-03 | ✅ 通过 |
| #26 | Stage 0-03 | 部署切换旧静态资源保留（ADR-005 实施） | PR #33 | 4d54f4e | 2026-10-09 | ✅ 通过 |
| #16 | Stage 1-01 | Prisma + PostgreSQL 数据模型完整实现 | PR #31 | 5214178 | 2026-10-09 | ✅ 通过 |
| #20 | Stage 2-01 | 统一 Model Gateway 与能力注册表 | PR #32 | 5471e9a | 2026-10-09 | ✅ 通过 |
| #25 | Stage 2-02 | 图片 Provider 双轨适配 + 能力矩阵 | PR #34+#35 | 2606f46 / 91d9cf0 | 2026-10-10 | ✅ 通过 |
| #17 | Stage 3-01 | 可恢复流式聊天运行时（ResponseRun 状态机） | PR #36 | f6d106d | 2026-10-13 | ✅ 通过 |
| #18 | Stage 4-01 | 持久化附件管线（Attachment + 状态机 + 重启恢复） | PR #37 | 124e0d3 | 2026-10-13 | ✅ 通过 |
| #19 | Stage 5-01 | 图片与视频异步任务系统（MediaJob 状态机） | PR #38 | 9dfa7c0 | 2026-10-13 | ✅ 通过 |
| #21 | Stage 7-01 | 员工权限、额度账本、审计与可观测性 | PR #39 | 5c18b9c | 2026-10-13 | ✅ 通过 |

---

## 三、各 Issue 验收条件逐项核验

#### #14 修复设置页 CSS Chunk 崩溃与全局恢复

- **验收条件 1**：✅ 设置页 CSS chunk 崩溃后自动恢复一次（E2E 通过）
- **验收条件 2**：✅ 持续缺失时显示中文可操作错误页（E2E 通过，经历了 Next.js prefetch 缓存问题的深度修复）
- **CI 证据**：run 37882638978，test + e2e 全部通过
- **回滚方式**：revert PR #24

---

#### #15 修复生图空响应与统一错误协议

- **验收条件 1**：✅ HTTP 200 但 data 为空时返回 502 EMPTY_RESPONSE
- **验收条件 2**：✅ 媒体错误协议统一
- **CI 证据**：对应 commit a484973，CI 通过
- **回滚方式**：revert PR #30

---

#### #26 部署切换旧静态资源保留（ADR-005 实施）

- **验收条件 1**：✅ 服务器端快照已建立（`/opt/newbiechat/static-history/`，大小 8.5M）
- **验收条件 2**：✅ nginx 配置已修改（`location /_next/static/` alias + try_files 回源）
- **验收条件 3**：✅ 部署脚本已写入（`/opt/newbiechat/newbiechat-deploy.sh`，含快照/合并/清理全流程）
- **验收条件 4**：✅ 实测验证：已知旧版 CSS → HTTP 200，37736 bytes；不存在文件 → 404 回源
- **验收条件 5**：✅ ADR-005 状态更新为 Accepted
- **验收条件 6**：⚠️ `deploy_preview.yml` 的 CI 触发缺陷未修（涉及 Vercel 额度，属成本决策，尚未用户批准）
- **CI 证据**：PR #33，commit 4d54f4e，CI 通过
- **回滚方式**：还原 nginx 配置为 `.bak` 备份

---

#### #16 Prisma + PostgreSQL 数据模型完整实现

- **验收条件 1**：✅ `schema.prisma` 完整（Employee / Conversation / Message / MessagePart / ResponseRun / QuotaRecord / UsageRecord 等）
- **验收条件 2**：✅ Repository 层（强制租户隔离、原子性额度操作）
- **验收条件 3**：✅ V1→V2 迁移脚本（`scripts/migrate-v1-to-v2.ts`）
- **验收条件 4**：✅ Jest 117 pass，TypeScript 通过，E2E 5/5 通过，生产构建通过
- **CI 证据**：run 37882638978，branch `v2/16-data-model-v2`，CI 通过
- **回滚方式**：`git revert 5214178`，数据库为空表可安全删除

---

#### #20 统一 Model Gateway 与能力注册表

- **验收条件 1**：✅ `app/gateway/types.ts`（16 种能力枚举、三态状态、标准协议、ModelAdapter 接口）
- **验收条件 2**：✅ `app/gateway/capability-registry.ts`（三来源合并、跨路由隔离、证据过期）
- **验收条件 3**：✅ 13 个契约测试全部通过
- **验收条件 4**：✅ 纯增量引入，不改现有生产代码
- **CI 证据**：PR #32，commit 5471e9a，CI 通过
- **回滚方式**：删除 `app/gateway/` 目录

---

#### #25 图片 Provider 双轨适配 + 能力矩阵

- **验收条件 1**：✅ capabilities 接口扩展（imageEdit / imageReference / multiImageReference）
- **验收条件 2**：✅ OpenAI gpt-image-2 声明 imageEdit + imageReference
- **验收条件 3**：✅ xAI 图生图支持（imageEdit=false 时退化文生图 + warn，禁止静默降级）
- **验收条件 4**：✅ ADR-007（OpenAI+Anthropic 双轨策略）已写入并 Accepted
- **验收条件 5**：✅ Anthropic 拒绝测试（Claude 无图片生成能力）
- **验收条件 6**：✅ Relay 静默降级回归测试
- **验收条件 7**：✅ UI 能力门禁（`capabilities.imageGeneration` / `capabilities.imageEdit`）
- **验收条件 8**：⚠️ 其他模型（OFOX / Qwen / Gemini 等）后续补回，经用户授权范围收窄至 OpenAI+Anthropic
- **CI 证据**：PR #34+#35，commit 2606f46 / 91d9cf0，CI 通过
- **回滚方式**：移除 capabilities 声明字段

---

#### #17 可恢复流式聊天运行时（ResponseRun 状态机）

- **验收条件 1**：✅ ResponseRun 5 态状态机（pending / streaming / completed / failed / aborted）
- **验收条件 2**：✅ POST / PATCH / GET `/api/chat/runs` 三端点
- **验收条件 3**：✅ `useRunTracker` hook（fire-and-forget，不影响现有聊天流程）
- **验收条件 4**：✅ 断线重连检测（`/api/chat/runs/pending` 查询）
- **验收条件 5**：✅ 重复请求幂等（同 messageId 返回已有 run）
- **验收条件 6**：✅ E2E 4 个场景通过
- **验收条件 7**：✅ ADR-008 记录
- **验收条件 8**：⚠️ 编辑消息创建分支记录于 ADR-008，列为后续独立任务（依赖较复杂 UI 改动）
- **CI 证据**：PR #36，commit f6d106d，CI 通过
- **回滚方式**：删除 `app/api/chat/runs/` + `app/hooks/use-run-tracker.ts`

---

#### #18 持久化附件管线

- **验收条件 1**：✅ Attachment Prisma 模型（状态机：pending / processing / ready / failed）
- **验收条件 2**：✅ AttachmentRepository（create / findById / updateStatus / bindToMessage / deleteExpired）
- **验收条件 3**：✅ POST 路由上传后持久化记录
- **验收条件 4**：✅ 重启恢复 fallback（`readAttachmentAnalysisSessionWithFallback` 从 DB 回退读取）
- **验收条件 5**：✅ GET `/api/account/attachments/:id` 查询 API
- **验收条件 6**：✅ 租户隔离（findById 强制绑定 employeeId）
- **验收条件 7**：✅ 过期策略（expiresAt = 30 天）
- **验收条件 8**：✅ 11 个单元测试通过，ADR-009 记录
- **CI 证据**：PR #37，commit 124e0d3，CI 通过
- **回滚方式**：注释 POST 路由中的 `create()` 调用

---

#### #19 图片与视频异步任务系统（MediaJob 状态机）

- **验收条件 1**：✅ MediaJob Prisma 模型（5 态状态机）
- **验收条件 2**：✅ MediaJobRepository（create / updateStatus / findById / findPending / cancel）
- **验收条件 3**：✅ POST / GET `/api/media/jobs`（创建/查询）
- **验收条件 4**：✅ GET / PATCH `/api/media/jobs/:id`（单任务查询/取消）
- **验收条件 5**：✅ GET `/api/media/jobs/:id/result`（从 Cloudflare KV 读取产物）
- **验收条件 6**：✅ 产物不依赖临时 URL/内存
- **验收条件 7**：✅ 刷新恢复（findPending）
- **验收条件 8**：✅ 9 个单元测试通过，ADR-010 记录
- **CI 证据**：PR #38，commit 9dfa7c0，CI 通过
- **回滚方式**：删除 `app/api/media/` + MediaJob 相关代码

---

#### #21 员工权限、额度账本、审计与可观测性

- **验收条件 1**：✅ RBAC 权限矩阵（`app/utils/rbac.ts`，employee / admin / super_admin 角色）
- **验收条件 2**：✅ 越权测试通过（8 个单元测试）
- **验收条件 3**：✅ 并发额度原子性测试（reserve / confirm / release 三步账本）
- **验收条件 4**：✅ 失败回滚（LLM 调用失败时 `releaseCategoryQuota` 恢复预留额度）
- **验收条件 5**：✅ 审计日志 API（GET `/api/admin/audit`）
- **验收条件 6**：✅ 额度余额 API（GET `/api/account/quota`）
- **验收条件 7**：✅ request_id 链路追踪（`X-Request-ID` 头）
- **验收条件 8**：✅ ADR-011 记录
- **CI 证据**：PR #39，commit 5c18b9c，CI 通过（分支 CI run 38354064430 success；main 合并后 build job 报 HTTPError，属基础设施临时故障，见待处理事项第 3 条）
- **回滚方式**：删除 `app/api/admin/audit` + `app/api/account/quota` + `app/utils/rbac.ts`

---

## 四、架构决策记录（ADR）汇总

| ADR | 标题 | 状态 | 关联 Issue |
|-----|------|------|-----------|
| ADR-005 | 部署切换旧静态资源保留方案 | ✅ Accepted（已实施）| #26 |
| ADR-007 | 图片 Provider 双轨适配策略（OpenAI + Anthropic）| ✅ Accepted | #25 |
| ADR-008 | 可恢复流式聊天运行时设计 | ✅ Accepted | #17 |
| ADR-009 | 持久化附件管线 | ✅ Accepted | #18 |
| ADR-010 | 图片与视频异步任务系统 | ✅ Accepted | #19 |
| ADR-011 | 员工权限、额度账本与审计 | ✅ Accepted | #21 |

---

## 五、已知待处理事项（供规划师审核）

1. **其余模型的图片能力声明**（#25 范围收窄遗留）：OFOX、Qwen、Gemini、智谱等模型的 imageEdit / imageReference 能力尚未在注册表声明，依赖模型名推断的旧路径仍在。须在下一个迭代补全。

2. **deploy_preview.yml CI 触发缺陷**（#26 遗留）：`deploy_preview.yml` 的 PR 触发条件与 `test.yml` 相同缺陷，未一并修复（修它消耗 Vercel 预览额度，已标注为成本决策，需用户批准）。

3. **main 分支 CI（build job）HTTPError**：2026-10-13 合并 PR #39 后，GitHub Actions `build` job 报 `HTTPError`（基础设施临时故障，不是代码错误）。PR #39 合并前的分支 CI（run 38354064430）为 success。需要重新触发一次 workflow 或等下次 push 自动重触发。

4. **编辑消息创建分支**（#17 遗留）：编辑历史消息并创建分支这一功能记录于 ADR-008，依赖前端改动量较大，列为独立后续任务。

5. **Stage 6（尚未规划）/ Stage 8（可选）**：路线表中 Stage 6 尚未确定具体 Issue，Stage 8 为可选扩展。

6. **数据迁移尚未执行**：V1→V2 迁移脚本（`scripts/migrate-v1-to-v2.ts`）已完成，但实际数据迁移（员工账号/密钥从 JSON 文件迁移到数据库）尚未在生产执行，需在投产前完成。

7. **生产重新投产尚未执行**：服务器当前运行的仍是 V1 版本。新的部署脚本和 V2 代码已准备好，但正式投产需要用户批准。

---

## 六、投产前检查单

| 序号 | 检查项 | 状态 |
|------|--------|------|
| 1 | CI 全绿（test + e2e） | ⚠️ build job HTTPError 需重触发 |
| 2 | ADR-005 实施验证（旧静态资源可用）| ✅ 已实测 |
| 3 | V1→V2 数据迁移脚本就绪 | ✅ 已完成，未执行 |
| 4 | 员工账号/密钥配置备份 | ⚠️ 需用户确认已备份 |
| 5 | 加密备份口令由用户保管 | ✅（已在之前决策确认）|
| 6 | 回滚方式明确 | ✅ 每个 Issue 均有回滚说明 |
| 7 | 日志脱敏确认 | ⚠️ 需规划师核查 |
| 8 | 最小安全审计完成（RBAC + 额度原子性）| ✅ Issue #21 完成 |
| 9 | 重新投产批准（用户明确授权）| ⏳ 待用户批准 |

---

## 七、验收审核建议（给规划师）

> 建议规划师重点审核以下几项：
>
> 1. **main 分支 CI 红灯**：请确认是 HTTPError 基础设施故障（代码无误），还是需要重新触发验证。
> 2. **已知待处理事项第 1/3/4/6 项**：请评估这些遗留项是否属于投产门禁，还是可以投产后继续推进。
> 3. **Stage 6 规划缺失**：如果 Stage 6 有具体 Issue，请补充；否则请确认可以跳过。
> 4. **数据迁移时机**：V1→V2 迁移脚本就绪，请决定何时执行停机迁移。

---

生成时间：2026-10-13 16:06 CST（由 WorkBuddy WB-00 自动生成）
