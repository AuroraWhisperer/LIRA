# preload 桥与 IPC 全量注册表

> 涉及文件:[src/electron/preload.js](../../../src/electron/preload.js)、[src/electron/main.js](../../../src/electron/main.js)(handler 注册)、[src/electron/lyric-window.js](../../../src/electron/lyric-window.js)(`music:lyric-state` 发送)

本文档是 IPC 的**唯一事实源**:所有通道、方向、载荷、handler 摘要只在此成表,其他文档一律链接此处。窗口生命周期见 [main.md](main.md) / [windows.md](windows.md),更新语义见 [update.md](update.md),登录语义见 [auth.md](auth.md)。

## 1. 安全模型

| 项 | 配置 | 出处 |
|---|---|---|
| 上下文隔离 | `contextIsolation: true`(所有窗口) | [main.js:324](../../../src/electron/main.js#L324) |
| Node 注入 | `nodeIntegration: false`(所有窗口) | [main.js:324](../../../src/electron/main.js#L324) |
| 暴露方式 | `contextBridge.exposeInMainWorld` 三个白名单对象 | [preload.js:5-76](../../../src/electron/preload.js#L5-L76) |
| ipcRenderer | **不直接暴露**,仅经桥方法间接调用 | — |
| 来源校验 | `music:resolve-local-media-urls` / `music:select-wesing-cache` 校验 `senderFrame.url` 的 origin 与 desktopBaseUrl 一致(`hasExactOrigin`,实现见 [local-media-access.js:40-46](../../../src/electron/local-media-access.js#L40-L46)) | [main.js:470-473](../../../src/electron/main.js#L470-L473)、[main.js:488-490](../../../src/electron/main.js#L488-L490) |

## 2. IPC 全量注册表(唯一成表处)

### 2.1 renderer → main(invoke)

| 通道 | 载荷 | 返回 | handler 摘要 | 出处 |
|---|---|---|---|---|
| `desktop:get-info` | — | `{version, isPackaged, platform, dataDir, logFile, terminalLogFile, githubRepoUrl, updateState}` | 桌面环境信息汇总 | [main.js:380-387](../../../src/electron/main.js#L380-L387) |
| `desktop:check-for-updates` | — | 更新状态对象 | 触发 GitHub 更新检查([update.md](update.md) §4) | [main.js:388-391](../../../src/electron/main.js#L388-L391) |
| `desktop:download-update` | — | 更新状态对象 | 下载新版本 | [main.js:392-395](../../../src/electron/main.js#L392-L395) |
| `desktop:install-update` | — | 更新状态对象 | 安装并重启(`quitAndInstall`) | [main.js:396-399](../../../src/electron/main.js#L396-L399) |
| `desktop:open-data-dir` | — | `''` 或错误信息 | `shell.openPath(dataDir)` | [main.js:400](../../../src/electron/main.js#L400) |
| `desktop:open-log-dir` | — | `''` 或错误信息 | `shell.openPath(logDir)` | [main.js:401](../../../src/electron/main.js#L401) |
| `desktop:open-github` | — | Promise | 系统浏览器打开 GitHub 仓库 | [main.js:402](../../../src/electron/main.js#L402) |
| `desktop:set-auto-update` | `enabled: boolean` | undefined | **仅记日志**;持久化由渲染进程经 `/api/settings` 完成 | [main.js:403-406](../../../src/electron/main.js#L403-L406) |
| `desktop:gift-display` | `{eventId, giftId, giftName, uid, userName, num, totalPrice, toastKey}` | `{ok:true}` | 礼物 toast 追踪:`normalizeGiftDisplayTrace` 规范化后 console + desktop.log | [main.js:407-413](../../../src/electron/main.js#L407-L413) |
| `desktop:restart` | — | undefined | 关停服务器 → `app.relaunch()` + `app.exit(0)` | [main.js:414-425](../../../src/electron/main.js#L414-L425) |
| `desktop:close-window` | — | undefined | 关闭主窗口 | [main.js:426-429](../../../src/electron/main.js#L426-L429) |
| `desktop:minimize-window` | — | undefined | 最小化主窗口 | [main.js:430-432](../../../src/electron/main.js#L430-L432) |
| `desktop:maximize-window` | — | undefined | 最大化/还原切换 | [main.js:433-438](../../../src/electron/main.js#L433-L438) |
| `music:get-auth-state` | `platform: 'qq' \| 'netease'` | 平台 auth state([auth.md](auth.md) §4) | 读分区 Cookie 判定登录态 | [main.js:442](../../../src/electron/main.js#L442) |
| `music:login` | `platform` | `{platform, snapshot, state}` | 打开音乐登录窗并等待关闭([windows.md](windows.md) §2) | [main.js:443](../../../src/electron/main.js#L443) |
| `music:logout` | `platform` | 最新 auth state | 清分区 + 删快照([auth.md](auth.md) §7) | [main.js:444](../../../src/electron/main.js#L444) |
| `music:open-lyric-window` | — | `{open:boolean}` | 打开/复用歌词窗 | [main.js:445](../../../src/electron/main.js#L445) |
| `music:close-lyric-window` | — | `{open:false}` | 关闭歌词窗 | [main.js:446](../../../src/electron/main.js#L446) |
| `music:update-lyric-window` | 歌词 state | `{open:boolean}` | 归一化后推送歌词窗(§2.2 `music:lyric-state`) | [main.js:447](../../../src/electron/main.js#L447) |
| `music:set-lyric-window-locked` | `locked: boolean` | `{open, locked}` | 歌词窗鼠标穿透锁定 | [main.js:448](../../../src/electron/main.js#L448) |
| `music:provider-health` | `platform` | 平台健康检查结果 | 临时构造 provider 注册表执行 healthCheck | [main.js:449-455](../../../src/electron/main.js#L449-L455) |
| `music:select-local-files` | — | `{ok, canceled, files:[{path,name,ext}]}` | 多选音频文件对话框 + `allowPaths` 入白名单([main.md](main.md) §5) | [main.js:456-469](../../../src/electron/main.js#L456-L469) |
| `music:select-wesing-cache` | — | `{ok, canceled, path}` | 目录对话框选 WeSingCache(校验 origin;默认路径取设置 `weSingCachePath`) | [main.js:470-485](../../../src/electron/main.js#L470-L485) |
| `music:resolve-local-media-urls` | `paths: string[]` | `{results: {[path]: {ok, url? / reason?}}}` | 校验 origin;存在且被允许的文件生成 `local-media://media/<base64url>` URL | [main.js:486-509](../../../src/electron/main.js#L486-L509) |
| `playback:save-state` | `{clientId, payload}` | `{ok, …}`(playback-store 结果) | 持久化播放快照([storage.md](../backend/storage.md) §3.4) | [main.js:510-518](../../../src/electron/main.js#L510-L518) |
| `playback:flush-ack` | — | `{ok:true}` | 应答 `app:prepare-shutdown` 握手(§3) | [main.js:519-522](../../../src/electron/main.js#L519-L522) |
| `bilibili:get-auth-state` | — | Bilibili auth state([auth.md](auth.md) §4) | 读 Bilibili 登录分区判定登录态 | [main.js:548](../../../src/electron/main.js#L548) |
| `bilibili:login` | — | `{snapshot, state}` | 打开 B站登录窗并等待关闭([windows.md](windows.md) §3) | [main.js:549](../../../src/electron/main.js#L549) |
| `bilibili:logout` | — | 最新 auth state | 清分区 + 删快照 + 删明文导出 | [main.js:550](../../../src/electron/main.js#L550) |

### 2.2 main → renderer(send)

| 通道 | 载荷 | 发送点 | 接收方 | 出处 |
|---|---|---|---|---|
| `desktop:update-state` | `{status, message, version, canDownload, canInstall, progress, updateVersion}`(形状见 [update.md](update.md) §4) | 更新状态每次变化(`sendUpdateState`) | 主窗口 `songAssistantDesktop.onUpdateState` | [main.js:706-710](../../../src/electron/main.js#L706-L710) |
| `desktop:window-maximized` | `boolean` | 主窗口 maximize/unmaximize 事件 | 主窗口 `songAssistantDesktop.onWindowMaximized` | [main.js:364-374](../../../src/electron/main.js#L364-L374) |
| `music:lyric-state` | 归一化歌词 state,或 `{locked}` | `music:update-lyric-window` / `music:set-lyric-window-locked` | **歌词窗** `musicAPI.onLyricState` | [lyric-window.js:48-60](../../../src/electron/lyric-window.js#L48-L60) |
| `app:prepare-shutdown` | — | 关闭时序 `requestPlaybackFlush`([main.md](main.md) §7) | 主窗口 `musicAPI.onPrepareShutdown` | [playback-flush.js:22](../../../src/electron/playback-flush.js#L22) |

> `desktop:show-update-page` 在 preload 注册了监听([preload.js:19-25](../../../src/electron/preload.js#L19-L25)),但当前 main 进程未发送此事件,属预留通道。

## 3. 播放状态持久化流

```
播放页: StorageManager → musicAPI.savePlaybackState(clientId, payload)     [preload.js:61]
  → invoke('playback:save-state') → desktopRuntime.persistPlaybackSnapshot  [main.js:510-518]
  → 服务器 playback-store 落库 play_queue_state(见 [../backend/storage.md](../backend/storage.md) §3.4)

关闭时序: Main 发 'app:prepare-shutdown'                                    [playback-flush.js:22]
  → 播放页 onPrepareShutdown 回调 → 立即保存 → confirmShutdownFlush()        [preload.js:62-69]
  → invoke('playback:flush-ack') → acknowledgePlaybackFlush                  [playback-flush.js:29-33]
  → Main 2s 超时安全网(见 [main.md](main.md) §7)
```

## 4. 调用方地图

| 桥对象 | 方法 | 调用方(前端) | 页面文档 |
|---|---|---|---|
| `songAssistantDesktop` | getInfo / checkForUpdates / downloadUpdate / installUpdate / onUpdateState / onShowUpdatePage / openDataDir / openLogDir / openGithub / setAutoUpdate | 管理页 `js/desktop.js`(更新面板、数据/日志/GitHub 入口) | [../frontend/pages.md](../frontend/pages.md) |
| `songAssistantDesktop` | minimizeWindow / maximizeWindow / closeWindow / onWindowMaximized / restart | 管理页 `js/admin/settings.js`(自绘窗口控件、重启) | 同上 |
| `songAssistantDesktop` | reportGiftDisplay | 礼物通知 `js/admin/gifts/notification.js` | 同上 |
| `musicAPI` | getAuthState / providerHealth / login / logout | 播放页 `js/playback/provider/manager.js`、`js/playback/operations/provider-operations.js` | 同上 |
| `musicAPI` | selectLocalFiles / resolveLocalMediaUrls | 播放页 `js/playback/local/manager.js`、`js/playback/features/playback-controls.js` | 同上 |
| `musicAPI` | openLyricWindow / closeLyricWindow / updateLyricWindow / setLyricWindowLocked / onLyricState | 播放页 `js/playback/services/lyric-service.js`;歌词窗 `js/overlays/lyric-window.js`(onLyricState);管理页 `js/admin/desktop-lyric-preview.js` | 同上 |
| `musicAPI` | selectWeSingCacheDirectory | 播放页 `js/playback/services/wesing-service.js`(全民K歌设置) | 同上,WeSing 语义见 [../backend/music/wesing.md](../backend/music/wesing.md) |
| `musicAPI` | savePlaybackState / onPrepareShutdown / confirmShutdownFlush | 播放页 `js/playback/operations/state-persistence.js`、`js/playback/core/initializer.js` | 同上 |
| `bilibiliAuth` | getAuthState / login / logout | 管理页 `js/admin/settings.js`(Bilibili 登录区) | 同上 |

> 前端另有一处对 `musicAPI.getRecentLocalFiles` 的调用(`js/playback/local/manager.js:18`),preload 未提供该方法,属被 `typeof` 守卫的残留调用(不生效)。
