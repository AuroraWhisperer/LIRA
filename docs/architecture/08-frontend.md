# 前端架构 — Vanilla JS SPA、管理后台、OBS 叠加层、播放助手

> 涉及文件：`public/admin.html`, `public/overlay-*.html`, `public/lyric-window.html`, `public/js/**/*`, `public/styles-*.css`

---

## 技术选型

| 技术 | 说明 |
|------|------|
| **JavaScript (ES Modules + Classic Scripts)** | 无框架、无构建工具、无 TypeScript |
| **原生 CSS** | 按功能页面拆分，无预处理器 |
| **WebSocket** | 实时状态同步（全量快照模式） |
| **Fetch API** | RESTful API 调用 |
| **SVG 图标** | 内联 SVG，无需图标字体 |
| **CSS 变量** | 主题系统基础（通过 JS 动态注入） |

---

## 页面架构

```
public/
├── admin.html              # 管理后台（主页面）
├── overlay-queue.html      # OBS 队列叠加层
├── overlay-songs.html      # OBS 歌单叠加层
├── overlay-blindbox.html   # OBS 盲盒叠加层
├── lyric-window.html       # 独立歌词窗口
├── gift-audit.html         # 礼物审计页面
├── debug-gifts.html        # 礼物调试页面
├── js/
│   ├── utils.js            # 全局工具函数 (window.AdminApp.utils)
│   ├── theme.js            # 主题系统（队列主题 + 歌单主题 + 外观）
│   ├── desktop.js          # 桌面端集成（窗口控件 + 更新 + 桌面歌词控制）
│   ├── admin/              # 管理后台模块
│   │   ├── main.js         # 入口：模块初始化 + WebSocket 连接
│   │   ├── state.js        # 前端状态管理（全局状态对象）
│   │   ├── queue.js        # 队列管理（添加/置顶/完成/删除）
│   │   ├── songs.js        # 歌库管理（CRUD/搜索/导入/分类）
│   │   ├── settings.js     # 设置面板
│   │   ├── theme.js        # 主题预设管理
│   │   ├── display.js      # 显示设置（队列/歌单主题切换）
│   │   ├── forms.js        # 表单辅助
│   │   ├── import.js       # 歌曲批量导入
│   │   ├── gifts.js        # 礼物管理
│   │   ├── metrics.js      # 系统指标展示
│   │   └── desktop-lyric.js# 桌面歌词控制
│   ├── playback/           # 播放助手模块 (ES Module)
│   │   ├── playback.js     # 入口文件 (type="module")
│   │   ├── config.js       # 播放器配置常量
│   │   ├── utils.js        # 播放器工具函数
│   │   ├── state/          # 状态管理
│   │   │   ├── manager.js  # StateManager（响应式状态）
│   │   │   └── storage.js  # StorageManager（持久化）
│   │   ├── api/client.js   # API 客户端（Fetch 封装）
│   │   ├── provider/manager.js # Provider 管理器
│   │   ├── queue/manager.js    # 播放队列管理
│   │   ├── player/controller.js# 播放器控制器（Audio 元素）
│   │   ├── content/loader.js   # 内容加载器（首页/推荐/歌单）
│   │   ├── local/manager.js    # 本地文件管理
│   │   ├── cache/manager.js    # 会话缓存
│   │   ├── services/           # 业务服务
│   │   │   ├── search-service.js  # 搜索服务
│   │   │   ├── stream-service.js  # 播放流服务
│   │   │   ├── lyric-service.js   # 歌词服务
│   │   │   ├── match-service.js   # 匹配服务
│   │   │   ├── import-service.js  # 导入服务
│   │   │   └── home-service.js    # 首页服务
│   │   └── ui/                   # UI 渲染
│   │       ├── index.js          # UIRenderer（主渲染器）
│   │       ├── components.js     # UI 组件生成
│   │       ├── playback-bar.js   # 播放控制栏
│   │       ├── queue-popup.js    # 队列弹出窗口
│   │       ├── drawer.js         # 抽屉面板
│   │       └── fullscreen.js     # 全屏模式
├── styles-base.css          # 基础样式（重置/变量/布局）
├── styles-admin.css         # 管理后台样式
├── styles-playback.css      # 播放助手样式
├── styles-desktop.css       # 桌面端特有样式（标题栏/窗口控件）
├── styles-overlay.css       # OBS 叠加层样式
├── styles-blindbox-overlay.css # 盲盒叠加层样式
└── img/                     # 图片资源
    ├── qqmusic-icon.png
    ├── bilibili-guard-*.png  # 大航海等级图标
    ├── bilibili-blindbox-*.png # 盲盒图标
    ├── gift-section-icon.png
    └── player-turntable-chassis.png # 播放器唱片机底盘
```

---

## 管理后台 (`admin.html`)

### 加载顺序

```
1. CSS（base → admin → playback → desktop）
2. <script> 标签（顺序加载，依赖链）
   utils.js → theme.js → desktop.js → admin/*.js → admin/main.js
3. ES Module
   js/playback.js (type="module")
```

### 页面结构

```
┌─────────────────────────────────────────────────────────┐
│ 标题栏 (topbar)                                          │
│ ┌──────────┐ ┌─────────────┐ ┌───────────────────────┐  │
│ │ Logo+名称 │ │ 主Tab导航    │ │ 状态条 + 窗口控件      │  │
│ │ 点歌助手   │ │ [点歌][播放] │ │ WS状态 直播状态 退出   │  │
│ └──────────┘ └─────────────┘ └───────────────────────┘  │
├─────────────────────────────────────────────────────────┤
│ 主内容区                                                  │
│ ┌──────────────────────┐ ┌────────────────────────────┐ │
│ │ 点歌助理页              │ │ 播放助手页                  │ │
│ │ (songAssistantPage)    │ │ (playbackAssistantPage)    │ │
│ │                        │ │                            │ │
│ │ ┌────────────────────┐ │ │ ┌────────────────────────┐ │ │
│ │ │ 左侧面板            │ │ │ │ 首页 / 搜索 / 歌单      │ │ │
│ │ │ • 点歌队列          │ │ │ │ • 推荐歌单              │ │ │
│ │ │ • 队列操作          │ │ │ │ • 每日推荐              │ │ │
│ │ │ • 置顶/完成/删除    │ │ │ │ • 搜索结果              │ │ │
│ │ └────────────────────┘ │ │ │ • 播放列表              │ │ │
│ │ ┌────────────────────┐ │ │ └────────────────────────┘ │ │
│ │ │ 右侧面板            │ │ │ ┌────────────────────────┐ │ │
│ │ │ • 歌库管理          │ │ │ │ 播放控制栏（底部）       │ │ │
│ │ │ • 歌曲搜索          │ │ │ │ • 进度条                │ │ │
│ │ │ • 分类过滤          │ │ │ │ • 播放/暂停/上下首      │ │ │
│ │ │ • 批量导入          │ │ │ │ • 音量调节              │ │ │
│ │ │ • 设置面板          │ │ │ │ • 歌词显示              │ │ │
│ │ │ • 礼物记录          │ │ │ │ • 队列弹出              │ │ │
│ │ └────────────────────┘ │ │ └────────────────────────┘ │ │
│ └──────────────────────┘ └────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 全局命名空间

```javascript
window.AdminApp = {
  utils:    { escapeHtml, escapeAttr, formatBytes, toast, showError, api, readJsonResponse, ... },
  state:    { queue, songs, categories, settings, gifts, superChats, liveStatus, ... },
  queue:    { init, render, addSong, pinItem, completeItem, deleteItem, ... },
  songs:    { init, render, search, filter, edit, delete, import: {...}, ... },
  settings: { init, render, get, set, ... },
  theme:    { init, render, ... },
  display:  { init, ... },
  gifts:    { init, render, ... },
  metrics:  { init, ... },
  desktopLyric: { init, ... },
  playback: { initPlaybackAssistant, ... }
};
```

---

## OBS 叠加层

### 设计理念

三个叠加层页面通过浏览器源 (Browser Source) 嵌入 OBS，透明背景 + 圆角卡片设计，适合直播画面叠加。

### overlay-queue.html — 队列叠加层

```
展示当前点歌队列
  - 歌曲名 + 歌手
  - 点歌观众名（含粉丝牌/大航海标识）
  - 滚动展示
  - 多种主题（11 种预设风格）
```

### overlay-songs.html — 歌单叠加层

```
展示歌库内容
  - 分类标签导航
  - 歌曲列表（可配置列数/字号/颜色）
  - 6 种主题预设
```

### overlay-blindbox.html — 盲盒叠加层

```
展示盲盒礼物统计
  - 盲盒名称 + 数量
  - 收益统计
  - 专属视觉效果
```

### WebSocket 同步

```javascript
// 每个叠加层都独立连接 WebSocket
const ws = new WebSocket(`ws://${location.host}/ws`);

ws.onmessage = (event) => {
  const { type, reason, state } = JSON.parse(event.data);
  if (type === 'snapshot') {
    // 全量替换本地状态 → 重新渲染
    updateDisplay(state);
  }
};
```

> 叠加层使用**状态指纹**（JSON hash）去重：相同学快照不重复渲染，节省 CPU。

---

## 播放助手 (`js/playback.js` + `js/playback/*`)

### 模块架构（ES Module）

```
playback.js (入口)
    │
    ├─ StateManager        # 响应式状态对象
    ├─ StorageManager      # 持久化存储（通过 playback:save-state IPC）
    ├─ ProviderManager     # 音乐平台选择 + 健康检查
    ├─ ContentLoader       # 首页/推荐/歌单内容加载
    ├─ CacheManager        # 会话级内存缓存（关闭即清）
    ├─ QueueManager        # 播放队列逻辑
    ├─ PlayerController    # Audio 元素控制
    ├─ LocalFileManager    # 本地音频文件
    ├─ UIRenderer          # DOM 渲染主控
    │
    └─ Services
        ├─ SearchService   # 统一搜索（各 Provider）
        ├─ StreamService   # 播放流 URL 解析
        ├─ LyricService    # 歌词获取 + 高亮
        ├─ MatchService    # 歌曲匹配
        ├─ ImportService   # 导入到歌库
        └─ HomeService     # 首页内容
```

### 播放核心流程

```
用户点击播放
    │
    ├─ 1. 选择 Provider（QQ音乐/网易云/本地）
    ├─ 2. resolvePlayableUrl(track)
    │   ├─ 调用 /api/music/stream?source=qq&trackId=xxx
    │   └─ 缓存 URL（5 分钟 TTL）
    ├─ 3. Audio 元素加载播放
    │   ├─ 本地文件：local-media:// 协议
    │   └─ 在线：直链 URL（带 Referer 头）
    ├─ 4. 歌词同步
    │   ├─ 获取歌词 → 解析时间轴
    │   └─ timeupdate 事件 → 高亮当前行
    ├─ 5. 播放历史
    │   └─ 定时保存到 play_history 表
    └─ 6. 自动下一首
        └─ ended 事件 → 从队列取出下一首
```

---

## 样式系统

### CSS 文件分工

| 文件 | 职责 |
|------|------|
| `styles-base.css` | CSS 变量、重置、通用布局、按钮基类、表单元素 |
| `styles-admin.css` | 管理后台：顶栏、面板、队列列表、歌库表格、设置表单 |
| `styles-playback.css` | 播放助手：封面、进度条、歌词、歌单网格、播放栏 |
| `styles-desktop.css` | 桌面端：无框窗口、标题栏拖拽区、窗口控件按钮 |
| `styles-overlay.css` | OBS 叠加层：透明背景、卡片样式、滚动动画 |
| `styles-blindbox-overlay.css` | 盲盒叠加层：专属动画效果 |

### CSS 变量（主题基础）

```css
:root {
  --bg: #f7f3ef;
  --bg-card: #ffffff;
  --text-primary: #2c2c2c;
  --text-secondary: #888888;
  --accent: #ff6b35;        /* 品牌暖橙色 */
  --accent-hover: #e85d2c;
  --border: #e8e4df;
  --shadow: 0 2px 8px rgba(0,0,0,0.06);
  --radius: 12px;

  /* 队列主题变量 */
  --queue-bg, --queue-text, --queue-accent, ...
  /* 歌单主题变量 */
  --songboard-bg, --songboard-text, ...
}
```

### 设计风格

- **配色**：暖色扁平化，`#f7f3ef` 暖白背景 + `#ff6b35` 橙色强调
- **圆角**：统一 `12px` 卡片圆角（现代表达）
- **阴影**：轻量阴影，不喧宾夺主
- **字体**：系统字体栈（Windows：Microsoft YaHei / PingFang SC）
- **间距**：8px 基础网格（舒适呼吸感）
- **图标**：内联 SVG，通过 `currentColor` 自动适配主题色
- **桌面端**：自绘无框窗口，`-webkit-app-region: drag` 标题栏可拖拽

---

## 前端通信模式

### WebSocket（实时状态）

```
前端 ←──WebSocket 快照── 后端
  │
  ├─ 连接时：收到完整快照 → 初始化所有 UI
  ├─ 状态变更：收到增量 reason → 全量替换 state → 局部更新 UI
  └─ 关机通知：收到 shutdown → 显示断开提示
```

### Fetch API（命令式操作）

```
前端 ──POST /api/songs/save──▶ 后端
     ◀──{ ok: true, data: {...} }──

前端 ──POST /api/queue/add──▶ 后端
     ◀──{ ok: true }──
     (后端自动触发 WebSocket 广播)
```
