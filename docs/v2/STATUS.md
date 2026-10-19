# V2 实时状态板

最后更新：2026-10-19 G0 基线校准

> R0 已完成（PR #40 合并，merge commit `c1db2bb`），PR #30～#39 全部逆序撤销。
> main 已恢复到 PR #30 之前的安全基线（+ R0 验收报告 + ACCEPTANCE_REPORT 否决标注）。
> 本状态板反映 main 当前真实代码状态，不再保留已被撤销的 DONE 标记。

## R0 恢复节点

| 工作项 | 状态 | 说明 |
|---|---|---|
| R0 安全基线恢复 | DONE（流程违规已记录）| PR #40 已合并，10 个 revert 无冲突，CI 全绿。无非作者正式 Review，合并者为 newbie5522（作者自行合并），记录为历史流程违规。 |

## Stage 状态（以 main 当前代码为准）

| 阶段 | Issue | 状态 | 说明 |
|---|---|---|---|
| S0-01 | #14 | DONE | PR #24 代码仍在 main，chunk-recovery + 错误页 E2E 通过。R0 后唯一保持 DONE 的 V2 Issue。 |
| S0-02 | #15 | REVERTED — 等待重做 | PR #30 已被 R0 撤销。media-error.ts 已删除，空响应检测回退。Issue 已重新打开。 |
| S0-03 | #26 | REVERTED — 等待重做 | PR #33 已被 R0 撤销。ADR-005 恢复为 Proposed。服务器侧 nginx 变更状态未知。Issue 已重新打开。 |
| S1-01 | #16 | REVERTED — 等待重做 | PR #31 已被 R0 撤销。prisma/schema.prisma、repositories、迁移脚本全部删除。Issue 已重新打开。 |
| S2-01 | #20 | REVERTED — 等待重做 | PR #32 已被 R0 撤销。app/gateway/ 目录已删除。Issue 已重新打开。 |
| S2-02 | #25 | REVERTED — 等待重做 | PR #34+#35 已被 R0 撤销。capabilities 扩展、xAI 图生图、契约测试全部删除。Issue 已重新打开。 |
| S3-01 | #17 | REVERTED — 等待重做 | PR #36 已被 R0 撤销。ResponseRun API、hook、E2E 全部删除。Issue 已重新打开。 |
| S4-01 | #18 | REVERTED — 等待重做 | PR #37 已被 R0 撤销。Attachment 模型、Repository、持久化逻辑全部删除。Issue 已重新打开。 |
| S5-01 | #19 | REVERTED — 等待重做 | PR #38 已被 R0 撤销。MediaJob 模型、API、测试全部删除。Issue 已重新打开。 |
| S7-01 | #21 | REVERTED — 等待重做 | PR #39 已被 R0 撤销。RBAC、审计 API、额度余额 API 全部删除。Issue 已重新打开。 |
| S6 | 待拆分 | NOT_STARTED | 尚未规划具体 Issue。 |
| S8 | 待拆分 | NOT_STARTED | 尚未规划具体 Issue。 |

## 执行顺序（G0 后）

1. S0：先完成 #15（空响应/错误协议）和 #26（部署一致性），通过后才进入 S1
2. S1：#16 数据库模型，通过后才进入 S2
3. S2：#20 Model Gateway → #25 图片双轨
4. S3：#17 流式运行时
5. S4：#18 附件管线
6. S5：#19 异步媒体
7. S6：上下文与记忆（待拆分）
8. S7：#21 权限/额度/审计
9. S8：灰度迁移与发布（待拆分）

不得同时重启 #16～#21 的实现。不得将状态放入浏览器 localStorage 或进程内存作为临时捷径。

## 状态枚举

`READY` / `IN_PROGRESS` / `IN_REVIEW` / `BLOCKED` / `DONE` / `PAUSED` / `DESIGN-ONLY` / `REVERTED` / `NOT_STARTED`

## 总控规则

- 开始或结束任务时同步更新本表。
- Issue 与本表冲突时，以 Issue/PR 的最新可验证事实为准，并立即修正本表。
- DONE 必须同时满足：代码已合并、CI 通过、验收证据存在、回滚方式明确。
- REVERTED 表示曾有实现但已被撤销，等待按新节点要求重做。
- 不得将 mock 测试、文档声明或未接入主流程的代码当成完成证据。
- 从 G0 起，任何阶段 PR 不得由作者自行验收并合并，必须等待非作者正式审核。
