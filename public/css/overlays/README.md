# CSS Overlays 目录

此目录包含所有 overlay 相关的样式文件。

## 📁 文件列表

| 文件 | 说明 | 使用页面 |
|-----|------|---------|
| `base.css` | Overlay 通用样式（布局、面板、标题等） | 所有 overlay 页面 |
| `blindbox.css` | 盲盒盈亏专用样式 | `/blindbox` |
| `desktop.css` | 桌面应用专用样式（Electron） | `/admin?desktop=1` |

## 🎨 样式组织

### base.css
包含所有 overlay 的通用组件：
- `.overlay-body` - overlay 页面的 body 样式
- `.overlay-panel` - 主面板容器
- `.overlay-header` - 顶部标题栏
- `.overlay-content` - 内容区域
- `.overlay-title` - 标题文字

### blindbox.css
盲盒盈亏页面的特定样式：
- 盈亏汇总卡片
- 欧皇榜排行
- 盲盒图标和动画

### desktop.css
桌面应用（Electron）的界面调整：
- 无边框窗口样式
- 标题栏拖拽区域
- 桌面特定的布局调整

## 📝 添加新样式

如果需要为新的 overlay 添加特定样式：

1. 在此目录创建 `{name}.css`
2. 在对应的 HTML 中引用：
   ```html
   <link rel="stylesheet" href="/css/styles-base.css">
   <link rel="stylesheet" href="/css/overlays/base.css">
   <link rel="stylesheet" href="/css/overlays/{name}.css">
   ```

## 🔗 相关目录

- HTML 页面: `public/pages/overlays/`
- JS 脚本: `public/js/overlays/`
