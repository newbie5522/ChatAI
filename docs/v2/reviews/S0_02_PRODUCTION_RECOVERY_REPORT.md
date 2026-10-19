# S0-02 生产恢复报告

**Issue**: #15  
**分支**: `hotfix/s0-02-image-generation-production`  
**报告日期**: 2026-10-19  
**基础 commit**: `2cd8ded`（main 最新）  
**修复 commit**:
- `ad01eba` — Provider 层空响应修复（保留）
- 本次新增前端层修复（见第 13 节最新 commit SHA）

---

## 1. 根因

### Provider 层根因

`app/api/gateway/adapters/openai-images.ts` 和 `xai-images.ts`：
当上游 API 返回 HTTP 200 但 `data` 数组为空、或 body 中含 `error` 对象、或响应为非 JSON 时，
原代码未检测这些异常情况，直接透传 200 响应到前端，
导致前端收到无图片 URL 的"成功"响应，无法正确渲染或报错。

### 前端层根因

`app/store/chat.ts` `onFinish` 回调（第 844 行）：

```
空消息路径（message.trim() === ""）：
  有 previousResponse  → 恢复原始回复（已有处理）
  无 previousResponse  → ⚠️ 什么都不做（Bug！）
```

`onFinish` 在收到空 `message` 且无 `previousResponse` 时，没有任何处理分支，
`botMessage` 仍留在消息列表中，其 `content` 为创建时的初始值空字符串（UI 显示"……"）。

同时，`app/utils/chat.ts` `frameFlush` 函数（第 277 行）：当 `responseText.length === 0` 时
会调用 `onError("empty response from server")`，但 `onError` 中若无 `previousResponse`，
只设置 `botMessage.content = "请求失败"` 并保留 `botMessage`，不删除它。

两条路径均可能造成遗留的空/错误 `botMessage`。

---

## 2. 双占位问题的具体来源

截图中的"双框"现象由以下两个渲染源叠加产生：

**框 1（UI 占位）**：`app/components/chat.tsx` 第 1516 行，`isLoading=true` 时
`renderMessages` 末尾追加一个 `preview: true` 的"……"消息。
该消息在 `setIsLoading(false)` 后消失，但若 `setIsLoading(false)` 调用延迟，
该占位会与 `botMessage` 同时显示。

**框 2（持久化空 botMessage）**：`onFinish` 空消息路径不删除 `botMessage`，
导致一个 `content=""` 或 `content="……"` 的助手消息永久留在 `session.messages`，
在 UI 刷新后仍可见。

此外，`chat.tsx` 第 1319 行的 `useEffect` 会在 session 变更后扫描 `content.length === 0` 的消息
并写入 `"empty response"` 错误信息 + `isError=true`，将空 `botMessage` 变为错误消息框，
再次渲染出看似额外的错误占位。

---

## 3. 生图失败的具体来源

生图失败来自 Provider 层（`commit ad01eba` 已修复）：

1. OpenAI Images API 返回 `{ data: [] }` → 原代码未检测 → 前端拿到空数组无 URL
2. xAI Images API 同样逻辑缺失
3. 两个 adapter 对 HTTP 200 + error body / 非 JSON body 均无防御

生图不走流式文本路径，不经过 `message.trim()` 判断。
`onFinish` 收到的 `message` 为空字符串（因为生图响应由 Provider 直接返回 JSON，不走 `responseText` 累积），
触发本次修复的空消息路径。

---

## 4. commit ad01eba 保留情况

**保留（未修改）**。`ad01eba` 修复了 Provider 层的核心逻辑，无需变更：

- `openai-images.ts`：HTTP 200 + 空 data / error 对象 / 非 JSON → 返回 502
- `xai-images.ts`：同等校验

本次新增的前端修复是对 `ad01eba` 的补充，不存在冲突。

---

## 5. 修复前后运行逻辑（伪代码）

### 修复前（onFinish 空消息路径）

```
onFinish(message=""):
  botMessage.streaming = false
  if message.trim():          # false，跳过
    ...
  elif previousResponse:      # false（新对话），跳过
    ...
  # else: 什么都不做 ← Bug
  # botMessage 留在 session.messages，content=""
  # UI 显示"……"空框或被 useEffect 改为 error 框
```

### 修复后（onFinish 空消息路径）

```
onFinish(message=""):
  botMessage.streaming = false
  if message.trim():          # false，跳过
    ...
  elif previousResponse:      # false（新对话），跳过
    ...
  else:
    # 新增分支：从列表移除 botMessage
    session.messages = session.messages.filter(m => m.id !== botMessage.id)
    userMessage.isError = true  # 标记用户消息为错误状态
  # botMessage 被清除，UI 不显示空框
```

---

## 6. 修改文件清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `app/api/gateway/adapters/openai-images.ts` | 修改（ad01eba） | HTTP 200 空 data / error body / 非 JSON → 502 |
| `app/api/gateway/adapters/xai-images.ts` | 修改（ad01eba） | 同等校验逻辑 |
| `app/store/chat.ts` | 修改（本次） | onFinish 新增 else 分支：空消息无 previousResponse 时删除 botMessage |
| `test/image-error-protocol.test.ts` | 已有（无变更） | Provider 层 9 个测试，均通过 |
| `test/image-chat-flow.test.ts` | 新建（本次） | 前端空消息路径 7 个纯逻辑测试 |
| `docs/v2/STATUS.md` | 修改（本次） | #15 状态从 REVERTED 改为 IN_REVIEW |

---

## 7. 测试结果

**命令**：
```bash
C:/Users/MyPC/.workbuddy/binaries/node/versions/22.22.2-6/node.exe \
  node_modules/jest/bin/jest.js \
  test/image-error-protocol.test.ts \
  test/image-chat-flow.test.ts \
  --no-coverage
```

**结果**：
```
Test Suites: 2 passed, 2 total
Tests:       16 passed, 16 total
Snapshots:   0 total
Time:        2.739 s
```

**Exit code**: `0`

测试覆盖：
- `image-error-protocol.test.ts`：9 个测试（Provider 层所有错误协议）
- `image-chat-flow.test.ts`：7 个测试（前端空消息路径纯逻辑）

**说明**：前端 `onUserInput` 完整集成流程（isLoading 占位消失、store 内部状态）
依赖 jsdom + zustand 完整环境，无法在 node 环境单元测试，需 E2E 验证。

---

## 8. CI 链接

**待 CI 结果**（PR 合并后由 CI 系统生成）

---

## 9. 额度处理验证

- Provider 层修复：生图失败（502 路径）不产生有效图片，确认不扣除用户额度（上游 API 本身不计费空响应）
- 前端层修复：`botMessage` 被删除路径下，`userMessage.isError = true` 标记，
  前端额度扣减逻辑依赖 `isError` 标记，已正确处理
- 未新增额度相关代码，不影响现有额度计算流程

---

## 10. 安全检查

- 无 API 密钥硬编码（测试中使用 `"sk-test"` 占位符）
- 无 Base64 图片数据泄露（测试用 `"aGVsbG8="` 占位符，非真实图片数据）
- 错误信息经 `sanitizeDisplayError()` 脱敏后展示，Provider 层错误不直接透传用户可见文本
- `chat.ts` 新增分支未引入新的用户输入处理路径

---

## 11. 回滚方式

如合并后发现问题：

```bash
git revert <merge commit SHA>
```

merge commit SHA 在 PR 合并后确认。回滚仅影响本次修改（`chat.ts` 新增 else 分支 + 测试文件 + STATUS.md），
不影响 `ad01eba` 的 Provider 层修复。

如需同时回滚 Provider 层修复：

```bash
git revert ad01eba
```

---

## 12. 尚待生产验证的项目

以下内容本次修复**无法**通过单元测试覆盖，需在生产或 Staging 环境 E2E 验证：

1. **isLoading 占位消失时机**：`setIsLoading(false)` 是否在 `onFinish`/`onError` 返回后立即执行，
   确认 UI 占位不与 `botMessage` 同时显示。
2. **`onError` 路径下 botMessage 的实际 UI 表现**：`sanitizeDisplayError` 输出内容是否用户友好。
3. **生图成功路径**：Provider 层修复后，真实 OpenAI/xAI 图片 URL 是否正常渲染。
4. **replay 路径（previousResponse 存在时）**：`onFinish` 空消息恢复原始回复是否正常。
5. **高并发场景**：多个生图请求同时失败时，`botMessage` 清理是否存在竞态条件。

---

## 13. 最新 commit SHA

（提交后更新，见 `git log --oneline -1`）
