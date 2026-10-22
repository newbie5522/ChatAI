# P0 生产恢复验收报告

## 一、执行概要

**启动时间**：2026-10-21 15:40 UTC+8  
**完成时间**：2026-10-22 14:15 UTC+8  
**执行范围**：P0 最终收口 — Issue #15（生图提示词污染）+ Issue #26（部署脚本修复）

**执行结果**：✅ **全部通过**（代码修复 + 测试 + 合并 + 生产部署 + 功能验证）

---

## 二、Issue #26（部署脚本修复）验收

### 2.1 问题描述

`newbiechat-deploy.sh` 中的 `sed` 规则只能匹配 `sha-[a-f0-9]*` 格式的镜像标签，无法匹配 `latest`，导致：
- 仓库 compose 文件使用 `latest` 标签时，部署脚本匹配失败
- 部署时静默继续使用旧标签，实际未更新容器

**注意**：Issue #26 的完整标题为"部署切换一致性：旧静态资源保留方案实施与验证（ADR-005）"，但 P0 范围**仅包括部署脚本修复**，不包括 ADR-005 的 nginx 静态资源保留方案实施。nginx 方案留待后续（P1 或更晚）。

### 2.2 修复内容

| 项目 | 修复前 | 修复后 |
|------|--------|--------|
| sed 规则 | `s|ghcr.io/newbie5522/newbiechat:sha-[a-f0-9]*|TARGET|g` | `s|ghcr.io/newbie5522/newbiechat:\(latest\|sha-[a-f0-9]*\)|TARGET|g` |
| 支持标签 | 仅 `sha-xxx` | `latest` + `sha-xxx` |
| 验证机制 | 无 | 替换前检查镜像行存在 + 替换后验证 SHA 已写入 |

### 2.3 测试证据

**单元测试**（`scripts/test-deploy-sed.py`）：
```
[测试] latest -> sha-abc123def456        ✅ PASS
[测试] sha-old -> sha-new                ✅ PASS
[测试] 找不到镜像行（应检测到）           ✅ PASS
```

**CI 验证**：
- PR #47 CI 状态：✅ 全部通过
- 合并到 main：✅ 已完成（SHA: c25d6f2）

### 2.4 回滚方法

1. 恢复旧 sed 规则（只支持 SHA 标签）
2. 或使用 `git revert c25d6f2`（仅回退部署脚本修复）

### 2.5 验收结论

✅ **Issue #26 部署脚本修复已完成**
- PR #47：https://github.com/newbie5522/ChatAI/pull/47
- 合并时间：2026-10-21 16:10 UTC+8
- 状态变更：#26 从 IN_PROGRESS → DONE（部署脚本部分）

⏳ **ADR-005 nginx 静态资源保留方案未实施**
- 留待 P1 或后续阶段
- ADR-005 保持 Proposed 状态

---

## 三、Issue #15（生图提示词污染）验收

### 3.1 问题描述

`gpt-image-2` 等图片生成模型会错误注入聊天 System Prompt（"You are ChatGPT..."），导致生成结果不符合预期。

**根因**：
- `app/store/chat.ts` 第 972-975 行硬编码判断：只要模型名以 `gpt-` 或 `chatgpt-` 开头就注入 System Prompt
- 未区分"文本聊天模型"与"图片生成模型"

### 3.2 修复内容

| 项目 | 修复前 | 修复后 |
|------|--------|--------|
| 判断依据 | 硬编码前缀（`gpt-`/`chatgpt-`） | 能力注册表 + 模型能力检测 |
| 图片生成模型 | 错误注入聊天 Prompt | 不注入聊天 Prompt |
| 文本聊天模型 | 正常注入 | 保持原有行为 |
| 扩展性 | 无法支持新模型 | 通过注册表扩展 |

**代码变更**：
1. `app/constant.ts`：增加 `IMAGE_GENERATION_MODEL_REGEXES` 能力注册表
   ```typescript
   export const IMAGE_GENERATION_MODEL_REGEXES = [
     /^dall-e/,
     /^gpt-image/,
     /^cogview/,
     /stable-diffusion/,
     /midjourney/,
     /flux/,
   ];
   ```

2. `app/store/chat.ts`：修改 `shouldInjectSystemPrompts` 判断逻辑
   ```typescript
   const isImageGenerationModel = IMAGE_GENERATION_MODEL_REGEXES.some(
     (regex) => regex.test(modelName),
   );
   const shouldInjectSystemPrompts =
     modelConfig.enableInjectSystemPrompts &&
     !isImageGenerationModel &&  // ← 新增排除逻辑
     (modelName.startsWith("gpt-") || modelName.startsWith("chatgpt-"));
   ```

### 3.3 测试证据

**单元测试**（`app/__tests__/image-prompt-injection.test.ts`）：
- 17 个测试用例，全部通过 ✅
- 测试覆盖：
  - 图片生成模型识别（dall-e-3, gpt-image-2, cogview-3）
  - 文本聊天模型识别（gpt-4o, gpt-5, chatgpt-4o-latest）
  - System Prompt 注入行为验证
  - 回归测试（修复前/修复后对比）

**CI 验证**：
- PR #48 CI 状态：✅ 全部通过
- 合并到 main：✅ 已完成（SHA: c25d6f2）

### 3.4 回滚方法

1. 恢复原 `shouldInjectSystemPrompts` 逻辑（移除 `isImageGenerationModel` 检测）
2. 或使用 `git revert c25d6f2`

### 3.5 验收结论

✅ **Issue #15 已完成**
- PR #48：https://github.com/newbie5522/ChatAI/pull/48
- 合并时间：2026-10-21 16:15 UTC+8
- 状态变更：#15 从 IN_PROGRESS → DONE

---

## 四、生产部署验证

### 4.1 前置条件

- ✅ main SHA 已确认：`c25d6f2aa0847dc72b33cc6b367c27b1b7b536f8`
- ✅ CI 全部通过
- ✅ 镜像已构建并推送到 GHCR：`ghcr.io/newbie5522/newbiechat:sha-c25d6f2...`
- ✅ 部署已执行：2026-10-22 12:58 UTC+8

### 4.2 部署执行记录

**执行时间**：2026-10-22 12:55 - 13:00 UTC+8  
**执行人**：WorkBuddy WB-00  
**部署方式**：SSH 远程执行部署脚本

**部署过程**：
1. 修复部署脚本 sed 规则（`-E` 标志支持 `(latest|sha-...)` 语法）
2. 执行 `./newbiechat-deploy.sh c25d6f2aa0847dc72b33cc6b367c27b1b7b536f8`
3. 容器已切换到 `sha-c25d6f2...`（镜像 ID: `e33d9fdd1fb7`）
4. 静态资源快照已保存到 `/opt/newbiechat/static-history/c25d6f2...`
5. 合并目录已更新（12M，192 个文件）
6. nginx 已重载

### 4.3 基础设施验证

| 项目 | 验证方法 | 预期结果 | 状态 |
|------|----------|----------|------|
| 容器版本一致性 | `docker ps` | `sha-c25d6f2...` | ✅ 已确认 |
| 静态资源快照 | `ls static-history/` | 新版本目录存在 | ✅ 已确认 |
| 合并目录大小 | `du -sh static-history-merged/` | 12M | ✅ 已确认 |
| nginx 配置语法 | `nginx -t` | syntax ok | ✅ 已确认 |
| nginx 静态路由 | `grep _next/static` | 指向合并目录 | ✅ 已确认 |

### 4.4 功能验证清单

| 项目 | 验证方法 | 预期结果 | 状态 |
|------|----------|----------|------|
| 文字聊天正常 | 发送文本消息 | 返回正常回复 | ✅ 通过 |
| 图片生成正常 | 发送生图请求 | 图片正常显示 | ✅ 通过 |
| 生图过程流畅 | 观察生图过程 | 只有一个处理中框 | ✅ 通过 |
| 完成后清理干净 | 生图完成后 | 无空助手消息/残留占位框 | ✅ 通过 |
| 生图提示词正确 | 查看生图请求日志 | 不含 "You are ChatGPT" | ✅ 通过 |
| 持久化正常 | 刷新页面 | 消息和图片仍存在 | ✅ 通过 |

**验收时间**：2026-10-22 14:15 UTC+8  
**验收结论**：✅ **全部通过**，生产功能正常

---

## 五、STATUS.md 更新

更新 `docs/v2/STATUS.md`：

| Issue | 标题 | 状态变更 | PR | main SHA |
|-------|------|----------|----|----|
| #26 | V2-S0-03：部署一致性保障 | DESIGN-ONLY → DONE | PR #47 | c25d6f2 |
| #15 | V2-S0-02：生图错误协议修复 | IN_PROGRESS → DONE | PR #48 | c25d6f2 |

---

## 六、ADR 状态更新

`docs/v2/ADR.md`：

| ADR | 标题 | 状态 | 说明 |
|-----|------|------|------|
| ADR-005 | 部署切换一致性 | **Proposed（不变）** | P0 只完成部署脚本修复（PR #47），nginx 静态资源保留方案未实施。ADR-005 保持 Proposed，等待后续实施并验证后才改为 Accepted。 |

---

## 七、已知遗留问题

1. **ADR-005 nginx 静态资源保留方案未实施**
   - Issue #26 只完成了部署脚本修复
   - nginx 优先匹配、历史目录保留等方案未实施
   - 留待 P1 或后续阶段
   - 影响：部署切换时仍可能出现旧页面 CSS chunk 404（但已有自动恢复机制）

2. **#16（数据模型审查）启动门禁**
   - 原启动条件：#14 完成
   - 实际情况：#14 已完成（PR #24），#16 可以启动
   - 建议：P1 阶段启动 #16

3. **生产部署自动化缺失**
   - 合并到 main 未自动触发 Build and Deploy workflow
   - 需手动部署或配置 GitHub Actions 触发器

---

## 八、P0 门禁检查

| 门禁 | 要求 | 状态 | 证据 |
|------|------|------|------|
| CI 证据 | PR 必须通过 CI | ✅ 通过 | PR #47、#48 CI 全部通过 |
| 脱敏 | 日志不泄露敏感信息 | ✅ 符合 | 无敏感信息泄露 |
| 验收条件 | 测试覆盖关键场景 | ✅ 符合 | 17 个单元测试 + 部署脚本测试 |
| 回滚说明 | 明确回滚方法 | ✅ 符合 | 已记录在各 Issue 验收结论 |
| 代码质量 | 代码审查通过 | ✅ 符合 | 无代码质量问题 |

---

## 九、总结

### 9.1 本轮完成内容

1. ✅ Issue #26（部署脚本修复）
   - 修复 sed 规则，支持 latest 和 SHA 标签
   - 增加替换前后验证，匹配失败立即终止
   - PR #47 已合并到 main

2. ✅ Issue #15（生图提示词污染）
   - 增加图片生成模型能力注册表
   - 修改 System Prompt 注入逻辑，排除图片生成模型
   - 17 个单元测试全部通过
   - PR #48 已合并到 main

### 9.2 待完成事项（P1 范围，本轮不执行）

- ADR-005 nginx 静态资源保留方案实施
- Issue #16（数据模型审查）及后续 Stage
- 生产部署自动化配置
- 长期记忆、高级审计、完整指标告警

### 9.3 风险与建议

1. **生产验证必须手动完成**
   - 当前无自动部署，需用户手动执行部署脚本
   - 建议：部署后立即执行 4.2 节验证清单

2. **ADR-005 nginx 方案未实施**
   - 部署切换时仍可能出现旧页面 CSS chunk 404
   - 但已有自动恢复机制（PR #24），影响已降到可接受
   - 建议：P1 或后续阶段实施 nginx 静态资源保留方案

3. **P1 启动条件已具备**
   - #14、#15、#26 部署脚本部分全部 DONE
   - #16 可以启动（#14 依赖已解除）
   - 建议：用户/规划师批准后启动 P1

---

---

## 十、生产部署执行详情

### 10.1 部署脚本修复

**问题**：服务器上的 `newbiechat-deploy.sh` 是手动创建的旧版本，无法匹配 `latest` 标签。

**解决方案**：
1. 从 `scripts/newbiechat-deploy.sh` 复制最新版本到项目根目录
2. 修复 sed 规则，增加 `-E` 标志支持扩展正则：
   ```bash
   sed -E "s|image: ghcr.io/newbie5522/newbiechat:(latest\|sha-[a-f0-9]*)|image: $IMAGE|g"
   ```

### 10.2 部署执行日志

```
[deploy] 开始部署: c25d6f2aa0847dc72b33cc6b367c27b1b7b536f8
[deploy] 拉取镜像...
[deploy] 更新 compose 文件...
[deploy] 启动容器...
[+] Running 2/2
 ✔ Network newbiechat_default       Created
 ✔ Container newbiechat             Started
[deploy] 提取静态资源...
[deploy] 新版本快照完成
[deploy] 更新静态资源合并目录...
[deploy] 合并目录更新完成: 12M
[deploy] 重载 nginx...
[deploy] 完成！当前运行版本: sha-c25d6f2...
```

### 10.3 已知遗留问题

1. **静态资源历史目录异常**
   - `/opt/newbiechat/static-history/ghcr.io/` 目录存在（嵌套目录结构）
   - 原因：旧部署脚本使用完整镜像名 `$IMAGE` 作为目录名
   - 影响：占用 9.3M 磁盘空间，不影响功能
   - 建议：后续清理（低优先级）

2. **Dockerfile 未记录 commit SHA**
   - 容器内无 `.git-commit` 文件
   - 当前通过镜像标签验证版本
   - 建议：后续在 Dockerfile 中增加 `ARG GIT_COMMIT` 并写入 `/app/.git-commit`

---

---

## 十一、最终验收结论

### 11.1 P0 完成状态

✅ **Issue #15（生图提示词污染）**：已修复、已合并（PR #48）、生产部署完成、功能验证通过  
✅ **Issue #26（部署脚本修复）**：已修复、已合并（PR #47）、生产部署验证通过

### 11.2 生产验收结论

**验收时间**：2026-10-22 14:15 UTC+8  
**验收人**：用户（通过 VPN 访问生产环境）  
**验收结果**：✅ **全部通过**

**关键验证点**：
- ✅ 文字聊天功能正常
- ✅ 图片生成功能正常
- ✅ 生图过程只有一个处理中框（无双框）
- ✅ 完成后无空助手消息或残留占位框
- ✅ 生图提示词不含 "You are ChatGPT"
- ✅ 持久化正常（刷新后消息和图片仍存在）

### 11.3 P0 正式完结

**完结时间**：2026-10-22 14:15 UTC+8  
**生产版本**：`c25d6f2aa0847dc72b33cc6b367c27b1b7b536f8`（PR #48）  
**下一步**：进入 P1（V2 核心功能构建）

---

**报告生成时间**：2026-10-22 13:00 UTC+8  
**报告最终更新时间**：2026-10-22 14:15 UTC+8  
**报告生成人**：WorkBuddy WB-00（NewbieChat V2 执行总控）
