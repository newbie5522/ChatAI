#!/bin/bash
# =============================================================================
# newbiechat-deploy.sh
# ADR-005 实施：部署时快照旧版静态资源 + 合并目录更新 + 自动清理
#
# 用法：
#   ./newbiechat-deploy.sh <new_image_tag>
#   例如：./newbiechat-deploy.sh sha-abc123def456
#
# 保留策略：保留最近 2 个版本的快照，第 3 个开始自动清理
# =============================================================================

set -euo pipefail

NEW_TAG="${1:?请传入新镜像 tag，例如: sha-abc123def456}"
COMPOSE_FILE="/opt/newbiechat/docker-compose.prod.yml"
HISTORY_DIR="/opt/newbiechat/static-history"
MERGED_DIR="/opt/newbiechat/static-history-merged"
CONTAINER_NAME="newbiechat-newbiechat-1"
KEEP_VERSIONS=2  # 保留最近 N 个版本

echo "[deploy] 开始部署: $NEW_TAG"
echo "[deploy] 时间: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ── 步骤 1: 快照当前版本静态资源 ──────────────────────────────────────────
CURRENT_SHA=$(docker inspect "$CONTAINER_NAME" --format '{{.Config.Image}}' 2>/dev/null | sed 's/.*sha-//' || echo "")

if [ -n "$CURRENT_SHA" ] && [ ! -d "$HISTORY_DIR/$CURRENT_SHA/_next/static" ]; then
    echo "[deploy] 快照当前版本静态资源: $CURRENT_SHA"
    mkdir -p "$HISTORY_DIR/$CURRENT_SHA/_next"
    docker export "$CONTAINER_NAME" | tar x --strip-components=2 \
        -C "$HISTORY_DIR/$CURRENT_SHA/_next" app/.next/static
    docker export "$CONTAINER_NAME" | tar x --strip-components=2 \
        -C "$HISTORY_DIR/$CURRENT_SHA" app/public 2>/dev/null || true
    echo "[deploy] 快照完成: $(du -sh $HISTORY_DIR/$CURRENT_SHA/ | cut -f1)"
else
    echo "[deploy] 当前版本快照已存在或容器未运行，跳过: $CURRENT_SHA"
fi

# ── 步骤 2: 拉取新镜像 ────────────────────────────────────────────────────
echo "[deploy] 拉取新镜像..."
IMAGE="ghcr.io/newbie5522/newbiechat:$NEW_TAG"
docker pull "$IMAGE"

# ── 步骤 3: 更新 docker-compose.prod.yml 中的镜像标签 ─────────────────────
echo "[deploy] 更新 compose 镜像标签..."

# 修复：匹配 latest 或任意 sha-* 标签，不依赖固定格式
# 原规则：只匹配 sha-[a-f0-9]*，无法处理 latest
# 新规则：匹配整个镜像行，替换标签部分（:后面到行尾或空格前的内容）
BEFORE=$(grep "image:" "$COMPOSE_FILE" | grep "newbiechat" || echo "")
if [ -z "$BEFORE" ]; then
    echo "[deploy] ❌ 错误：compose 文件中找不到 newbiechat 镜像行"
    exit 1
fi

# 用 sed 替换标签（匹配 :latest 或 :sha-xxx）
sed -i "s|ghcr.io/newbie5522/newbiechat:\(latest\|sha-[a-f0-9]*\)|$IMAGE|g" "$COMPOSE_FILE"

# 核对替换结果
AFTER=$(grep "image:" "$COMPOSE_FILE" | grep "newbiechat")
if ! echo "$AFTER" | grep -q "$NEW_TAG"; then
    echo "[deploy] ❌ 错误：镜像标签替换失败"
    echo "[deploy] 期望: $IMAGE"
    echo "[deploy] 实际: $AFTER"
    exit 1
fi
echo "[deploy] 镜像标签已更新: $NEW_TAG"

# ── 步骤 4: 替换式部署 ────────────────────────────────────────────────────
echo "[deploy] 替换容器..."
docker compose -f "$COMPOSE_FILE" up -d --force-recreate

# ── 步骤 5: 等待新容器就绪 ────────────────────────────────────────────────
echo "[deploy] 等待容器就绪..."
for i in $(seq 1 30); do
    STATUS=$(docker inspect "$CONTAINER_NAME" --format '{{.State.Health.Status}}' 2>/dev/null || echo "unknown")
    if [ "$STATUS" = "healthy" ]; then
        echo "[deploy] 容器已就绪 (healthy)"
        break
    fi
    echo "[deploy] 等待中... ($i/30) status=$STATUS"
    sleep 2
done

# ── 步骤 6: 快照新版本静态资源 ────────────────────────────────────────────
NEW_SHA=$(echo "$NEW_TAG" | sed 's/sha-//')
if [ ! -d "$HISTORY_DIR/$NEW_SHA/_next/static" ]; then
    echo "[deploy] 快照新版本静态资源: $NEW_SHA"
    mkdir -p "$HISTORY_DIR/$NEW_SHA/_next"
    docker export "$CONTAINER_NAME" | tar x --strip-components=2 \
        -C "$HISTORY_DIR/$NEW_SHA/_next" app/.next/static
    echo "[deploy] 新版本快照完成"
fi

# ── 步骤 7: 更新合并目录（用新快照覆盖，保留所有历史） ────────────────────
echo "[deploy] 更新静态资源合并目录..."
mkdir -p "$MERGED_DIR/_next"
# 先把最老的版本复制进去（优先级最低），再覆盖以最新版本（优先级最高）
VERSIONS=$(ls -t "$HISTORY_DIR" | head -"$KEEP_VERSIONS")
for V in $(echo "$VERSIONS" | tac); do
    if [ -d "$HISTORY_DIR/$V/_next/static" ]; then
        cp -a "$HISTORY_DIR/$V/_next/static" "$MERGED_DIR/_next/"
    fi
done
echo "[deploy] 合并目录更新完成: $(du -sh $MERGED_DIR/ | cut -f1)"

# ── 步骤 8: 重载 nginx ────────────────────────────────────────────────────
echo "[deploy] 重载 nginx..."
nginx -s reload
echo "[deploy] nginx 已重载"

# ── 步骤 9: 清理旧快照（保留最近 KEEP_VERSIONS 个） ──────────────────────
echo "[deploy] 清理旧快照（保留最近 $KEEP_VERSIONS 个）..."
ls -t "$HISTORY_DIR" | tail -n +$((KEEP_VERSIONS + 1)) | while read OLD; do
    echo "[deploy] 删除旧快照: $OLD"
    rm -rf "$HISTORY_DIR/$OLD"
done
echo "[deploy] 快照目录占用: $(du -sh $HISTORY_DIR/ | cut -f1)"

# ── 完成 ─────────────────────────────────────────────────────────────────
echo "[deploy] ✅ 部署完成: $NEW_TAG"
echo "[deploy] 磁盘使用:"
df -h / | tail -1
