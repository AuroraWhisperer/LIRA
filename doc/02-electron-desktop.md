# Electron 桌面层 — 窗口管理、IPC、登录态、自动更新

> 涉及文件：`src/electron/main.js`, `src/electron/preload.js`, `src/electron/auth-manager.js`, `src/electron/bilibili-auth.js`, `src/electron/login-window.js`, `src/electron/lyric-window.js`, `src/electron/update-manager.js`

---

## 技术选型

| 技术 | 用途 |
|------|------|
| **Electron 43.2.0** | 桌面应用框架 |
| **contextIsolation + preload** | 安全隔离渲染进程 |
| **Chromium Session Cookies** | 持久化分区存储登录态 |
| **electron-updater 6.x** | 自动更新（GitHub Releases） |
| **Node.js crypto** | Cookie 快照加密 |
| **local-media:// 协议** | 本地音频文件播放（支持 Range 请求） |

---

## 架构概览

```
Electron Main Process (src/electron/main.js)
│
├─ app 生命周期管理
│   ├─ single-instance-lock（单实例）
│   ├─ userData 目录重定向（→ 安装目录/data/）
│   ├─ before-quit → 优雅关闭
│   └─ window-all-closed → app.quit()
│
├─ 窗口管理
│   ├─ BrowserWindow (主窗口, 无框)
│   ├─ 登录窗口（QQ音乐 / 网易云 / Bilibili）
│   └─ 歌词独立窗口（置顶 + 可锁定）
│
├─ IPC 处理器（3 组）
│   ├─ desktop:* — 窗口控制 / 更新 / 重启
│   ├─ music:* — 音乐平台登录 / 本地文件 / 歌词窗口
│   └─ bilibili:* — Bilibili 登录
│
├─ 自定义协议
│   └─ local-media:// — 本地音频文件读取
│
├─ 请求头注入（webRequest.onBeforeSendHeaders）
│   ├─ 音乐媒体域名（Referer / Origin）
│   └─ Bilibili 媒体域名（Referer / Origin）
│
└─ HTTP Server 同进程加载
    └─ require('../server').startServer({...})
```

---

## 启动流程详解

```
app.whenReady()
    │
    ├─ configureDesktopEnvironment()
    │   ├─ dataDir = userData → 安装目录/data/
    │   ├─ logDir / logFile → 安装目录/logs/desktop.log
    │   ├─ SONG_PLUGIN_DATA_DIR = dataDir
    │   └─ ELECTRON_DESKTOP = '1'
    │
    ├─ migrateUserDataFromAppData()
    │   └─ 旧版 %APPDATA% 分区 → 新 userData 目录
    │
    ├─ configureMenu() → Menu.setApplicationMenu(null)
    │
    ├─ configureLocalMediaProtocol()
    │   └─ protocol.handle('local-media', ...)
    │
    ├─ configureUpdateIpc() / configureMusicIpc() / configureBilibiliIpc()
    │
    ├─ configureMusicMediaRequestHeaders()
    ├─ configureBilibiliMediaRequestHeaders()
    │
    ├─ updateMgr.configureAutoUpdater()
    │
    ├─ restoreMusicCookieSnapshots() → 恢复所有音乐平台登录态
    ├─ restoreBilibiliCookieSnapshot() → 恢复 Bilibili 登录态
    │
    ├─ require('../server').startServer({
    │     host: '127.0.0.1',
    │     musicAuth: { getAuthState, getCookieHeader },
    │     bilibiliAuth: { getAuthState, getCookieHeader, getUid }
    │   })
    │
    └─ createMainWindow(baseUrl)
        ├─ 加载 /admin?desktop=1
        ├─ maximize() → show()
        └─ 延迟自动检查更新（打包版）
```

---

## 窗口管理

### 主窗口 (Main BrowserWindow)

```
属性：
  - width: 1280, height: 800 (min: 1024×680)
  - frame: false（自绘标题栏）
  - backgroundColor: #f7f3ef（暖色背景，消除白屏闪烁）
  - preload: src/electron/preload.js
  - contextIsolation: true
  - nodeIntegration: false
  - sandbox: false

标题栏：
  - 自绘窗口控件（最小化/最大化/关闭）
  - windowControls 区域通过 IPC 控制
  - 最大化状态通过 desktop:window-maximized 事件同步

导航策略：
  - 外部 URL → shell.openExternal（默认浏览器）
  - 内部 URL（同 baseUrl）→ 正常导航
```

### 登录窗口

**音乐平台登录**（QQ音乐/网易云）：
- 使用独立的 Chromium partition（如 `persist:qqmusic-login`）
- 监听 cookie 变化 → 延迟 800ms 保存快照
- 每 1.5s 轮询登录状态 → 登录成功自动关闭

**Bilibili 登录**：
- 同上模式，partition: `persist:bilibili-login`
- 额外的 `permissionRequestHandler`（拒绝所有权限请求）

### 歌词独立窗口

- 独立 BrowserWindow
- `alwaysOnTop: true` — 始终置顶
- `frame: false` — 无边框
- 可锁定（`setIgnoreMouseEvents`）— 鼠标穿透
- 通过 IPC 实时同步歌词内容

---

## 登录态管理

### auth-manager.js（音乐平台）

```
Cookie 存储流程：
  登录窗口用户操作
  → Chromium session cookies 自动持久化
  → cookieChanged 事件
  → 延迟 800ms 防抖
  → persistCookieSnapshot(platform, dataDir)
  → 加密快照写入 dataDir/cookies-{platform}.json

Cookie 恢复流程：
  启动时 restoreCookieSnapshot(platform, dataDir)
  → 读取加密快照
  → 写入 Chromium session
  → getAuthState() 验证有效性

平台配置 (MUSIC_LOGIN_CONFIG)：
  - qq: QQ音乐 (https://y.qq.com)
  - netease: 网易云音乐 (https://music.163.com)
```

### bilibili-auth.js

```
BILIBILI_LOGIN_CONFIG:
  - partition: 'persist:bilibili-login'
  - loginUrl: 'https://passport.bilibili.com/login'

Cookie 验证：
  - SESSDATA cookie 存在 → 已登录
  - DedeUserID cookie → uid
  - bili_jct → CSRF token (用于 API 签名)
```

---

## IPC 通信（preload.js）

### 安全模型

```
Renderer Process (沙箱)
    │
    ├─ contextIsolation: true
    ├─ nodeIntegration: false
    │
    └─ preload.js (contextBridge)
        ├─ window.songAssistantDesktop
        │   ├─ getInfo()
        │   ├─ checkForUpdates()
        │   ├─ downloadUpdate()
        │   ├─ installUpdate()
        │   ├─ restart()
        │   ├─ closeWindow()
        │   ├─ minimizeWindow()
        │   ├─ maximizeWindow()
        │   ├─ openDataDir()
        │   ├─ openLogDir()
        │   └─ openGithub()
        │
        ├─ window.musicAPI
        │   ├─ getAuthState(platform)
        │   ├─ login(platform)
        │   ├─ logout(platform)
        │   ├─ openLyricWindow()
        │   ├─ closeLyricWindow()
        │   ├─ updateLyricWindow(state)
        │   ├─ setLyricWindowLocked(locked)
        │   ├─ providerHealth(platform)
        │   ├─ selectLocalFiles()
        │   └─ resolveLocalMediaUrls(paths)
        │
        └─ window.bilibiliAuth
            ├─ getAuthState()
            ├─ login()
            └─ logout()
```

### 播放器状态持久化

```
Renderer (播放器状态)
    → 定时保存 (5s 防抖)
    → IPC: playback:save-state
    → Main Process: persistPlaybackSnapshot()
    → Server: domainServices.playback.saveQueueState()
    → SQLite: play_queue_state table

应用关闭时：
    → Main: requestPlaybackFlush()
    → 发送 app:prepare-shutdown 到 Renderer
    → Renderer 立即保存状态
    → 回报 playback:flush-ack
    → Main 继续关闭流程
    → 超时 2s 安全网（防止渲染进程卡死阻塞关闭）
```

---

## 自定义协议：local-media://

### 用途

允许前端 `<audio>` 标签播放本地文件，同时绕过 Chromium 的本地文件安全限制。

### 协议格式

```
local-media://media/<base64url-encoded-absolute-path>
```

### 功能特性

- **Range 请求支持**：完整实现 HTTP 206 Partial Content，支持音频 seek
- **MIME 推断**：根据扩展名（.mp3/.flac/.wav/.aac/.ogg/.m4a/.wma）
- **安全**：仅响应存在的文件路径
- **缓存控制**：`Cache-Control: no-store`（本地文件无需缓存）

---

## 请求头注入

Chromium 的 webRequest API 用于自动添加 Referer/Origin 头，确保第三方 API 请求不被拒绝：

**音乐域名**：
```
*.music.163.com, *.music.126.net → Referer: https://music.163.com/
*.qqmusic.qq.com, *.gtimg.cn, *.y.qq.com → Referer: https://y.qq.com/, Origin: https://y.qq.com
```

**Bilibili 域名**：
```
*.bilibili.com, *.hdslb.com → Referer: https://www.bilibili.com/, Origin: https://www.bilibili.com
```

---

## 自动更新：update-manager.js

### 流程

```
启动（打包版 + 开启自动更新）
    → 延迟 1s → checkForUpdates()
    → electron-updater 检查 GitHub Releases
    → latest.yml 比对版本号
    → 有新版本 → 显示更新提示
    → 用户点击下载 → downloadUpdate()
    → 下载完成 → 显示安装按钮
    → 用户点击安装 → installUpdate()
    → 保存播放器状态 → quitAndInstall()
```

### 状态机

```
idle → checking → update-available → downloading → downloaded → installing
  │        │              │               │             │
  └────────┴──────────────┴───────────────┴─────────────┘
                    各种错误状态（error / dev-disabled / no-update）
```

### 发布配置

```json
// package.json → build.publish
{
  "provider": "github",
  "owner": "AuroraWhisperer",
  "repo": "Request-song",
  "releaseType": "release"
}
```

---

## 优雅关闭序列

```
用户关闭窗口 / before-quit 事件
    │
    ├─ gracefulQuitStarted = true（防重入）
    ├─ 5000ms 超时安全网 → app.exit(0)
    │
    ├─ shutdownApplication({ exitProcess: false })
    │   ├─ preShutdownHook → requestPlaybackFlush()
    │   │   └─ IPC: app:prepare-shutdown → Renderer 保存状态
    │   ├─ bilibiliClient.stop()
    │   ├─ WebSocket 断开通知
    │   ├─ server.close()
    │   ├─ optimizeDatabases()
    │   └─ closeDatabases()
    │
    ├─ 清除超时安全网
    ├─ app.releaseSingleInstanceLock()
    └─ app.exit(0)
```
