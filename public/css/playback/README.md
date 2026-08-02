# Playback CSS 模块化说明

## 📁 文件结构

原来的 `styles-playback.css` (3179行) 已被拆分为以下模块：

```
public/css/playback/
├── layout.css          (26行)  - 播放页整体布局
├── header.css         (117行)  - 头部区域和信源切换
├── panels.css         (768行)  - 各种面板（发现页、搜索、匹配、队列）
├── song-row.css        (40行)  - 歌曲行通用组件
├── player.css         (564行)  - 播放器面板
├── drawer.css         (195行)  - 右侧滑出抽屉
├── desktop-lyric.css   (53行)  - 桌面歌词窗口
├── queue-modal.css    (142行)  - 播放队列弹窗
├── fullscreen.css     (671行)  - 全屏播放器
├── responsive.css     (424行)  - 响应式样式
└── dialogs.css        (180行)  - 确认对话框
```

总计：**3180行**（与原文件基本一致）

## 📦 模块说明

### layout.css
播放页整体布局：
- `.playback-page` - 播放页容器
- 网格布局定义

### header.css
头部区域：
- `.playback-page-header` - 页面头部
- `.playback-account-compact` - 账号状态
- `.source-tabs` - 信源切换标签（QQ音乐/网易云等）

### panels.css
各种功能面板：
- `.playback-grid` - 播放页网格
- `.user-info-panel` - 用户信息 & 缓存
- `.discovery-panel` - 发现页（首页推荐）
- `.search-panel` - 搜索面板
- `.match-panel` - 匹配面板
- `.queue-panel` - 队列列表

### song-row.css
歌曲行通用组件：
- `.song-row` - 歌曲行样式
- 歌曲信息显示

### player.css
播放器面板：
- `.player-dock` - 固定底部停靠
- `.player-cover` - 封面
- `.player-info` - 当前歌曲信息
- `.player-progress` - 进度条
- `.player-controls` - 控制区
- `.player-mode-btn` - 播放模式按钮
- `.player-play-btn` - 播放/暂停主按钮
- `.player-volume` - 音量控件

### drawer.css
右侧滑出抽屉：
- `.drawer` - 抽屉容器
- 滑出动画效果

### desktop-lyric.css
桌面歌词窗口：
- `.desktop-lyric-window` - 桌面歌词窗口样式

### queue-modal.css
播放队列弹窗：
- `.queue-modal` - 队列弹窗
- `.queue-empty` - 队列空状态

### fullscreen.css
全屏播放器：
- `.fullscreen-player` - 全屏播放器
- `.fullscreen-lyric` - 全屏歌词
- 歌词模式切换按钮

### responsive.css
响应式样式，包含各种屏幕尺寸的适配。

### dialogs.css
确认对话框：
- `.confirm-dialog` - 通用确认对话框

## 🔧 使用方式

主文件 `public/styles-playback.css` 现在只包含 `@import` 语句，自动导入所有模块。

HTML 中无需修改引用：
```html
<link rel="stylesheet" href="/styles-playback.css">
```

## ✅ 优点

1. **易于维护** - 每个模块职责单一，修改播放器只需关注 player.css
2. **减少冲突** - 团队协作时不同人可以修改不同模块
3. **提高 AI 效率** - AI 修改代码时可以只加载需要的模块，避免超出上下文长度
4. **更好的组织** - 按功能分类，代码结构更清晰

## 📝 备份

原始文件已备份为 `public/styles-playback-original.css`
