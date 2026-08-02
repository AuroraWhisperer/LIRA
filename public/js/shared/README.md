# JS Shared 目录

此目录包含所有页面共享的工具函数和通用模块。

## 📁 文件列表

| 文件 | 说明 | 主要功能 |
|-----|------|---------|
| `utils.js` | 通用工具函数 | DOM 操作、数据处理、格式化等 |
| `theme.js` | 主题管理 | 主题切换、颜色方案、样式控制 |

## 🔧 utils.js

提供跨页面使用的通用工具函数：
- DOM 操作辅助函数
- 字符串处理和转义
- 时间格式化
- 数据验证
- 其他通用工具

## 🎨 theme.js

管理应用的主题和样式：
- 主题切换（亮色/暗色）
- 主题持久化存储
- 动态样式调整
- 颜色方案管理

## 📝 使用方法

在 HTML 页面中引用：

```html
<!-- 通用工具 -->
<script src="/js/shared/utils.js"></script>

<!-- 主题管理 -->
<script src="/js/shared/theme.js"></script>

<!-- 页面特定脚本 -->
<script src="/js/admin/app.js"></script>
```

## ➕ 添加新的共享模块

1. 在此目录创建新文件（如 `api.js`）
2. 确保模块功能是跨页面通用的
3. 在需要的页面中引用
4. 更新此 README

## 🔗 相关目录

- Admin 脚本: `public/js/admin/`
- Playback 脚本: `public/js/playback/`
- Overlay 脚本: `public/js/overlays/`
