# 桌面壳主进程:窗口、协议与生命周期

> 涉及文件:[src/electron/main.js](../../../src/electron/main.js)、[src/electron/cloud-sync-controller.js](../../../src/electron/cloud-sync-controller.js)、[src/electron/desktop-auth-controller.js](../../../src/electron/desktop-auth-controller.js)、[src/electron/desktop-update-controller.js](../../../src/electron/desktop-update-controller.js)、[src/electron/desktop-logger.js](../../../src/electron/desktop-logger.js)、[src/electron/media-request-headers.js](../../../src/electron/media-request-headers.js)、[src/electron/license/license-manager.js](../../../src/electron/license/license-manager.js)、[src/electron/license/license-runtime-policy.js](../../../src/electron/license/license-runtime-policy.js)、[src/electron/desktop-state.js](../../../src/electron/desktop-state.js)、[src/electron/desktop-permissions.js](../../../src/electron/desktop-permissions.js)、[src/electron/playback-flush.js](../../../src/electron/playback-flush.js)、[src/electron/terminal-log.js](../../../src/electron/terminal-log.js)、[src/electron/local-media-access.js](../../../src/electron/local-media-access.js)、[package.json](../../../package.json)

本文档是 Electron 桌面壳的**唯一事实源**:进程入口、启动序列、主窗口规格、`local-media://` 协议、请求头伪装、关闭时序与日志只在此成文。IPC 通道全量注册表见 [preload.md](preload.md),登录会话见 [auth.md](auth.md),辅助窗口见 [windows.md](windows.md),自动更新运行时见 [update.md](update.md);后端服务生命周期见 [../backend/server-core.md](../backend/server-core.md),数据目录树见 [../backend/storage.md](../backend/storage.md)。

**主进程模块边界:** `main.js` 是唯一 Electron 组合根，拥有 app/window/protocol/IPC 的接线与生命周期；`cloud-sync-controller.js` 只协调三个云端 scope 的 revision、dirty、轮询和应用，`desktop-auth-controller.js` 只管理登录窗口和认证快照，`desktop-update-controller.js` 只适配更新运行时，`desktop-logger.js` 只做有序日志写入，`media-request-headers.js` 只安装媒体请求头规则。授权域由 `license-manager.js` 持有状态和远端流程，`license-runtime-policy.js` 只计算可授权能力与状态映射。辅助模块通过显式回调访问窗口/路径，不反向读取 `main.js` 的可变全局。

## 1. 进程形态与入口

| 事实     | 值                                                                                                                    | 出处                                                                                         |
| -------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 入口     | `package.json` 的 `main` 指向 `src/electron/main.js`,Electron 启动即执行此文件                                        | [package.json:8](../../../package.json#L8)                                                   |
| 运行形态 | `npm run desktop` → `electron .`;后端 HTTP 服务与 Electron main **同进程**(`require('../server')` 的运行时适配,见 §2) | [package.json:11](../../../package.json#L11)、[server-core.md](../backend/server-core.md) §1 |
| 应用名   | `app.setName('LIRA')` — 决定 `%APPDATA%/LIRA` 等派生路径                                                              | [main.js:69](../../../src/electron/main.js#L69)                                              |

**单实例锁**:`app.requestSingleInstanceLock()` 拿不到锁立即 `app.quit()`([main.js:59-67](../../../src/electron/main.js#L59-L67));`second-instance` 事件时还原并聚焦主窗口([main.js:71-75](../../../src/electron/main.js#L71-L75));锁在退出流程末尾释放(§7)。

`window-all-closed` 时非 darwin 平台直接 `app.quit()`([main.js:77-79](../../../src/electron/main.js#L77-L79))。

主进程可变状态由 `createDesktopState()` 创建并按 `window/lifecycle/media/paths/logging/update` 六个职责分组。`main.js` 只保留这些分组引用,窗口、内嵌服务、更新状态和日志序列不再散落为模块级 `let`。

## 2. 启动序列 startDesktopApp

`app.whenReady()` 后执行([main.js:106-154](../../../src/electron/main.js#L106-L154)):

1. `configureDesktopEnvironment()` — 数据/日志目录、环境变量、terminal 日志、local-media 访问控制(§3/§5/§8)
2. `migrateUserDataFromAppData()` — 旧 `%APPDATA%` 登录分区迁移(§3.2)
3. `configureMenu()` — `Menu.setApplicationMenu(null)`([main.js:236-238](../../../src/electron/main.js#L236-L238))
4. `configureLocalMediaProtocol()` — 注册 `local-media` handler(§5)
5. `configureUpdateIpc()` / `configureMusicIpc()` / `configureBilibiliIpc()` — 注册 IPC handler(通道清单见 [preload.md](preload.md) §2)
6. `configureMusicMediaRequestHeaders()` / `configureBilibiliMediaRequestHeaders()` — 请求头伪装(§6)
7. `updateMgr.configureAutoUpdater(...)` — 自动更新运行时([update.md](update.md) §3)
8. `await restoreMusicCookieSnapshots()` → `await restoreBilibiliCookieSnapshot()` — **先于服务器启动**恢复会话([auth.md](auth.md) §8)
9. `desktopRuntime = createDesktopRuntime(serverRuntimeModule, { dataDir, safeStorage })` + `setPreShutdownHook(requestPlaybackFlush)`([main.js:133-137](../../../src/electron/main.js#L133-L137))
10. `await desktopRuntime.start(serverOptions)` — 启动内嵌 HTTP 服务(注入契约见 [auth.md](auth.md) §11,[server-core.md](../backend/server-core.md) §6.1)
11. 创建 `licenseManager`,注册 license IPC,再 `await licenseManager.bootstrap()`;本地服务此时仍通过动态 `licenseGate` 拒绝 Admin、业务 API 和 WebSocket
12. 创建 `cloudSyncController`，注入授权 manager、本地 runtime 与仅 main process 可访问的 Bilibili Cookie 适配器；已授权时先完成一次同步再恢复本地 Bilibili 工作
13. 由 `license/license-resume.js` 的 `createLicenseResumeHandler` 注册 `powerMonitor` 的 `resume` 监听;系统唤醒时由 main process 立即调用 `licenseManager.resume()` 重新确认设备会话，并在成功后请求云端同步
14. `registerLocalFontPermissionHandler(...)` — 将本机字体权限限制为内嵌服务的精确 origin,并用原生对话框取得用户明确同意(§4)
15. 按最终授权状态加载 `/admin?desktop=1` 或 `/license`;若启动验证已成功,显式调用一次 `cloudSyncController.start()`，完成后恢复 Bilibili 工作

`createDesktopRuntime`([main.js:156-180](../../../src/electron/main.js#L156-L180))是兼容适配器:若传入模块已是运行时(具备 `start/stop/setPreShutdownHook`)直接返回;若暴露 `createServerRuntime(options)` 则调用之;否则退化为包装 `startServer`/`shutdownApplication` 的旧兼容层。

开发模式(未打包)在窗口就绪后把更新状态置为 `dev-disabled`([main.js:144-153](../../../src/electron/main.js#L144-L153),见 [update.md](update.md) §2)。

### 2.1 设备授权生命周期

`license-manager.js` 是设备身份状态、内存 access token、续期和 heartbeat 的唯一所有者。持久化文件只保存公开设备资料;私钥由 Electron `safeStorage` 加密,access token 不写磁盘也不进入 preload/renderer 返回值。

- 状态为 `CHECKING / NEEDS_ACTIVATION / NEEDS_CONNECTION / AUTHORIZING / AUTHORIZED / BLOCKED`;只有 `AUTHORIZED` 打开本地业务 gate
- token 续期使用全局单飞 Promise,其他受保护请求和 heartbeat 必须等待该 Promise,避免旧 `token_jti` 与新 token 并发
- 默认 `10m` token 在到期前 90 秒续期;heartbeat 每 150 秒执行一次
- 续期失败(token 仍有效时)按 `license/retry-policy.js` 做有界指数退避:基础 5s 倍增、封顶 60s、jitter 系数 `[0.5, 1.5)`,延迟同时受 token 剩余有效期钳制;连续 10 次失败(`nextDelay()` 返回 `null`)停止重试并进入 `NEEDS_CONNECTION`,续期成功或状态切换时序列重置
- HTTP 408/429/5xx、DNS 和 timeout 在 token 已失效时进入 `NEEDS_CONNECTION`,但不删除设备身份;仍有效 token 的单次网络失败保持 `AUTHORIZED`
- Device/License/Streamer 撤销和 Session 拒绝立即清空内存 token、停止维护定时器并进入 `BLOCKED`;main 监听状态后暂停授权业务并切回 `/license`
- 系统唤醒时立即 heartbeat;若此前为 `NEEDS_CONNECTION`,则重新执行 challenge/verify

### 2.2 云端同步生命周期

`cloud-sync-controller.js` 是 Electron 进程内的同步协调者，不持久化云端 revision。授权成功后立即同步，之后使用可 `unref()` 的 60 秒单次 timer 轮询；每轮结束（包括读取失败）都会重新调度。系统 resume 在设备会话恢复后调用 `syncNow()`。授权离开 `AUTHORIZED` 时停止 timer；退出时 `dispose()` 同时移除本地 mutation 与授权状态 listener。

三个 scope 各自跟踪 revision 和 dirty。成功的本地 mutation 先标记 dirty 并立即串行上传；失败保留 dirty，下一轮重试，且 dirty 上传成功前不应用该 scope 的云端快照。未初始化的云端 settings/songs 由首台授权客户端上传本地快照；Bilibili scope 按本地登录态播种凭据或明确的未登录状态。云端 revision 较新时，settings 与 songs 通过本地 runtime owner 应用，Bilibili 凭据只通过 [auth.md](auth.md) §13 的 main-process 内部方法导入。

## 3. 数据目录决策

### 3.1 userData 重定向

| 事实     | 值                                                                                                          | 出处                                                       |
| -------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 目标     | `app.setPath('userData', <安装目录或仓库根>/data)`                                                          | [main.js:54-57](../../../src/electron/main.js#L54-L57)     |
| 打包版   | `path.dirname(app.getPath('exe'))/data` — 卸载时登录态(含 Chromium 持久化分区)随安装目录一并清理            | [main.js:54-55](../../../src/electron/main.js#L54-L55)     |
| 开发版   | `ROOT_DIR/data`(仓库根)                                                                                     | [main.js:56](../../../src/electron/main.js#L56)            |
| 环境变量 | `process.env.SONG_PLUGIN_DATA_DIR = dataDir`、`process.env.ELECTRON_DESKTOP = '1'`、`HOST` 缺省 `127.0.0.1` | [main.js:211-213](../../../src/electron/main.js#L211-L213) |

目录树(五库、`music-auth/`、`bilibili-auth/`、`Partitions/`、允许清单)见 [../backend/storage.md](../backend/storage.md) §2 — 本文件不重复成树。

### 3.2 旧数据迁移 migrateUserDataFromAppData

旧版本把 Chromium 登录分区残留在 `%APPDATA%/LIRA/Partitions/`,升级后用户会丢失登录态。`migrateUserDataFromAppData`([main.js:218-234](../../../src/electron/main.js#L218-L234)):当旧路径存在且新路径不存在时 `fs.cpSync(oldPartitions, newPartitions, {recursive:true})`;失败仅记日志、不阻断启动(非致命)。

## 4. 主窗口

`createMainWindow(baseUrl)`([main.js:317-375](../../../src/electron/main.js#L317-L375)):

| 事实           | 值                                                                                                                 | 出处                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 尺寸           | **1280×720**,minWidth 1024,minHeight 680                                                                           | [main.js:320](../../../src/electron/main.js#L320)          |
| 窗口形态       | `frame: false`(自绘标题栏)、`backgroundColor: '#f7f3ef'`(暖白,防白屏闪烁)、`show: false` 等 `ready-to-show` 再显示 | [main.js:321-322](../../../src/electron/main.js#L321-L322) |
| 加载 URL       | `{baseUrl}/admin?desktop=1`(页面清单见 [../frontend/pages.md](../frontend/pages.md))                               | [main.js:333](../../../src/electron/main.js#L333)          |
| webPreferences | `preload: preload.js`、`contextIsolation: true`、`nodeIntegration: false`、`sandbox: false`                        | [main.js:323-326](../../../src/electron/main.js#L323-L326) |
| 图标           | 打包资源 `build/icon.png` 存在时附加                                                                               | [main.js:328-329](../../../src/electron/main.js#L328-L329) |

导航策略:`setWindowOpenHandler` 一律 `shell.openExternal` + `{action:'deny'}`([main.js:346-349](../../../src/electron/main.js#L346-L349));`will-navigate` 仅放行与 `baseUrl` 同协议/同 host/同端口的导航,其余拦截并交系统浏览器([main.js:351-357](../../../src/electron/main.js#L351-L357))。

最大化状态:窗口 `maximize`/`unmaximize` 事件经 `desktop:window-maximized` 推给渲染进程([main.js:364-374](../../../src/electron/main.js#L364-L374),消费方见 [preload.md](preload.md) §2.2)。

`ready-to-show` 后:显示窗口、下发当前更新状态,并触发首轮自动更新检查(仅打包版且 `enableAutoUpdate==='true'`,延迟 1s,见 [update.md](update.md) §1)。

本机字体权限:`desktop-permissions.js` 只处理 Chromium `localFonts` 请求,并用 `hasExactOrigin(requestingUrl, baseUrl)` 拒绝非 LIRA origin 与所有其他权限。可信页面请求时显示 Electron 原生对话框,明确说明只读取字体名称、不读取字体文件/路径/内容;用户选择“允许”才向 Chromium 放行。管理页的桌面歌词与点歌板风格 3–6 字体选择器通过 `local-font-library.js` 共用一次 `window.queryLocalFonts()` 查询,去重、排序后分别保留各自的内置选项和当前值;若 Chromium 首次调用要求瞬时用户激活,管理页在用户首次正常点击/按键时自动重试,不新增 IPC 或文件访问桥。

## 5. local-media:// 协议(唯一成文处)

用途:让前端 `<audio>` 播放本地音频文件,同时绕开 Chromium 对本地文件的加载限制。

**协议特权**(启动前注册):`protocol.registerSchemesAsPrivileged` 声明 `standard/secure/supportFetchAPI/stream/bypassCSP`([main.js:46-49](../../../src/electron/main.js#L46-L49))。

**URL 格式**:`local-media://media/<base64url 编码的绝对路径>`(URL 由 `music:resolve-local-media-urls` 生成,见 [preload.md](preload.md) §2.1)。

**handler 流程**([local-media-protocol.js](../../../src/electron/local-media-protocol.js)):

1. 解析 URL pathname,base64url 解码出文件路径;非法 → 400
2. `fs.realpathSync` 规范化路径,防止符号链接逃逸;失败 → 404
3. `localMediaAccess.isAllowed(canonicalPath)` 校验失败 → 403
4. **音频扩展名白名单**校验(`.mp3`/`.flac`/`.wav`/`.aac`/`.ogg`/`.m4a`/`.wma`);非白名单扩展名 → 403
5. 按扩展名给 MIME:`.mp3 → audio/mpeg`、`.flac → audio/flac`、`.wav → audio/wav`、`.aac → audio/aac`、`.ogg → audio/ogg`、`.m4a → audio/mp4`、`.wma → audio/x-ms-wma`
6. 请求带 `Range` 头时回 206(`Content-Range`/`Content-Length`,起始 ≥ 文件大小回 416);否则回 200 全量
7. 两类响应均带 `Accept-Ranges: bytes` 与 **`Cache-Control: no-store`**(本地文件无需缓存)

**访问控制**([local-media-access.js](../../../src/electron/local-media-access.js)):`createLocalMediaAccess(dataDir)` 维护允许清单,持久化到 `dataDir/local-media-access.json`。

**安全模型(H05 限制)**:

- **仅允许清单内路径**:不再隐式允许 dataDir 子树访问,防止渲染进程通过 `local-media://` 读取数据库、会话 token、配置文件等敏感文件
- **音频扩展名白名单**:`allowPaths` 授权时与 `isAllowed` 检查时双重验证扩展名,拒绝 `.txt`/`.js`/`.db`/`.json` 等非音频文件
- **符号链接规范化**:`allowPaths` 使用 `fs.realpathSync` 将符号链接解析为真实路径,防止攻击者通过符号链接逃逸到未授权目录;协议处理器同样规范化请求路径
- **IPC 来源校验**:`music:resolve-local-media-urls` 使用 `hasExactOrigin(senderUrl, baseUrl)` 验证请求来自可信 origin([music-ipc.js:69-70](../../../src/electron/ipc/music-ipc.js#L69-L70))

`music:select-local-files` 文件对话框过滤器限定音频扩展名([music-ipc.js:33](../../../src/electron/ipc/music-ipc.js#L33)),返回前调用 `allowPaths` 将选中路径规范化并写入清单。

## 6. 请求头伪装(唯一成文处)

Chromium `session.defaultSession.webRequest.onBeforeSendHeaders` 为第三方媒体/API 请求补齐 Referer/Origin,避免因缺头被拒;**仅当请求头缺失时注入,不覆盖既有值**;host 小写化后按 `endsWith` 判定。唯一成表处:

| 匹配 URL 模式                                                    | host 判定                                          | 注入                                                                      |
| ---------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------- |
| `*://*.music.163.com/*`、`*://*.music.126.net/*`                 | 以 `music.163.com` / `music.126.net` 结尾          | `Referer: https://music.163.com/`                                         |
| `*://*.qqmusic.qq.com/*`、`*://*.gtimg.cn/*`、`*://*.y.qq.com/*` | 以 `qqmusic.qq.com` / `gtimg.cn` / `y.qq.com` 结尾 | `Referer: https://y.qq.com/` + `Origin: https://y.qq.com`                 |
| `*://*.bilibili.com/*`、`*://*.hdslb.com/*`                      | 以 `bilibili.com` / `hdslb.com` 结尾               | `Referer: https://www.bilibili.com/` + `Origin: https://www.bilibili.com` |

出处:`configureMusicMediaRequestHeaders` 与 `configureBilibiliMediaRequestHeaders`。音乐组使用 `mediaState.headersConfigured` 幂等标记。

## 7. 关闭序列与播放状态冲刷

`before-quit`([main.js:81-102](../../../src/electron/main.js#L81-L102)):

1. `gracefulQuitStarted` 防重入;首次进入 `event.preventDefault()` 接管关闭
2. `licenseResumeController.unregister()` 移除 `powerMonitor` resume 监听(`license/license-resume.js`),防止关闭阶段再启动授权请求
3. `cloudSyncController.dispose()` 停止同步 timer 并移除 listener，不把客户端退出解释为云端 monitor stop
4. 5s 兜底定时器 → 释放单实例锁 + `app.exit(0)`(渲染进程卡死不阻塞退出)
5. `shutdownApplication({ exitProcess: false })` → 服务器关闭流程([server-core.md](../backend/server-core.md) §6.2),其中 `preShutdownHook()` 即本壳注入的 `requestPlaybackFlush`([main.js:137](../../../src/electron/main.js#L137))
6. 完成后释放授权维护 timer、清兜底定时器、释放单实例锁、`app.exit(0)`

**播放状态冲刷握手**([playback-flush.js](../../../src/electron/playback-flush.js)):

```
Main: requestPlaybackFlush(mainWindow, 2000)
  ├─ mainWindow.webContents.send('app:prepare-shutdown')   [playback-flush.js:22]
  ├─ Renderer: 立即保存播放状态 → invoke('playback:flush-ack')  [main.js:519-522]
  ├─ ack → finish('ack')
  └─ 2s 超时 → finish('timeout') 安全网                      [playback-flush.js:20]
```

`requestPlaybackFlush`([playback-flush.js:5-27](../../../src/electron/playback-flush.js#L5-L27))为单飞握手:存在 pending flush 时新请求立即完成;主窗口已销毁则 `{status:'skipped'}`;`acknowledgePlaybackFlush`([playback-flush.js:29-33](../../../src/electron/playback-flush.js#L29-L33))由 `playback:flush-ack` handler 调用。渲染进程侧行为见 [preload.md](preload.md) §3。

`desktop:restart` 同样先走 `shutdownApplication({exitProcess:false})` 再 `app.relaunch()` + `app.exit(0)`([main.js:414-425](../../../src/electron/main.js#L414-L425))。

## 8. 日志

| 文件                | 位置                                  | 写入者                                                                                                                      |
| ------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `logs/terminal.log` | `logDir = path.dirname(dataDir)/logs` | `installTerminalLog` 包裹 console 五方法(log/info/debug/warn/error)                                                         |
| `logs/desktop.log`  | 同目录                                | main.js `writeLog(scope, value)` — 结构化事件(`lifecycle`/`window`/`ipc`/`update-error`/`gift-display`/`playback-flush` 等) |

出处:[configureDesktopEnvironment:189-214](../../../src/electron/main.js#L189-L214)(目录创建、`logRunId`、`installTerminalLog`)、[writeLog:729-743](../../../src/electron/main.js#L729-L743)。日志目录位于 data 目录**父目录**下(data 目录树见 [storage.md](../backend/storage.md) §2)。

行格式 `formatLogLine`([terminal-log.js:72-81](../../../src/electron/terminal-log.js#L72-L81)):`[ISO 时间] [run=<runId> seq=<n> pid=<pid> type=<processType>] [<source>] <message>`,消息内换行转义为 `\n`;`installTerminalLog` 返回恢复函数([terminal-log.js:9-38](../../../src/electron/terminal-log.js#L9-L38))。所有日志写入失败静默(日志绝不干扰主流程)。

所有日志输出(terminal.log 的 console 包裹与 desktop.log 的 `writeLog`)统一经 `src/shared/log-redaction.js` 的 `redactCredentials` 脱敏。脱敏字段:`password`/`passwd`、`activationcode`、`pairingcode`、`fingerprint`、`hardwareid`(精确键名),`*apikey`/`*secret`/`*token`/`*signature`(键名后缀),包含 `privatekey` 的键名,`authorization`/`cookie` 头,以及 URL 查询参数中的同名键(大小写不敏感)。即日志中不出现密码、完整激活码/授权码、token、签名、私钥和原始硬件标识。

## 9. Electron 版本与安全配置

| 项        | 值                                                                                                                        | 出处                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Electron  | `43.2.0`(devDependencies)                                                                                                 | [package.json:29](../../../package.json#L29)        |
| 构建/更新 | electron-builder 26.x + electron-updater 6.x;builder 与 publish 配置见 [../engineering/build.md](../engineering/build.md) | [package.json:25-30](../../../package.json#L25-L30) |

窗口安全配置差异(sandbox 取向与各窗口形态对应):

| 窗口             | contextIsolation | nodeIntegration | sandbox   | preload        |
| ---------------- | ---------------- | --------------- | --------- | -------------- |
| 主窗口           | true             | false           | **false** | 有(preload.js) |
| 歌词窗           | true             | false           | true      | 有(preload.js) |
| 登录窗(音乐/B站) | true             | false           | true      | 无             |

主窗口 `sandbox: false`([main.js:325](../../../src/electron/main.js#L325)):preload 桥需在页面上下文暴露 `contextBridge` API 并访问完整 `ipcRenderer`;辅助窗口无此需求,保持 `sandbox: true` 收紧。IPC 安全边界见 [preload.md](preload.md) §1。
