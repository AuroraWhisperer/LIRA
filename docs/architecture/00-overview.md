# 点歌助手 — 项目架构文档索引

> Bilibili 直播间点歌助手 (Bilibili Live Song Request Assistant)
> v1.6.6 | 作者：Aurora | Node.js ≥24 | Electron 43

---

## 文档导航

| 编号 | 文档 | 内容 |
|------|------|------|
| **00** | 本文件 | 架构文档索引 + 技术栈速览 |
| **01** | [服务器核心](01-server-core.md) | HTTP 服务器、WebSocket 自实现、API 路由、生命周期、端口管理 |
| **02** | [Electron 桌面层](02-electron-desktop.md) | 窗口管理、IPC 通信、local-media:// 协议、自动更新 |
| **03** | [QQ音乐 Provider](03-qq-music-provider.md) | 13 个 API 端点逐行文档、GTK 签名、QRC 歌词解密、Cookie 分析 |
| **04** | [网易云音乐 Provider](04-netease-music-provider.md) | 12 个 API 端点逐行文档、weapi 双层 AES+RSA 加密、歌词解析 |
| **05** | [认证与登录](05-auth-login.md) | Chromium 分区、DPAPI 加密快照、登录窗口、Cookie 生命周期 |
| **06** | [Bilibili 直播协议](06-bilibili-protocol.md) | WebSocket 二进制协议、Protobuf 解码、WBI 签名、Brotli 解压、礼物/SC 解析 |
| **07** | [存储与数据库](07-storage-database.md) | 4 库 SQLite 架构、完整 DDL、增量迁移器、数据保留策略 |
| **08** | [前端架构](08-frontend.md) | Vanilla JS SPA、OBS 叠加层、播放助手、CSS 主题系统 |
| **09** | [构建与发布](09-build-deploy.md) | electron-builder、NSIS 安装包、GitHub Releases、自动更新流程 |

---

## 进程模型

```
┌──────────────────────────────────────────┐
│           Electron Main Process           │
│  • app 生命周期                            │
│  • BrowserWindow 管理 (无框窗口)            │
│  • IPC handlers (desktop/music/bilibili)  │
│  • Chromium Cookie 分区 + DPAPI 加密快照    │
│  • local-media:// 自定义协议处理             │
│  • webRequest 请求头注入                    │
│  • electron-updater 自动更新               │
└──────────────┬───────────────────────────┘
               │ require('../server')  同进程
               ▼
┌──────────────────────────────────────────┐
│         Node.js HTTP Server               │
│  • 原生 http.createServer                 │
│  • 手写 WebSocket (RFC 6455)              │
│  • /api/* 路由分发 (12 个模块)             │
│  • Bilibili 弹幕 WebSocket 客户端          │
│  • 4 个 SQLite 数据库                         │
└──────────────┬───────────────────────────┘
               │ HTTP + WebSocket
               ▼
┌──────────────────────────────────────────┐
│        Renderer Process (Chromium)        │
│  • admin.html (管理后台)                   │
│  • overlay-*.html (OBS 叠加层)             │
│  • lyric-window.html (独立歌词窗口)         │
│  • contextIsolation: true                 │
└──────────────────────────────────────────┘
```

---

## 领域架构

```
server.js (编排层)
    │
    ├─ domain-services.js (领域组装)
    │   ├─ songs     → song-service.js     → songDb
    │   ├─ queue     → queue-service.js    → songDb
    │   ├─ gifts     → gift-service.js     → giftDb
    │   ├─ superChats → superchat-service.js → superChatDb
    │   ├─ messages  → bilibili-message-handler.js
    │   ├─ playback  → playback-store.js   → musicDb
    │   ├─ theme     → theme-store.js      → songDb
    │   └─ data      → retention.js        → all DBs
    │
    ├─ BilibiliDanmakuClient
    │   ├─ BilibiliApiClient (HTTP: 6 个端点)
    │   ├─ WebSocketConnection (二进制帧 + 心跳)
    │   ├─ MessageHandlers (弹幕/SC/礼物分发)
    │   ├─ HistoryPoller (降级: 2.5s 轮询)
    │   ├─ OnlineRankPoller (身份: 60s 轮询)
    │   └─ LiveStatusMonitor (开播: 10min)
    │
    ├─ MusicProviderRegistry
    │   ├─ QQMusicProvider (13 个端点, GTK 签名, QRC 解密)
    │   └─ NeteaseMusicProvider (12 个端点, weapi 加密)
    │
    └─ storage/ (SQLite × 4)
        ├─ song-request-data.db (8 表)
        ├─ super-chat-data.db (1 表)
        ├─ gift-data.db (1 表)
        └─ music-data.db (5 表)
```

---

## 技术栈速查

| 层 | 技术 |
|----|------|
| 运行时 | Node.js ≥24, Electron 43.2.0 |
| 后端 | 原生 `http` 模块 (零框架), 手写 WebSocket |
| 数据库 | `node:sqlite` DatabaseSync (同步), WAL 模式, 4 库 |
| 前端 | Vanilla JS (ES Modules + Classic Scripts), 原生 CSS |
| 构建 | electron-builder 26.x (NSIS), electron-updater 6.x |
| 加密 | Node crypto (AES-128-CBC, RSA 1024-bit, SHA1), DPAPI (safeStorage) |
| 协议 | Bilibili 直播 WebSocket (Brotli + Protobuf), QQ GTK 签名, 网易云 weapi |
| 压缩 | zlib.brotliDecompressSync, zlib.inflateSync |

## 第三方依赖

| 包 | 版本 | 用途 |
|----|------|------|
| `@jixun/qmweb-sign` | 2.0.3 | QQ音乐 zzcSign 请求签名 |
| `qrc-decoder` | 1.0.2 | QQ音乐 QRC 歌词 3DES 解密 |
| `electron-updater` | ^6.8.4 | 应用内自动更新 |

> 只有 3 个运行时依赖，其余全部手写。
