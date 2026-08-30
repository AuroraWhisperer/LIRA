# 辅助窗口:音乐登录窗、B站登录窗

> 涉及文件:[src/electron/login-window.js](../../../src/electron/login-window.js)、[src/electron/bilibili-login-window.js](../../../src/electron/bilibili-login-window.js)

主窗口规格见 [main.md](main.md);登录分区、登录 URL、Cookie 快照与检测语义的事实由 [auth.md](auth.md) 持有(本文件只描述**窗口行为**);全部 IPC 通道见 [preload.md](preload.md) §2。

## 1. 音乐平台登录窗(login-window.js)

`loginMusicAccount(mainWindow, platform, dataDir)`([login-window.js:9-90](../../../src/electron/login-window.js#L9-L90))为**通用实现**,平台参数来自 `auth-manager.js` 的 `MUSIC_LOGIN_CONFIG`(分区、登录 URL、允许域名见 [auth.md](auth.md) §1-§3):

| 事实           | 值                                                                                                             | 出处                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 窗口           | 1000×720,parent 主窗口,modal:false                                                                             | [login-window.js:11-15](../../../src/electron/login-window.js#L11-L15) |
| webPreferences | 指定平台 partition(登录态隔离),`nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`,**无 preload** | [login-window.js:16-21](../../../src/electron/login-window.js#L16-L21) |
| 权限           | `setPermissionRequestHandler` 一律拒绝                                                                         | [login-window.js:25](../../../src/electron/login-window.js#L25)        |
| 初始 URL       | 平台登录 URL(见 [auth.md](auth.md) §2)                                                                         | [login-window.js:70](../../../src/electron/login-window.js#L70)        |

**导航白名单**:`setWindowOpenHandler`([login-window.js:27-34](../../../src/electron/login-window.js#L27-L34))与 `will-navigate`([login-window.js:36-40](../../../src/electron/login-window.js#L36-L40))两条路径均用 `isAllowedMusicLoginUrl(platform, url)` 判定:命中平台允许域名 → 当前窗口内 `loadURL`;未命中 → `shell.openExternal` 交系统浏览器。`setWindowOpenHandler` 一律返回 `{action:'deny'}`,绝不弹新的 Electron 窗口。

**Cookie 持久化节奏**(窗口侧;检测语义属 [auth.md](auth.md) §9):`cookies.on('changed')` → 800ms 防抖落盘快照,同时立即做一次登录完成检测([login-window.js:45-68](../../../src/electron/login-window.js#L45-L68));另设 1.5s 轮询兜底([login-window.js:73](../../../src/electron/login-window.js#L73));检测到登录成功 → 自动 `close()`。窗口 `closed` 时清理定时器与监听器、做**最终强制快照**,resolve `{platform, snapshot, state}`([login-window.js:75-89](../../../src/electron/login-window.js#L75-L89))。

## 2. B站登录窗(bilibili-login-window.js)

`openBilibiliLoginWindow(options)`([bilibili-login-window.js:3-131](../../../src/electron/bilibili-login-window.js#L3-L131))依赖注入式实现(BrowserWindow/shell/auth 由 main.js 传入),与音乐登录窗同构:

| 事实      | 值                                                                                                                          | 出处                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 初始 URL  | `https://live.bilibili.com/`(登录 URL 唯一成表处:[auth.md](auth.md) §2)                                                     | [bilibili-login-window.js:120](../../../src/electron/bilibili-login-window.js#L120)      |
| partition | Bilibili 持久化登录分区([auth.md](auth.md) §1)                                                                              | [bilibili-login-window.js:23](../../../src/electron/bilibili-login-window.js#L23)        |
| 默认禁音  | `webContents.setAudioMuted(true)` — 登录页(直播首页)可能自动播放带声音的直播流,静音为 webContents 级属性,跨页内导航持续生效 | [bilibili-login-window.js:31](../../../src/electron/bilibili-login-window.js#L31)        |
| 权限      | 拒绝所有权限请求                                                                                                            | [bilibili-login-window.js:34](../../../src/electron/bilibili-login-window.js#L34)        |
| 导航      | `isAllowedBilibiliLoginUrl` 白名单(域名清单见 [auth.md](auth.md) §3),外部链接走系统浏览器                                   | [bilibili-login-window.js:40-53](../../../src/electron/bilibili-login-window.js#L40-L53) |

与音乐登录窗的差异:

- **关闭快照**:`closed` 时执行 `persistBilibiliCookieSnapshot(dataDir)`(含明文导出逻辑,见 [auth.md](auth.md) §6)并取回最新 auth state,一并 resolve([bilibili-login-window.js:98-117](../../../src/electron/bilibili-login-window.js#L98-L117))。
- **防重入**:`loginCheckInFlight`(检测在飞时不重复发起)与 `loginCloseRequested`(已请求关闭后不再触发)两道守卫保护自动关闭检测([bilibili-login-window.js:57-58](../../../src/electron/bilibili-login-window.js#L57-L58)、[68-83](../../../src/electron/bilibili-login-window.js#L68-L83))。
- **加载失败处理**:`loadURL` 失败时清理监听并 `destroy()` 窗口,异常上抛给 IPC 调用方([bilibili-login-window.js:119-125](../../../src/electron/bilibili-login-window.js#L119-L125))。

## 3. 生命周期与 IPC 语义

两个辅助窗口均由主窗口的 IPC 驱动创建/销毁,通道清单与载荷见 [preload.md](preload.md) §2;窗口事件(`create/open/close`)经 main.js `writeLog` 记入 desktop.log([main.md](main.md) §8)。

- 登录窗生命周期绑定 `music:login` / `bilibili:login`:handler `await` 窗口 `closed` 后 resolve 结果给渲染进程(登录态判定与快照返回见 [auth.md](auth.md) §4/§9)。桌面歌词改为 `/lyrics` 浏览器源,不再创建 Electron 辅助窗口。
