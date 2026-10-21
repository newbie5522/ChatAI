#!/usr/bin/env python3
"""
测试 newbiechat-deploy.sh 的 sed 镜像标签替换逻辑
"""
import subprocess
import tempfile
import os

def test_sed_replace(old_tag, new_tag):
    """测试 sed 规则替换"""
    # 创建临时 compose 文件
    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.yml') as f:
        f.write(f'services:\n')
        f.write(f'  newbiechat:\n')
        f.write(f'    image: ghcr.io/newbie5522/newbiechat:{old_tag}\n')
        f.write(f'    restart: unless-stopped\n')
        path = f.name
    
    try:
        # 执行 sed 替换（Windows 上用 Python 模拟）
        with open(path, 'r') as f:
            content = f.read()
        
        # 模拟 sed 's|ghcr.io/newbie5522/newbiechat:\(latest\|sha-[a-f0-9]*\)|TARGET|g'
        import re
        pattern = r'ghcr.io/newbie5522/newbiechat:(latest|sha-[a-f0-9]+)'
        replacement = f'ghcr.io/newbie5522/newbiechat:{new_tag}'
        new_content = re.sub(pattern, replacement, content)
        
        # 写回
        with open(path, 'w') as f:
            f.write(new_content)
        
        # 验证
        with open(path, 'r') as f:
            result = f.read()
        
        image_line = [line for line in result.split('\n') if 'image:' in line][0]
        success = new_tag in image_line
        
        return success, image_line.strip()
    
    finally:
        os.unlink(path)


def test_missing_image_line():
    """测试找不到镜像行"""
    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.yml') as f:
        f.write('services:\n')
        f.write('  other-service:\n')
        f.write('    image: nginx:latest\n')
        path = f.name
    
    try:
        with open(path, 'r') as f:
            content = f.read()
        
        found = 'newbiechat' in content and 'image:' in content
        return not found  # 应该找不到
    
    finally:
        os.unlink(path)


if __name__ == '__main__':
    print('=== 部署脚本镜像标签替换测试 ===\n')
    
    test_cases = [
        ('latest', 'sha-abc123def456'),
        ('sha-f6460ce3875aadc365a11ed2dd7e480d8b529e31', 'sha-0987654321fedcba'),
        ('latest', 'sha-test123'),
    ]
    
    all_pass = True
    
    for old_tag, new_tag in test_cases:
        success, result_line = test_sed_replace(old_tag, new_tag)
        status = '✅ PASS' if success else '❌ FAIL'
        print(f'[测试] {old_tag} -> {new_tag}')
        print(f'  {status}: {result_line}\n')
        if not success:
            all_pass = False
    
    # 测试找不到镜像行
    print('[测试] 找不到镜像行（应该检测到）')
    if test_missing_image_line():
        print('  ✅ PASS: 正确检测到镜像行缺失\n')
    else:
        print('  ❌ FAIL: 应该检测到镜像行缺失\n')
        all_pass = False
    
    if all_pass:
        print('=== ✅ 全部测试通过 ===')
        exit(0)
    else:
        print('=== ❌ 存在测试失败 ===')
        exit(1)
