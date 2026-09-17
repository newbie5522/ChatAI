# V2 实时状态板

最后初始化：2026-09-15 UTC

| 工作项 | 状态 | 主执行 | 审查 | 依赖 | 当前动作 |
|---|---|---|---|---|---|
| #14 CSS Chunk/设置页恢复 | IN_REVIEW | WorkBuddy + GPT | Codex | 无 | PR #24 已修复 5 项阻塞项（恢复上限=1/去掉不实承诺/错误信息脱敏/CI 真正在 PR 上跑/ADR-005 收敛），等待非作者端交叉审查 |
| #15 生图空响应/错误协议 | READY | Codex | WorkBuddy + Claude | 无 | Codex认领并建立分支 |
| #16 会话数据模型 | DESIGN-ONLY | Codex | WorkBuddy + Claude | #14 #15 | Claude先提交schema评审意见 |
| #20 统一 Model Gateway | BLOCKED | Codex + WorkBuddy GPT | Claude | #16 | 等待S1接口边界 |
| #17 流式聊天运行时 | BLOCKED | Codex + WorkBuddy GPT | Claude | #16 #20 | 不得提前实现 |
| #18 持久附件管线 | BLOCKED | WorkBuddy | Codex | #16 | 仅允许调研对象存储/OCR |
| #19 异步媒体运行时 | BLOCKED | Codex + WorkBuddy GPT | Claude | #16 #20 | 不得提前实现 |
| #21 权限/额度/可观测性 | BLOCKED | Codex | WorkBuddy + Claude | #16 #20 | 不得提前实现 |

状态枚举：`READY`、`IN_PROGRESS`、`IN_REVIEW`、`BLOCKED`、`DONE`、`PAUSED`。

## 总控规则

- 开始或结束任务时同步更新本表。
- Issue 与本表冲突时，以 Issue/PR 的最新可验证事实为准，并立即修正本表。
- DONE 必须同时满足：代码已合并、CI通过、验收证据存在、回滚方式明确。
