# 辅助窗口:歌词窗、音乐登录窗、B站登录窗

> 涉及文件:[src/electron/lyric-window.js](../../../src/electron/lyric-window.js)、[src/electron/login-window.js](../../../src/electron/login-window.js)、[src/electron/bilibili-login-window.js](../../../src/electron/bilibili-login-window.js)

主窗口规格见 [main.md](main.md);登录分区、登录 URL、Cookie 快照与检测语义的事实由 [auth.md](auth.md) 持有(本文件只描述**窗口行为**);全部 IPC 通道见 [preload.md](preload.md) §2。

## 1. 歌词窗(lyric-window.js)

| 事实 | 值 | 出处 |
|---|---|---|
| 尺寸 | 840×128,minWidth 280,minHeight 64 | [lyric-window.js:15-18](../../../src/electron/lyric-window.js#L15-L18) |
| 窗口形态 | `frame:false`、`transparent:true`、`alwaysOnTop:true`(置顶)、`skipTaskbar:true`、`hasShadow:false`、`resizable:true` | [lyric-window.js:19-26](../../../src/electron/lyric-window.js#L19-L26) |
| 加载 URL | `{baseUrl}/lyrics?desktop=1`(页面清单见 [../frontend/pages.md](../frontend/pages.md)) | [lyric-window.js:35](../../../src/electron/lyric-window.js#L35) |
| webPreferences | 复用主窗口 preload,`contextIsolation:true`、`nodeIntegration:false`、`sandbox:true` | [lyric-window.js:27-32](../../../src/electron/lyric-window.js#L27-L32) |
| 单例 | 已打开时 `showInactive()` 复用,不新建 | [lyric-window.js:9-12](../../../src/electron/lyric-window.js#L9-L12) |

窗口行为:

- `updateLyricWindow(state)`:经 `normalizeLyricState` 归一化后,以 **`music:lyric-state`** 事件推给歌词页;窗口不存在返回 `{open:false}`([lyric-window.js:48-52](../../../src/electron/lyric-window.js#L48-L52))。
- `setLyricWindowLocked(locked)`:锁定用 `setIgnoreMouseEvents(true, {forward:true})` 实现鼠标穿透,并把 `{locked}` 随 `music:lyric-state` 下发,让页面 UI 反映锁定态([lyric-window.js:54-60](../../../src/electron/lyric-window.js#L54-L60))。
- 渲染进程订阅:`js/overlays/lyric-window.js` 的 `musicAPI.onLyricState`;播放页通过 `music:open-lyric-window` / `music:close-lyric-window` / `music:update-lyric-window` / `music:set-lyric-window-locked` 驱动(调用方见 [preload.md](preload.md) §4)。

## 2. 音乐平台登录窗(login-window.js)

`loginMusicAccount(mainWindow, platform, dataDir)`([login-window.js:9-90](../../../src/electron/login-window.js#L9-L90))为**通用实现**,平台参数来自 `auth-manager.js` 的 `MUSIC_LOGIN_CONFIG`(分区、登录 URL、允许域名见 [auth.md](auth.md) §1-§3):

| 事实 | 值 | 出处 |
|---|---|---|
| 窗口 | 1000×720,parent 主窗口,modal:false | [login-window.js:11-15](../../../src/electron/login-window.js#L11-L15) |
| webPreferences | 指定平台 partition(登录态隔离),`nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`,**无 preload** | [login-window.js:16-21](../../../src/electron/login-window.js#L16-L21) |
| 权限 | `setPermissionRequestHandler` 一律拒绝 | [login-window.js:25](../../../src/electron/login-window.js#L25) |
| 初始 URL | 平台登录 URL(见 [auth.md](auth.md) §2) | [login-window.js:70](../../../src/electron/login-window.js#L70) |

**导航白名单**:`setWindowOpenHandler`([login-window.js:27-34](../../../src/electron/login-window.js#L27-L34))与 `will-navigate`([login-window.js:36-40](../../../src/electron/login-window.js#L36-L40))两条路径均用 `isAllowedMusicLoginUrl(platform, url)` 判定:命中平台允许域名 → 当前窗口内 `loadURL`;未命中 → `shell.openExternal` 交系统浏览器。`setWindowOpenHandler` 一律返回 `{action:'deny'}`,绝不弹新的 Electron 窗口。

**Cookie 持久化节奏**(窗口侧;检测语义属 [auth.md](auth.md) §9):`cookies.on('changed')` → 800ms 防抖落盘快照,同时立即做一次登录完成检测([login-window.js:45-68](../../../src/electron/login-window.js#L45-L68));另设 1.5s 轮询兜底([login-window.js:73](../../../src/electron/login-window.js#L73));检测到登录成功 → 自动 `close()`。窗口 `closed` 时清理定时器与监听器、做**最终强制快照**,resolve `{platform, snapshot, state}`([login-window.js:75-89](../../../src/electron/login-window.js#L75-L89))。

## 3. B站登录窗(bilibili-login-window.js)

`openBilibiliLoginWindow(options)`([bilibili-login-window.js:3-128](../../../src/electron/bilibili-login-window.js#L3-L128))依赖注入式实现(BrowserWindow/shell/auth 由 main.js 传入),与音乐登录窗同构:

| 事实 | 值 | 出处 |
|---|---|---|
| 初始 URL | `https://live.bilibili.com/`(登录 URL 唯一成表处:[auth.md](auth.md) §2) | [bilibili-login-window.js:117](../../../src/electron/bilibili-login-window.js#L117) |
| partition | Bilibili 持久化登录分区([auth.md](auth.md) §1) | [bilibili-login-window.js:23](../../../src/electron/bilibili-login-window.js#L23) |
| 权限 | 拒绝所有权限请求 | [bilibili-login-window.js:31](../../../src/electron/bilibili-login-window.js#L31) |
| 导航 | `isAllowedBilibiliLoginUrl` 白名单(域名清单见 [auth.md](auth.md) §3),外部链接走系统浏览器 | [bilibili-login-window.js:37-50](../../../src/electron/bilibili-login-window.js#L37-L50) |

与音乐登录窗的差异:

- **关闭快照**:`closed` 时执行 `persistBilibiliCookieSnapshot(dataDir)`(含明文导出逻辑,见 [auth.md](auth.md) §6)并取回最新 auth state,一并 resolve([bilibili-login-window.js:95-114](../../../src/electron/bilibili-login-window.js#L95-L114))。
- **防重入**:`loginCheckInFlight`(检测在飞时不重复发起)与 `loginCloseRequested`(已请求关闭后不再触发)两道守卫保护自动关闭检测([bilibili-login-window.js:54-55](../../../src/electron/bilibili-login-window.js#L54-L55)、[65-80](../../../src/electron/bilibili-login-window.js#L65-L80))。
- **加载失败处理**:`loadURL` 失败时清理监听并 `destroy()` 窗口,异常上抛给 IPC 调用方([bilibili-login-window.js:116-122](../../../src/electron/bilibili-login-window.js#L116-L122))。

## 4. 生命周期与 IPC 语义

三个辅助窗口全部由主窗口的 IPC 驱动创建/销毁,通道清单与载荷见 [preload.md](preload.md) §2;窗口事件(`create/open/close`)经 main.js `writeLog` 记入 desktop.log([main.md](main.md) §8)。

- 歌词窗生命周期绑定 `music:open-lyric-window` / `music:close-lyric-window`,内容推送绑定 `music:update-lyric-window` / `music:set-lyric-window-locked`(main.js 仅薄包装转发,见 [main.js:653-671](../../../src/electron/main.js#L653-L671))。
- 登录窗生命周期绑定 `music:login` / `bilibili:login`:handler `await` 窗口 `closed` 后 resolve 结果给渲染进程(登录态判定与快照返回见 [auth.md](auth.md) §4/§9)。
