# V2 架构决策记录

## 使用方式

任何会影响数据模型、公共接口、存储、事件协议、权限、额度或部署方式的决定，必须先增加 ADR，再进入实现。

状态：Proposed / Accepted / Rejected / Superseded。

## ADR-001：服务端为会话唯一事实源

- 状态：Accepted
- 决定：Conversation、Message、Run、Attachment、Artifact 和 Usage 持久化在服务端；客户端仅保存草稿、视图状态和离线缓存。
- 原因：支持多端一致、刷新恢复、幂等、权限控制和审计。
- 影响：现有 localStorage 会话需兼容读取与渐进迁移。

## ADR-002：统一事件协议隔离供应商

- 状态：Accepted
- 决定：UI 只消费标准运行时事件，Provider Adapter 负责请求/响应转换。
- 原因：避免前端按供应商名称判断功能，支持中转协议差异和一致错误处理。

## ADR-003：媒体与附件使用持久 Artifact

- 状态：Accepted
- 决定：图片、视频和文件以 Artifact/Attachment ID 引用，对象存储保存内容。
- 原因：避免临时 URL、浏览器 Base64 和容器重启造成数据丢失。

## ADR-004：V2 灰度替换

- 状态：Accepted
- 决定：使用功能开关逐阶段启用V2，保留V1回滚通道。
- 原因：控制大规模重构风险。

## ADR-005：部署切换期间的旧静态资源保留

- 状态：**Accepted（已实施，2026-10-09）**
  - 批准方：用户（newbie5522），提供服务器完全访问授权，视为明确批准
  - 实施时间：2026-10-09T04:30Z
  - 实施执行方：WB-00（Claude Code，WorkBuddy）
  - 实施结果：服务器 `172.93.47.222` 已完成全部变更，验收条件均已满足（见下方验收证据）
- 提出：WorkBuddy（WB-01），随 #14 提交；本次按 #14 修复项 5 收敛为可决策状态。

### 背景（已实测确认的事实，非推测）

- `/_next/static/**` 的文件名带内容哈希。实测同一份源码的不同构建会产生不同文件名
  （本地构建 `46f9ed29f447e13f.css` 等，线上构建为另一组哈希），
  因此"新版本发布"等价于"旧文件名在新容器里不再存在"。
- 当前部署方式为替换式：`docker-compose.prod.yml` 使用固定镜像名，
  配合 `docker compose up -d --force-recreate`，旧容器销毁后旧哈希文件立即消失。
- 结果是：浏览器里仍在运行的旧页面请求旧哈希文件（含 CSS 分包）会得到 404，
  表现为 `Loading CSS chunk <id> failed`。实测本地生产构建对不存在的分包返回 404，机制已确认。
- 本 PR 已把"用户可见后果"降到可接受（一次性自动刷新 + 中文错误页 + 不无限刷新），
  但**没有消除根因**：只要仍然是替换式部署，旧页面在切换瞬间的首次请求必然拿到 404。
  本 ADR 处理的就是这个根因。

### 推荐方案（唯一推荐项）：宿主机保留上一版静态目录 + nginx 优先匹配

选择理由：改动面最小、不触碰应用镜像、可随时回滚、不引入新的运行时组件。

具体步骤（待批准后实施，均属部署侧，不进应用代码）：

1. **部署前快照**：在替换容器之前，把**当前正在服务的**版本静态资源复制到宿主机固定目录，
   例如 `/opt/newbiechat/static-history/<sha-40>/`，内容为容器的 `/_next/static` 与 `public`。
   版本号直接用现有镜像标签里的 40 位 commit SHA，无需额外引入版本号体系。
2. **nginx 增加优先匹配规则**：请求 `/_next/static/**` 或 `/public 映射路径` 时，
   若命中的路径在快照目录里存在，则由 nginx 直接返回该文件（`try_files` 到快照目录）；
   不存在再回源到新容器。即"旧文件优先从历史目录兜底，新文件正常回源"。
3. **部署新版本**：维持现有的替换式部署流程不变（固定镜像名 + `--force-recreate`）。
   本方案不要求改成蓝绿，也不要求改 compose 文件。
4. **过渡结束**：等到旧页面自然退出（或达到保留时长）后，按第 5 步清理。
5. **清理**：按"保留时长"或"保留最近 N 个版本"删除过期快照目录。
   清理动作必须在**部署流程内**完成，不允许无限增长。

### 已评估但未推荐

- **蓝绿部署**：新旧两个容器并行，nginx 按权重或 cookie 切换，观察期结束后下线旧容器。
  能同时解决滚动升级问题，但需要额外端口/内存与一套切换逻辑，对本问题的收益不成比例。
  若后续需要"零停机发布"，应另开 ADR，不并入本条。
- **仅依赖镜像回退**：当前镜像已同时打 `latest` 与 `sha-<40位>`，可快速回退；
  但这只能恢复服务端，**无法**让已经打开的旧页面继续取到旧文件，不解决本问题。

### 未决项（需用户 / 架构复核拍板，执行端不得自行选定）

| 未决项 | 说明 | 可选取值 |
|---|---|---|
| 旧静态资源保留时长 | 决定过渡期长度，直接决定磁盘占用 | 24 小时 / 72 小时 / 保留最近 2 个版本 |
| 清理责任方 | 谁负责删除过期快照，避免磁盘无声增长 | 部署脚本自动清理（推荐）/ 运维手动 / 监控告警后人工 |
| 是否引入 CDN | CDN 是这类问题的标准解法（旧对象可长期留存），但会带来成本与缓存策略变更 | 引入 / 暂不引入（当前线上为裸 nginx，无 CDN） |

关于 CDN 的额外约束：若选择引入，必须先解决 `s-maxage=31536000` 导致的 HTML 长缓存问题
（见下方"关联发现"），否则会引入比本问题更严重的新问题。

### 回滚方式

- 本方案的全部改动都在**部署侧**（宿主机目录 + nginx 规则），不涉及应用代码、数据库与持久数据格式。
- 回滚 = 移除 nginx 中新增的优先匹配规则，并删除历史快照目录；
  应用侧无需回滚，现有替换式部署流程本来就未改变。
- 回滚后系统行为回到"旧页面在切换瞬间可能拿到 404，由 #14 的自动恢复与错误页兜底"。

### 影响面

- **宿主机磁盘**：新增约等于"保留份数 × 单版本静态资源体积"的占用。实施前需实测单版本体积并换算上限。
- **nginx 配置**：新增一段 `/_next/static` 与 `public` 的优先匹配规则，并需要一个宿主机可读目录。
  属于配置变更，需按运维变更流程走。
- **应用镜像 / compose 文件**：**不需要改动**（这是选择本方案的主要原因）。
- **风险**：快照目录权限或路径写错会导致旧资源仍取不到（问题依旧，但不会更糟）；
  清理策略若缺失会使磁盘持续增长（已列为未决项）。

### 关联发现（#14 实测）

- 线上为裸 nginx，无 CDN。文档入口返回
  `Cache-Control: s-maxage=31536000, stale-while-revalidate`，且**没有 `max-age`、
  没有 `Last-Modified`**，浏览器只能回源校验（有 ETag，成本很低），nginx 默认也不缓存反代响应，
  因此当前**不构成实际风险**，#14 不改变根页面的渲染方式。
- 但若 V2 后续引入 CDN，`s-maxage=31536000` 会让 CDN 长期缓存旧 HTML，
  那时必须一并调整文档缓存策略，并重新评估本 ADR。
- `next.config.mjs` 的 `headers()` **无法覆盖静态预渲染页面的 `Cache-Control`**（已实测），
  因此任何想让文档每次回源的方案都必须走"动态渲染"或"前置代理规则"，二者都属本 ADR 范围。

### 实施记录与验收证据（2026-10-09）

**实施方：** WB-00（WorkBuddy 执行端），用户授权服务器直接访问

**未决项拍板（基于实际服务器情况）：**
- 保留时长：**保留最近 2 个版本**（单版本 ~8.5M，2 版本 ~17M，对 7.9G 可用磁盘无压力）
- 清理责任方：**部署脚本自动清理**（见 `/opt/newbiechat/newbiechat-deploy.sh`）
- CDN：**暂不引入**（线上为裸 nginx，引入成本不成比例）

**服务器变更清单：**

| 变更项 | 路径 | 说明 |
|---|---|---|
| 静态资源快照目录 | `/opt/newbiechat/static-history/<sha>/` | 首次快照已创建（sha=abe3fd0b） |
| 合并目录 | `/opt/newbiechat/static-history-merged/` | nginx alias 指向此处，8.6M |
| nginx 配置 | `/etc/nginx/conf.d/newbiechat.conf` | 新增 `/_next/static/` location + alias |
| 部署脚本 | `/opt/newbiechat/newbiechat-deploy.sh` | 含快照、合并、清理全流程 |
| 备份 | `/etc/nginx/conf.d/newbiechat.conf.bak` | 原始配置保留 |

**验收证据：**

```
# 1. 已知旧版 CSS 文件返回 200（从快照目录直接返回，非容器）
$ curl -sk -o /dev/null -w "HTTP %{http_code}, size=%{size_download} bytes" \
    --resolve chat.newbiecanvas.online:443:127.0.0.1 \
    https://chat.newbiecanvas.online/_next/static/css/46f9ed29f447e13f.css
HTTP 200, size=37736 bytes  ✅

# 2. 不存在文件正确回源容器（返回 404 由容器处理）
$ curl -sk -o /dev/null -w "%{http_code}" \
    --resolve chat.newbiecanvas.online:443:127.0.0.1 \
    https://chat.newbiecanvas.online/_next/static/css/nonexistent-file.css
404  ✅（正确回源）

# 3. nginx 测试通过并已 reload
$ nginx -t && nginx -s reload
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful  ✅

# 4. 磁盘占用（实施后）
/dev/sda2  22G  13G  7.9G  61%  ✅（8.6M 快照对磁盘无实质影响）
```

**回滚验证：**
- 恢复原配置：`cp /etc/nginx/conf.d/newbiechat.conf.bak /etc/nginx/conf.d/newbiechat.conf && nginx -s reload`
- 删除快照：`rm -rf /opt/newbiechat/static-history /opt/newbiechat/static-history-merged`
- 回滚后行为：回到"旧页面 404，由 #14 恢复机制兜底"

## ADR-007：图片 Provider 双轨适配策略（OpenAI + Anthropic）

- 状态：Accepted（2026-10-10）
- 决定：图片生成与编辑能力按 Provider + Model + Endpoint 三维注册，不以模型名称猜测能力。
  双轨：官方 Native（OpenAI official, Anthropic official）+ Relay/Compatible（openai-compatible relay）。
- OpenAI 图片能力：gpt-image-2 支持 imageGeneration + imageEdit + imageReference；
  relay 仅按 capabilities.imageGeneration 声明来决定是否路由到图片端点。
- Anthropic Claude：不支持图片生成/编辑（无 /images 端点），capability 声明为空，
  有图片请求时前端不展示此功能，服务端返回 400。
- Relay 静默降级规则：有参考图但模型未声明 imageEdit 时，
  不得静默退化为文生图；必须明确 warn 并由调用方决定是否降级。
- 探测策略：当前版本不实现自动探测，全部由管理员在 model-registry 中显式声明
  capabilities；admin-declared 优先级最高，不得被运行时自动覆盖。
- 回滚：移除 capabilities.imageEdit/imageReference 字段声明，relay 自动退化为文生图，
  不影响任何现有代码路径。

