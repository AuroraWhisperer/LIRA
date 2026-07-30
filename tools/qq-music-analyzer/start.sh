#!/bin/bash
# QQ音乐API分析工具 - 快速开始脚本

echo "=========================================="
echo "  QQ音乐客户端API分析工具"
echo "=========================================="
echo ""

# 检查Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 未找到Node.js，请先安装 Node.js"
    exit 1
fi

echo "✓ Node.js 版本: $(node --version)"
echo ""

# 显示菜单
echo "请选择操作："
echo ""
echo "1. 启动代理服务器 (简单HTTP代理，不支持HTTPS解密)"
echo "2. 分析捕获的请求 (从 captured-requests.jsonl)"
echo "3. 解析HAR文件 (从Fiddler导出)"
echo "4. 查看使用说明"
echo ""
echo "推荐流程："
echo "  → 使用 Fiddler 抓包 (参考 FIDDLER-GUIDE.md)"
echo "  → 导出为 HAR 文件"
echo "  → 选择选项 3 解析HAR"
echo "  → 选择选项 2 分析请求"
echo ""

read -p "请输入选项 (1-4): " choice

case $choice in
    1)
        echo ""
        echo "启动代理服务器..."
        echo "配置系统代理: 127.0.0.1:8888"
        echo "按 Ctrl+C 停止"
        echo ""
        node proxy-server.js
        ;;
    2)
        echo ""
        if [ ! -f "captured-requests.jsonl" ]; then
            echo "❌ 未找到 captured-requests.jsonl"
            echo "请先使用选项3解析HAR文件，或使用选项1启动代理"
            exit 1
        fi
        node analyze-requests.js
        ;;
    3)
        echo ""
        read -p "请输入HAR文件路径: " har_path
        if [ ! -f "$har_path" ]; then
            echo "❌ 文件不存在: $har_path"
            exit 1
        fi
        node parse-har.js "$har_path"
        ;;
    4)
        echo ""
        cat README.md
        echo ""
        echo "详细的Fiddler使用指南: FIDDLER-GUIDE.md"
        ;;
    *)
        echo "无效的选项"
        exit 1
        ;;
esac
