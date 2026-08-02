# Admin CSS 模块化说明

## 📁 文件结构

原来的 `styles-admin.css` (3967行) 已被拆分为以下模块：

```
public/css/admin/
├── layout.css         (253行) - 基础布局和面板
├── collapsible.css    (242行) - 折叠组件
├── tabs.css           (252行) - 标签页系统
├── toasts.css         (985行) - Toast 通知
├── gifts.css          (934行) - 礼物相关样式
├── workspace.css      (612行) - 工作区布局
├── modals.css         (358行) - 确认弹窗
└── responsive.css     (326行) - 响应式样式
```

总计：**3962行**（与原文件基本一致）

## 📦 模块说明

### layout.css
基础布局组件，包括：
- `.app-shell` - 应用外壳
- `.topbar` - 顶部导航栏
- `.panel` - 面板容器
- `.layout`, `.stack` - 布局网格
- `.grid-2`, `.grid-3` - 网格系统

### collapsible.css
可折叠面板组件：
- `.section-toggle` - 折叠按钮
- `.collapsible-panel-body` - 可折叠内容区

### tabs.css
标签页系统：
- `.tabs`, `.tab` - 标签页容器和标签
- `.tab-overflow` - 标签页溢出菜单
- `.tab-page` - 标签页内容

### toasts.css
各种 Toast 通知样式：
- `.toast` - 基础 Toast
- `.playback-login-toast` - 登录提示
- `.playback-empty-queue-toast` - 队列为空提示
- `.playback-health-toast-*` - 音乐接口检查结果
- `.admin-live-refresh-toast` - 直播状态刷新

### gifts.css
礼物相关功能：
- 礼物通知 Toast
- 礼物检测面板
- 最近礼物卡片
- 月底冲刺功能
- 礼物流水抽屉

### workspace.css
工作区布局：
- 点歌工作区
- 礼物工作区
- 队列显示
- 工具区域

### modals.css
确认弹窗：
- `.confirm-modal` - 通用确认弹窗
- `.danger-confirm` - 危险操作确认

### responsive.css
响应式样式，包含各种屏幕尺寸的适配。

## 🔧 使用方式

主文件 `public/styles-admin.css` 现在只包含 `@import` 语句，自动导入所有模块。

HTML 中无需修改引用：
```html
<link rel="stylesheet" href="/styles-admin.css">
```

## ✅ 优点

1. **易于维护** - 每个模块职责单一，修改时只需关注相关文件
2. **减少冲突** - 团队协作时不同人可以修改不同模块
3. **提高 AI 效率** - AI 修改代码时可以只加载需要的模块，避免超出上下文长度
4. **更好的组织** - 按功能分类，代码结构更清晰

## 📝 备份

原始文件已备份为 `public/styles-admin-original.css`
