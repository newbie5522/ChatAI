#!/bin/bash
# 测试 newbiechat-deploy.sh 的 sed 镜像标签替换逻辑

set -e

echo "=== 部署脚本镜像标签替换测试 ==="

# 测试场景 1: latest -> sha-xxx
echo -e "\n[测试 1] latest -> sha-xxx"
cat > /tmp/test-compose-1.yml << 'EOF'
services:
  newbiechat:
    image: ghcr.io/newbie5522/newbiechat:latest
    restart: unless-stopped
EOF

NEW_TAG="sha-abc123def456"
IMAGE="ghcr.io/newbie5522/newbiechat:$NEW_TAG"
sed "s|ghcr.io/newbie5522/newbiechat:\(latest\|sha-[a-f0-9]*\)|$IMAGE|g" /tmp/test-compose-1.yml

RESULT=$(grep "image:" /tmp/test-compose-1.yml)
if echo "$RESULT" | grep -q "$NEW_TAG"; then
    echo "✅ PASS: $RESULT"
else
    echo "❌ FAIL: $RESULT"
    exit 1
fi

# 测试场景 2: sha-old -> sha-new
echo -e "\n[测试 2] sha-old -> sha-new"
cat > /tmp/test-compose-2.yml << 'EOF'
services:
  newbiechat:
    image: ghcr.io/newbie5522/newbiechat:sha-f6460ce3875aadc365a11ed2dd7e480d8b529e31
    restart: unless-stopped
EOF

NEW_TAG="sha-0987654321fedcba"
IMAGE="ghcr.io/newbie5522/newbiechat:$NEW_TAG"
sed -i "s|ghcr.io/newbie5522/newbiechat:\(latest\|sha-[a-f0-9]*\)|$IMAGE|g" /tmp/test-compose-2.yml

RESULT=$(grep "image:" /tmp/test-compose-2.yml)
if echo "$RESULT" | grep -q "$NEW_TAG"; then
    echo "✅ PASS: $RESULT"
else
    echo "❌ FAIL: $RESULT"
    exit 1
fi

# 测试场景 3: 找不到镜像行
echo -e "\n[测试 3] 找不到镜像行（应该失败）"
cat > /tmp/test-compose-3.yml << 'EOF'
services:
  other-service:
    image: nginx:latest
EOF

BEFORE=$(grep "image:" /tmp/test-compose-3.yml | grep "newbiechat" || echo "")
if [ -z "$BEFORE" ]; then
    echo "✅ PASS: 正确检测到镜像行缺失"
else
    echo "❌ FAIL: 应该检测到镜像行缺失"
    exit 1
fi

# 测试场景 4: 有额外空格或缩进
echo -e "\n[测试 4] 不同缩进和空格"
cat > /tmp/test-compose-4.yml << 'EOF'
services:
  newbiechat:
          image:    ghcr.io/newbie5522/newbiechat:latest
    restart: unless-stopped
EOF

NEW_TAG="sha-test123"
IMAGE="ghcr.io/newbie5522/newbiechat:$NEW_TAG"
sed -i "s|ghcr.io/newbie5522/newbiechat:\(latest\|sha-[a-f0-9]*\)|$IMAGE|g" /tmp/test-compose-4.yml

RESULT=$(grep "image:" /tmp/test-compose-4.yml)
if echo "$RESULT" | grep -q "$NEW_TAG"; then
    echo "✅ PASS: $RESULT"
else
    echo "❌ FAIL: $RESULT"
    exit 1
fi

# 清理
rm -f /tmp/test-compose-*.yml

echo -e "\n=== ✅ 全部测试通过 ==="
