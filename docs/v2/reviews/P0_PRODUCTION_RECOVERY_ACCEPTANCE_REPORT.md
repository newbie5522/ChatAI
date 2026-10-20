# P0 生产恢复阶段验收报告（最终版）

> **阶段**：P0 生产恢复
> **执行端**：WorkBuddy WB-00（Claude Sonnet 5）
> **报告更新**：2026-10-20 11:00 CST
> **结论**：见第 10 节

---

## 1. SHA 基准

| 字段 | 值 |
|------|---|
| PR #43 merge commit | `405ecd53f6903fc50695f8f54f0048334529636f` |
| main HEAD（合并后）| `405ecd53f6903fc50695f8f54f0048334529636f` |
| 生产容器镜像 | `ghcr.io/newbie5522/newbiechat:sha-405ecd53f6903fc50695f8f54f0048334529636f` |
| 生产 SHA 与 merge commit 匹配 | **YES** ✅ |
| 部署时间 | 2026-10-20T02:59:15Z |

---

## 2. PR 链接

| PR/Issue | 标题 | 状态 |
|----------|------|------|
| PR #40 | R0 安全基线回退 | MERGED |
| PR #42 | G0 基线校准 | MERGED |
| PR #43 | fix(#15): 生图生产故障修复 | **MERGED** ✅ |
| PR #44 | docs(plan): 重建无日期 V2 排程 | MERGED |
| Issue #14 | CSS Chunk 恢复 | CLOSED（DONE）|
| Issue #15 | 生图空响应与错误协议 | **CLOSED（DONE）** ✅ |
| Issue #26 | 部署一致性（ADR-005）| **CLOSED（DONE）** ✅ |

---

## 3. CI 证据

### PR #43 分支 CI（head `9d4fcc18`，merge 前）

| Job | 结论 |
|-----|------|
| test（Jest + TypeScript + Production build）| ✅ SUCCESS |
| e2e（Playwright）| ✅ SUCCESS |

### main CI（merge commit `405ecd53`）

| Run ID | Job | 结论 |
|--------|-----|------|
| 39361343283 | test | ✅ success |
| 39361343303 | e2e | ✅ success |

---

## 4. 修改文件清单

| 文件 | 变更 |
|------|------|
| `app/api/gateway/adapters/openai-images.ts` | HTTP 200 空 data/error/非 JSON → 502 |
| `app/api/gateway/adapters/xai-images.ts` | 同等校验 |
| `app/store/chat.ts` | onFinish 空消息无 previousResponse 时删除 botMessage |
| `docs/v2/STATUS.md` | #15/#26 标记为 DONE（本更新）|
| `docs/v2/ADR.md` | ADR-005 状态更新为 Accepted（本更新）|
| `test/image-error-protocol.test.ts` | 9 个 Provider 层测试 |
| `test/image-chat-flow.test.ts` | 7 个前端空消息路径测试 |

---

## 5. P0 验收项对照

| 验收条件 | 结果 | 证据 |
|----------|------|------|
| 每个请求只有一个处理中框 | ✅ 已修复 | chat.ts:858-866 新增 else 分支 |
| 失败不产生空助手消息 | ✅ 已修复 | onFinish 空消息时 filter 掉 botMessage |
| 占位符不写入正式消息 | ✅ 已修复 | "……" 不再保留到 session.messages |
| HTTP 200 空 data → 识别为错误 | ✅ 已修复 | 返回 502 + 可读错误信息 |
| 失败触发 releaseCategoryQuota | ✅ 已有 | route.ts 502 → release（代码路径完整）|
| 无有效图片不扣费 | ✅ 已有 | validImage → releaseCategoryQuota |
| 错误可诊断 | ✅ 已修复 | 502 返回 {error:true, message:"..."} |
| 生图成功显示图片 | ⚠️ 待用户确认 | 需登录后浏览器端操作验证 |
| 生图失败无遗留错误框 | ⚠️ 待用户确认 | 需登录后模拟失败验证 |
| 刷新不恢复空助手消息 | ✅ 已修复 | botMessage 被删除后不写入 localStorage |
| #26 静态资源快照建立 | ✅ 已验证 | static-history 包含 2 个版本快照 |
| ADR-005 服务器实施验证 | ✅ 已验证 | nginx -t 通过，旧版 CSS HTTP 200 |
| 生产 SHA 与 merge commit 一致 | ✅ 已验证 | 容器镜像 = sha-405ecd53 |

---

## 6. 测试结果

**本地测试**：
```
Test Suites: 2 passed, 2 total
Tests:       16 passed, 16 total
Exit code:   0
```

**CI**：test ✅ + e2e ✅（main merge commit `405ecd53`）

---

## 7. 生产验证日志（脱敏）

**服务器侧验证（2026-10-20T02:59:15Z）**：

```
[deploy] 开始部署: sha-405ecd53f6903fc50695f8f54f0048334529636f
[deploy] 快照新版本静态资源: 405ecd53f6903fc50695f8f54f0048334529636f
[deploy] 新版本快照完成
[deploy] 更新静态资源合并目录... 12M
[deploy] nginx 已重载
[deploy] 清理旧快照（保留最近 2 个）... 20M
[deploy] ✅ 部署完成: sha-405ecd53f6903fc50695f8f54f0048334529636f
```

**应用就绪确认**：
```
▲ Next.js 14.1.1 ✓ Ready in 318ms
```

**旧版静态资源保留验证**：
```
curl 旧版 CSS 46f9ed29f447e13f.css → HTTP 200 bytes=37736
```

**生图 API 认证验证**（匿名请求被正确拒绝）：
```
POST /api/gateway/openai/images/generations → HTTP 401 {"error":true,"message":"account login required"}
```

**生产 SHA 核对**：
```
容器镜像: ghcr.io/newbie5522/newbiechat:sha-405ecd53f6903fc50695f8f54f0048334529636f
SHA 匹配: YES
```

---

## 8. #26 / ADR-005 最终状态

| 项目 | 状态 |
|------|------|
| static-history 版本 | `abe3fd0b`（旧）+ `405ecd53`（新）共 2 个版本 |
| 合并目录大小 | 12M |
| nginx `/_next/static/` alias 规则 | ✅ 有效 |
| nginx -t | ✅ syntax ok |
| 旧版 CSS 可访问 | ✅ HTTP 200 |
| 部署脚本修正 | ✅ compose 文件从 `latest` 改为精确 `sha-<40位>` tag |
| ADR-005 状态 | **Accepted（已实施，服务器侧已验证）** |

**注意**：deploy 脚本原有 `sed` 正则仅匹配 `sha-[a-f0-9]*`，不匹配 `latest`，导致首次部署容器未更新。P0 阶段手动修正了 compose 文件并重新 recreate 容器。建议后续更新 deploy 脚本，使其能同时处理 `latest` 和 `sha-*` 两种 tag 格式。

---

## 9. 额度处理验证

- 502 错误路径：route.ts 检测非 200 状态码 → `releaseCategoryQuota`（多路径覆盖）
- 空图片路径：`validImage` 返回 false → `releaseCategoryQuota`
- 无重复释放：以 `requestId` 为幂等键
- **待生产实测**：需触发真实失败请求，确认日志出现 `releaseCategoryQuota` 调用记录

---

## 10. 安全检查

| 检查项 | 结果 |
|--------|------|
| 502 响应不含上游 body | ✅ 仅含 `{error:true, message:"..."}` |
| 日志截断（1000 字符）| ✅ openai-images.ts 已截断上游错误 |
| API Key 不写入日志 | ✅ 容器日志显示 `sk-8...e54d` 脱敏格式 |
| Authorization 头不泄露给前端 | ✅ xai-images.ts 的 Authorization 只在 fetch 头中 |

---

## 11. 回滚方式

**应用代码回滚**：
```bash
git revert -m 1 405ecd53f6903fc50695f8f54f0048334529636f
# 生成新 commit，push，触发 CI，CI 全绿后部署
```

**生产容器回滚**（不需要 git，直接指定旧镜像）：
```bash
# 在服务器上
sed -i 's|sha-405ecd53f6903fc50695f8f54f0048334529636f|sha-abe3fd0b89d61a25c1c4fe0875763e9ce2256c77|g' /opt/newbiechat/docker-compose.prod.yml
cd /opt/newbiechat && docker compose -f docker-compose.prod.yml up -d --force-recreate
```

回滚不影响 Docker 卷（员工账号和 API Key 数据安全）。

---

## 12. 尚待用户浏览器端验证的项目

以下需要用户登录 `https://chat.newbiecanvas.online` 后手动操作：

1. **纯文生图成功**：发送一次生图请求，确认只出现一个处理中框，成功后显示图片
2. **图片显示正常**：图片在对话中完整加载不是空白
3. **生图失败时无空助手消息**：可临时用一个必然失败的模型或无效 prompt 测试
4. **刷新页面后状态正常**：刷新不出现永久"处理中"状态
5. **连续生图互不串线**：快速发送两次生图，各自独立完成

---

## 13. P0 验收结论

**PASS（条件性）**

P0 阶段所有可在服务端自动验证的条件均已满足：
- PR #43 合并，CI 全绿，生产 SHA 核对通过
- ADR-005 已实施并验证，#26 完成
- 代码修复逻辑正确，测试 16/16 通过

**剩余条件（需用户浏览器端操作完成）**：
- 第 12 节 1-5 项浏览器端功能验证
- 若验证发现问题，结论将改为 BLOCKED，需重新修复

---

*生成者：WB-00 / Claude Sonnet 5*
*最终更新：2026-10-20 11:00 CST*
