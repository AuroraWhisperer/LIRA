# preload 桥与 IPC 全量注册表

## 礼物图片导出设置

`giftExport.settings(options?)` 调用 `gift-export:settings`，由
[gift-export-ipc.js](../../../src/electron/ipc/gift-export-ipc.js) 注册，并复用导出接口的
当前主窗口、主 frame、精确 desktop origin 和管理页路径检查。

- 不传参数时读取默认设置。
- 写入仅接受 `mode`（`combined` / `separate`）、`background`（`transparent` / `white`）、
  `directoryAction`（`choose` / `default`）的可选字段；拒绝未知字段和非法值。
- 返回 `{ok:true,data:{mode,background,directory,custom}}` 或 `{ok:false,error}`。
  renderer 不传保存路径；目录来自原生对话框或系统图片目录。取消目录选择不写入，
  主窗口导航、导出代次变化或销毁后丢弃待返回的目录选择。
- [gift-export-controller.js](../../../src/electron/gift-export-controller.js) 创建任务时冻结默认配置；
  之后修改默认值只影响新任务。既有 `prepare` / `configure` / `save` / `cancel` /
  `openFolder` / `onProgress` 接口保持兼容。持久化键见 [设置存储](../backend/storage.md#7-设置存储settings-store)。

## 服务器弹幕姬参数

弹幕显示屏蔽独立于样式：`license:get-overlay-filters` / `license:update-overlay-filters` /
`license:get-overlay-viewers` 分别由 `liraLicense.getOverlayFilters()`、`updateOverlayFilters(patch)`、
`getOverlayViewers()` 调用。仅允许当前主窗口主 frame 和精确 desktop origin；字段验证见
`src/shared/overlay-filters-contract.js`。固定 DeviceBearer `/api/device/overlay-filters` GET/PUT
返回 `{ok:true,blockedUsers:[{uid,name}],blockedKeywords:[]}`；PUT 只允许非空字段 patch，
最多 500 人/200 词、UID 为 1–20 位非零开头十进制字符串、name 最长 80 字符、词最长 100 字符。
`/api/device/overlay-viewers` GET 返回 `{ok:true,roomId,viewers:[{uid,name}]}`（最多 150 人）。
不接收租户/房间参数，不返回凭据或原始上游错误。复用主进程账号代次检查；新增端点明确 404/405
映射 `OVERLAY_FILTERS_UNSUPPORTED`，让旧服务器提示更新。其他错误沿用受限错误 DTO。
列表写入在服务器确认后才反映到界面，失败保留输入；一键清空只提交 `blockedKeywords:[]`。

`license-ipc.js` 注册 `license:get-overlay-settings` / `license:update-overlay-settings`，
由 `liraLicense.getOverlaySettings()` / `updateOverlaySettings({style, fullscreenDurationSeconds})`
调用。主进程验证当前主窗口与精确 desktop origin、样式白名单以及 2～30 秒整数，
再使用 DeviceBearer 请求固定 `/api/device/overlay-settings` GET/PUT。
成功只返回 `{ok:true, style, fullscreenDurationSeconds, overlayUrl}`；URL 必须为无凭据、
query、fragment 的 HTTPS `/overlay/<token>`，token 为 16 位 base64url，错误沿用受限 `{ok:false,state,error}`。
只读 OBS capability 是用户明确要求展示/复制的窄例外；不传递 Device token、租户选择器或任意远程调用能力。服务器持久生成密钥，客户端初次读取授权资料后调用此 GET；共享地址模块验证与资料 origin 相同，两个地址消费者共同使用完整值，账号切换清空并丢弃旧响应。桌面先编辑草稿并预览，只有显式应用才写服务器。

## 进场欢迎配置桥

由 `license-ipc.js` 注册，只接受现有主窗口与精确 desktop origin。账号选择只在
主进程完成；无凭据、租户选择器或任意地址调用暴露给 renderer。

| 通道 | 桥方法 | 返回 |
| --- | --- | --- |
| `license:get-welcome-settings` | `getWelcomeSettings()` | V1 `{ok:true,enabled,messages}` |
| `license:update-welcome-settings` | `updateWelcomeSettings(patch)` | V1 确认配置，原有白名单保留 |
| `license:get-welcome-settings-v2` | `getWelcomeSettingsV2()` | 完整 V2 白名单及 `schemaVersion:2`；仅明确 404 回落为 V1 投影及 `schemaVersion:1` |
| `license:update-welcome-settings-v2` | `updateWelcomeSettingsV2(patch)` | 完整 V2 确认配置；不降级或重放 |

字段由服务器 Device OpenAPI 定义，主进程验证见 `src/shared/welcome-settings-contract.js`。
未知 patch 字段拒绝；所有必填字段、数值范围、词库和完整配置依赖均校验。
错误保留 `{ok:false,state,error}`，可带仅含白名单字段与原因的 `fieldErrors`。
并发草稿与账号边界见 [main.md](main.md#服务器进场欢迎设置)。

## 礼物互动确认状态

`liraLicense` 增加以下窄桥，由 [gift-interaction-ipc.js](../../../src/electron/ipc/gift-interaction-ipc.js)
注册，只接受当前主窗口的主 frame 与精确 desktop origin。

| 通道 | 桥方法与参数 | 返回/事件 |
| --- | --- | --- |
| `license:get-gift-interaction-state` | `getGiftInteractionState()`，无参数，刷新现有云状态 | 确认状态快照 |
| `license:set-gift-interaction` | `setGiftInteraction(key, enabled)`，IPC 为 `{key, enabled}`；key 仅 `giftAutoThanksEnabled` / `giftStatsQueryEnabled`，enabled 必须 boolean，拒绝额外字段 | 写入结果和确认状态快照 |
| `license:gift-interaction-state-changed` | `onGiftInteractionStateChanged(callback)` 返回取消订阅函数 | 确认状态快照 |

快照固定为 `{ok, values: {giftAutoThanksEnabled, giftStatsQueryEnabled}, status, error}`。
两个 values 均为 boolean，status 为 `confirmed`、`pending` 或 `unconfirmed`；error 只允许受限大写错误码/null。
无 Cookie、CSRF、Device token、云端账号键或上游原始响应。主进程在已有同步队列中把单个意图并入完整
Device settings，省略另一开关以保留服务器值；只有返回实际目标值且状态确认才显示成功。
设置归属、失败提示与验收见 [gift-interaction-controls](../../../specs/gift-interaction-controls.md)。

> 涉及文件:[src/electron/preload.js](../../../src/electron/preload.js)、[src/electron/ipc/](../../../src/electron/ipc/)(handler 注册)、[src/electron/remote-gift-controller.js](../../../src/electron/remote-gift-controller.js)

本文档是 IPC 的**唯一事实源**:所有通道、方向、载荷、handler 摘要只在此成表,其他文档一律链接此处。窗口生命周期见 [main.md](main.md) / [windows.md](windows.md),更新语义见 [update.md](update.md),登录语义见 [auth.md](auth.md)。

## 1. 安全模型

粉丝档案使用 `window.fanProfiles.invoke({action, payload, contextId})` → `fan-profiles:invoke`；`open` 返回页面上下文 ID，档案操作必须带当前 ID；`auto-update-status` 允许无 ID，用于 Admin 启动及后台轮询取走当前归属的一次自动更新通知（`data` 为 null 或含 `reason: scheduled|startup`、`status: success|error`、成功计数或错误文案）。每日同步时机与归属由 controller 决定。同一归属持续授权时续期保留 ID；换归属或失去授权后 ID 失效。异步操作另外捕获授权代次，完成时同时检查 ID 和代次。主窗口 webContents、主 frame、精确本地 origin 和 Admin 页面路径同时校验。controller 从已认证服务器/streamerId 生成 scope，renderer 无权选择。返回 `{ok, contextId, data, syncStatus}` 或可展示错误，不含 token。命令包括档案/记录修订、会员证据选择、提醒状态、备份预览/恢复、旧流水认领、草稿合并、本机恢复点及删除抑制管理；输入由 `src/fans/validation.js` 和领域服务校验，详见 [粉丝档案](../../../specs/fan-profiles.md)。controller 拥有定时器、取消与账号代次，关闭时先 dispose 并等待 whenIdle，再关闭数据库。

新增第五个白名单桥 `dynamicLotteryAuth`，原有四个桥保持兼容。该桥的三个 invoke 均要求当前主窗口 webContents、主 frame 对象及精确 desktopBaseUrl origin；其他窗口、子 frame 或外部页面无权调用。它不暴露 Cookie、快照路径、`getContext` 或授权身份参数。

| 项          | 配置                                                                                                                                                                                               | 出处                                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 上下文隔离  | `contextIsolation: true`(所有窗口)                                                                                                                                                                 | [main.js:324](../../../src/electron/main.js#L324)                                                                                |
| Node 注入   | `nodeIntegration: false`(所有窗口)                                                                                                                                                                 | [main.js:324](../../../src/electron/main.js#L324)                                                                                |
| 暴露方式    | `contextBridge.exposeInMainWorld` 五个白名单对象                                                                                                                                                   | [preload.js](../../../src/electron/preload.js)                                                                                   |
| ipcRenderer | **不直接暴露**,仅经桥方法间接调用                                                                                                                                                                  | —                                                                                                                                |
| 来源校验    | `music:resolve-local-media-urls` / `music:select-wesing-cache` 以及全部 `license:*` invoke 校验 `senderFrame.url` 的 origin 与 desktopBaseUrl 一致;授权 IPC 还要求 sender 为当前主窗口 webContents | [local-media-access.js](../../../src/electron/local-media-access.js)、[license-ipc.js](../../../src/electron/ipc/license-ipc.js) |

`liraLicense` 只暴露经过参数约束的设备授权操作和无参数的礼物目录初始化状态/重试。access token、设备私钥、原始硬件标识、图片源 URL 和可配置远端 URL 均不进入目录进度快照；背景响应仅附带由 main process 从可信服务 origin 与相对路径解析出的 `previewUrl`。远端 HTTPS 请求、签名、续期、heartbeat 和错误状态收敛全部由 main process 的 `license-manager.js` 完成。

目录进度同时供首次登录卡和 Admin 后台更新 toast 消费：首次为 `running`，后续为 `updating`；后续 `images` 阶段的 `total/completed/available/failed` 仅统计本次需下载的图片，`catalog` 阶段和零下载检查不提示。完成进入 `ready`，单图失败保留旧图并报告部分失败。新增脱敏字段 `background`（严格布尔值）和 `completedAt`（规范化 ISO 时间或 null）区分本次后台更新与首次初始化/磁盘恢复状态，让 Admin 加载前已结束的更新也能提示且去重；授权/来源校验不变。

首次准备失败时可在当前页面返回登录表单；此操作保留本机授权，表单的“继续准备”仍调用 `retryGiftCatalog`，无需重新激活。返回后忽略迟到的目录进度，授权失效时按授权状态显示错误，只有用户继续准备才重新显示初始化卡；进入 Admin 的条件仍由 main process 判定。

服务端权威礼物流同样只属于 Electron main：`remote-gift-controller.js` 在 main process 持有 DeviceBearer、SSE reader、cursor 对账；当前 cursor 由本地礼物投影事务持久化到 SQLite 的 `gift_sync_state`；`preload.js` 不新增 remote gift/token/SSE handle 的 IPC。renderer 继续通过本地 HTTP/WS 的 snapshot 与 `gift:frame` 消费已投影的礼物数据，不能直接访问 lira-server 礼物接口。

## 2. IPC 全量注册表(唯一成表处)

### 2.1 renderer → main(invoke)

| 通道                                  | 载荷                                                                    | 返回                                                                                             | handler 摘要                                                               | 出处                                                       |
| ------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `desktop:get-info`                    | —                                                                       | `{version, isPackaged, platform, dataDir, logFile, terminalLogFile, githubRepoUrl, updateState}` | 桌面环境信息汇总                                                           | [desktop-ipc.js](../../../src/electron/ipc/desktop-ipc.js) |
| `desktop:check-for-updates`           | —                                                                       | 更新状态对象                                                                                     | 触发 GitHub 更新检查([update.md](update.md) §4)                            | [desktop-ipc.js](../../../src/electron/ipc/desktop-ipc.js) |
| `desktop:download-update`             | —                                                                       | 更新状态对象                                                                                     | 下载新版本                                                                 | [desktop-ipc.js](../../../src/electron/ipc/desktop-ipc.js) |
| `desktop:install-update`              | —                                                                       | 更新状态对象                                                                                     | 安装并重启(`quitAndInstall`)                                               | [desktop-ipc.js](../../../src/electron/ipc/desktop-ipc.js) |
| `desktop:open-data-dir`               | —                                                                       | `''` 或错误信息                                                                                  | `shell.openPath(dataDir)`                                                  | [desktop-ipc.js](../../../src/electron/ipc/desktop-ipc.js)          |
| `desktop:open-log-dir`                | —                                                                       | `''` 或错误信息                                                                                  | `shell.openPath(logDir)`                                                   | [desktop-ipc.js](../../../src/electron/ipc/desktop-ipc.js)          |
| `desktop:open-github`                 | —                                                                       | Promise                                                                                          | 系统浏览器打开 GitHub 仓库                                                 | [desktop-ipc.js](../../../src/electron/ipc/desktop-ipc.js)          |
| `desktop:set-auto-update`             | `enabled: boolean`                                                      | undefined                                                                                        | **仅记日志**;持久化由渲染进程经 `/api/settings` 完成                       | [desktop-ipc.js](../../../src/electron/ipc/desktop-ipc.js) |
| `desktop:gift-display`                | 兼容旧 renderer 的礼物对象                                             | `{ok:true}`                                                                                      | A1 兼容 no-op；不再保存逐条礼物/toast 正文                                | [update-ipc.js](../../../src/electron/ipc/update-ipc.js) |
| `desktop:restart`                     | —                                                                       | undefined                                                                                        | 关停服务器 → `app.relaunch()` + `app.exit(0)`                              | [desktop-ipc.js](../../../src/electron/ipc/desktop-ipc.js) |
| `desktop:close-window`                | —                                                                       | undefined                                                                                        | 关闭主窗口                                                                 | [desktop-ipc.js](../../../src/electron/ipc/desktop-ipc.js) |
| `desktop:minimize-window`             | —                                                                       | undefined                                                                                        | 最小化主窗口                                                               | [desktop-ipc.js](../../../src/electron/ipc/desktop-ipc.js) |
| `desktop:maximize-window`             | —                                                                       | undefined                                                                                        | 最大化/还原切换                                                            | [desktop-ipc.js](../../../src/electron/ipc/desktop-ipc.js) |
| `music:get-auth-state`                | `platform: 'qq' \| 'netease'`                                           | 平台 auth state([auth.md](auth.md) §4)                                                           | 读分区 Cookie 判定登录态                                                   | [music-ipc.js](../../../src/electron/ipc/music-ipc.js)          |
| `music:login`                         | `platform`                                                              | `{platform, snapshot, state}`                                                                    | 打开音乐登录窗并等待关闭([windows.md](windows.md) §2)                      | [music-ipc.js](../../../src/electron/ipc/music-ipc.js)          |
| `music:logout`                        | `platform`                                                              | 最新 auth state                                                                                  | 清分区 + 删快照([auth.md](auth.md) §7)                                     | [music-ipc.js](../../../src/electron/ipc/music-ipc.js)          |
| `music:clear-cache` | — | `{cleared:[platform]}` | 清理音乐浏览器缓存；实现见 `clearMusicBrowserCache` | [music-ipc.js](../../../src/electron/ipc/music-ipc.js) |
| `music:provider-health`               | `platform`                                                              | 平台健康检查结果                                                                                 | 临时构造 provider 注册表执行 healthCheck                                   | [music-ipc.js](../../../src/electron/ipc/music-ipc.js) |
| `music:select-local-files`            | —                                                                       | `{ok, canceled, files:[{path,name,ext}]}`                                                        | 多选音频文件对话框 + `allowPaths` 入白名单([main.md](main.md) §5)          | [music-ipc.js](../../../src/electron/ipc/music-ipc.js) |
| `music:get-recent-local-files` | — | `{files:[{path,name,ext}]}` | 从本地媒体白名单取仍存在的文件 | [music-ipc.js](../../../src/electron/ipc/music-ipc.js) |
| `music:select-wesing-cache`           | —                                                                       | `{ok, canceled, path}`                                                                           | 目录对话框选 WeSingCache(校验 origin;默认路径取设置 `weSingCachePath`)     | [music-ipc.js](../../../src/electron/ipc/music-ipc.js) |
| `music:resolve-local-media-urls`      | `paths: string[]`                                                       | `{results: {[path]: {ok, url? / reason?}}}`                                                      | 校验 origin;存在且被允许的文件生成 `local-media://media/<base64url>` URL   | [music-ipc.js](../../../src/electron/ipc/music-ipc.js) |
| `playback:save-state`                 | `{clientId, payload}`                                                   | `{ok, …}`(playback-store 结果)                                                                   | 持久化播放快照([storage.md](../backend/storage.md) §3.4)                   | [music-ipc.js](../../../src/electron/ipc/music-ipc.js) |
| `playback:flush-ack`                  | —                                                                       | `{ok:true}`                                                                                      | 应答 `app:prepare-shutdown` 握手(§3)                                       | [music-ipc.js](../../../src/electron/ipc/music-ipc.js) |
| `license:get-state`                   | —                                                                       | `{ok:true, state, error, streamer?, device?}`                                                    | 返回授权状态机快照(脱敏,不含 token/私钥)                                   | [license-ipc.js](../../../src/electron/ipc/license-ipc.js) |
| `license:activate`                    | `{accountName, password, activationCode}`                               | `{ok, state, streamer?}` 或 `{ok:false, error}`                                                  | 校验载荷长度后走激活 + challenge/verify(见 [main.md](main.md) §2.1)        | [license-ipc.js](../../../src/electron/ipc/license-ipc.js) |
| `license:retry`                       | —                                                                       | `{ok, state, …}`                                                                                 | 从 `NEEDS_CONNECTION` 重新 bootstrap                                       | [license-ipc.js](../../../src/electron/ipc/license-ipc.js) |
| `license:get-gift-catalog-state`      | —                                                                       | `{ok:true,status,background,phase,completed,total,available,failed,percent,currentGiftId,currentGiftName,completedAt,error,warning}` | 读取经过字段和长度约束的本地目录初始化/后台更新进度，不返回 URL 或凭据               | [license-ipc.js](../../../src/electron/ipc/license-ipc.js) |
| `license:retry-gift-catalog`          | —                                                                       | 同上，`ok` 表示最终状态是否为 `ready`                                                         | 仅授权状态可重试首次目录/图片初始化；renderer 不能提交 URL、路径或 ID         | [license-ipc.js](../../../src/electron/ipc/license-ipc.js) |
| `license:get-profile`                 | —                                                                       | `{ok:true, state, streamer?, device?}`                                                           | 经设备 token 读云端主播资料并刷新快照                                      | [license-ipc.js](../../../src/electron/ipc/license-ipc.js) |
| `license:sync-songs`                  | `songs: array`(≤5000,IPC 载荷 ≤4MB)                                     | `{ok:true, count}`                                                                               | 全量覆盖云端歌单(手动触发,见 [pages.md](../frontend/pages.md))             | [license-ipc.js](../../../src/electron/ipc/license-ipc.js) |
| `license:get-cloud-songs`             | —                                                                       | `{songs:[…]}`                                                                                    | 读云端歌单(用于覆盖前数量对比;响应形状防御性解析)                          | [license-ipc.js](../../../src/electron/ipc/license-ipc.js) |
| `license:get-song-page-background`    | —                                                                       | `{ok:true, background:null\|{url,bytes,updatedAt}}`                                              | 通过设备授权查询云端歌单页背景                                             | [license-ipc.js](../../../src/electron/ipc/license-ipc.js) |
| `license:upload-song-page-background` | `{bytes: Uint8Array, fileName: string}`                                 | `{ok:true, background:{url,bytes,updatedAt}}`                                                    | IPC 边界限制 5MB 后，通过设备授权上传原始图片字节                          | [license-ipc.js](../../../src/electron/ipc/license-ipc.js) |
| `license:delete-song-page-background` | —                                                                       | `{ok:true, background:null}`                                                                     | 通过设备授权删除云端歌单页背景                                             | [license-ipc.js](../../../src/electron/ipc/license-ipc.js) |
| `bilibili:get-auth-state`             | —                                                                       | Bilibili auth state([auth.md](auth.md) §4)                                                       | 读 Bilibili 登录分区判定登录态                                             | [bilibili-ipc.js](../../../src/electron/ipc/bilibili-ipc.js)          |
| `bilibili:get-profile`                | —                                                                       | `{uid, name, avatarUrl}`                                                                         | 读取当前登录 UID 对应的公开账号昵称与可信头像地址                         | [bilibili-ipc.js](../../../src/electron/ipc/bilibili-ipc.js) |
| `bilibili:login`                      | —                                                                       | `{snapshot, state}`                                                                              | 打开 B站登录窗并等待关闭([windows.md](windows.md) §3)                      | [bilibili-ipc.js](../../../src/electron/ipc/bilibili-ipc.js)          |
| `bilibili:logout`                     | —                                                                       | 最新 auth state                                                                                  | 清分区 + 删快照 + 删明文导出                                               | [bilibili-ipc.js](../../../src/electron/ipc/bilibili-ipc.js)          |

抽奖专用登录的新增 invoke（所有载荷均为空，不接收 UID/streamerId/Cookie）：

| 通道 | 返回 | handler |
| --- | --- | --- |
| `dynamic-lottery-auth:get-state` | `{ok:true,state:{loggedIn,uid,warning}}` | 按可信 LIRA 主体读取专用账号状态 |
| `dynamic-lottery-auth:login` | 同上，等待独立窗口关闭 | 专用账号单窗口登录，不切换直播账号 |
| `dynamic-lottery-auth:logout` | 同上，成功后 loggedIn 为 false | 取消该主体登录窗口并清除其专用登录 |

所有者：[dynamic-lottery-auth-ipc.js](../../../src/electron/ipc/dynamic-lottery-auth-ipc.js)。错误统一 `{ok:false,error}`；公开错误码仅 `IPC_SOURCE_INVALID`、`LOTTERY_IDENTITY_UNAVAILABLE`、`LOTTERY_SESSION_CHANGED`、`LOTTERY_SESSION_DISPOSED`、`LOTTERY_AUTH_BUSY`、`LOTTERY_AUTH_ENCRYPTION_UNAVAILABLE`、`LOTTERY_AUTH_RESTORE_FAILED`、`LOTTERY_AUTH_FAILED`，不回传原始异常。`uid` 是十进制字符串，未登录为空；`warning` 只可为白名单代码或空字符串。调用方是 `public/js/admin/dynamic-lottery.js` 的 `window.dynamicLotteryAuth.getState/login/logout`，普通浏览器无桥时不可登录；不增加 HTTP 免鉴权入口。

### 2.2 main → renderer(send)

| 通道                       | 载荷                                                                                                             | 发送点                                                 | 接收方                                          | 出处                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------- |
| `desktop:update-state`     | `{status, message, version, canDownload, canInstall, progress, updateVersion}`(形状见 [update.md](update.md) §4) | 更新状态每次变化(`sendUpdateState`)                    | 主窗口 `songAssistantDesktop.onUpdateState`     | [main.js:706-710](../../../src/electron/main.js#L706-L710)          |
| `desktop:window-maximized` | `boolean`                                                                                                        | 主窗口 maximize/unmaximize 事件                        | 主窗口 `songAssistantDesktop.onWindowMaximized` | [main.js:364-374](../../../src/electron/main.js#L364-L374)          |
| `app:prepare-shutdown`     | —                                                                                                                | 关闭时序 `requestPlaybackFlush`([main.md](main.md) §7) | 主窗口 `musicAPI.onPrepareShutdown`             | [playback-flush.js:22](../../../src/electron/playback-flush.js#L22) |
| `license:state-changed`    | `{state, error, streamer?, device?}`(脱敏快照)                                                                   | 授权状态机每次迁移                                     | 所有窗口 `liraLicense.onStateChanged`           | [license-ipc.js](../../../src/electron/ipc/license-ipc.js)          |
| `license:gift-catalog-state-changed` | `{status,background,phase,completed,total,available,failed,percent,currentGiftId,currentGiftName,completedAt,error,warning}`              | 首次初始化或后台增量扫描进度变化                       | 激活页与 Admin `liraLicense.onGiftCatalogStateChanged`  | [license-ipc.js](../../../src/electron/ipc/license-ipc.js)          |

> `desktop:show-update-page` 在 preload 注册了监听([preload.js:19-25](../../../src/electron/preload.js#L19-L25)),但当前 main 进程未发送此事件,属预留通道。

> 礼物远程接收没有对应的 renderer IPC 通道：progress/final 事件由 main 导入内嵌 runtime 后，沿既有本地 snapshot、历史和 WebSocket `gift:frame` 路径到达页面。

## 3. 播放状态持久化流

```
播放页: StorageManager → musicAPI.savePlaybackState(clientId, payload)     [preload.js:61]
  → invoke('playback:save-state') → desktopRuntime.persistPlaybackSnapshot  [ipc/music-ipc.js]
  → 服务器 playback-store 落库 play_queue_state(见 [../backend/storage.md](../backend/storage.md) §3.4)

关闭时序: Main 发 'app:prepare-shutdown'                                    [playback-flush.js:22]
  → 播放页 onPrepareShutdown 回调 → 立即保存 → confirmShutdownFlush()        [preload.js:62-69]
  → invoke('playback:flush-ack') → acknowledgePlaybackFlush                  [playback-flush.js:29-33]
  → Main 2s 超时安全网(见 [main.md](main.md) §7)
```

## 4. 调用方地图

| 桥对象                 | 方法                                                                                                                                                  | 调用方(前端)                                                                              | 页面文档                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `songAssistantDesktop` | getInfo / checkForUpdates / downloadUpdate / installUpdate / onUpdateState / onShowUpdatePage / openDataDir / openLogDir / openGithub / setAutoUpdate | 管理页 `js/desktop.js`(更新面板、数据/日志/GitHub 入口)                                   | [../frontend/pages.md](../frontend/pages.md)                                |
| `songAssistantDesktop` | minimizeWindow / maximizeWindow / closeWindow / onWindowMaximized / restart                                                                           | 管理页 `js/admin/settings.js`(自绘窗口控件、重启)                                         | 同上                                                                        |
| `songAssistantDesktop` | reportGiftDisplay                                                                                                                                     | 仅保留旧 renderer 兼容；当前礼物通知不再调用                                             | 同上                                                                        |
| `musicAPI`             | getAuthState / providerHealth / login / logout                                                                                                        | 播放页 `js/playback/provider/manager.js`、`js/playback/operations/provider-operations.js` | 同上                                                                        |
| `musicAPI`             | selectLocalFiles / getRecentLocalFiles / resolveLocalMediaUrls                                                                                                              | 播放页 `js/playback/local/manager.js`、`js/playback/features/playback-controls.js`        | 同上                                                                        |
| `musicAPI`             | selectWeSingCacheDirectory                                                                                                                            | 播放页 `js/playback/services/wesing-service.js`(全民K歌设置)                              | 同上,WeSing 语义见 [../backend/music/wesing.md](../backend/music/wesing.md) |
| `musicAPI`             | savePlaybackState / onPrepareShutdown / confirmShutdownFlush                                                                                          | 播放页 `js/playback/operations/state-persistence.js`、`js/playback/core/initializer.js`   | 同上                                                                        |
| `liraLicense`          | getState / activate / retry / onStateChanged / getGiftCatalogState / retryGiftCatalog / onGiftCatalogStateChanged                                     | 激活页 `js/license.js`（授权表单与首次礼物目录初始化进度）及 Admin `gifts/catalog-update-toast.js`（后台更新进度）                                  | [../frontend/pages.md](../frontend/pages.md)                                |
| `liraLicense`          | getProfile / syncSongs / getCloudSongs / getSongPageBackground / uploadSongPageBackground / deleteSongPageBackground                                  | 管理页 `js/admin/import.js`(云端歌单同步 + 歌单页背景面板)和 `js/admin/settings.js`(只读账户资料) | [../frontend/pages.md](../frontend/pages.md)                                |
| `bilibiliAuth`         | getAuthState / getProfile / login / logout                                                                                                            | 管理页 `js/admin/settings.js`(Bilibili 登录区)                                            | 同上                                                                        |

`getRecentLocalFiles` 已由 preload 暴露，并在 `music-ipc.js` 注册；浏览器环境的特性检测保留。

## 云端签到与抽签

`dailyBots.invoke({ action, contextId, payload })` → `daily-bots:invoke`，由 `ipc/daily-bot-ipc.js` 限定主窗口、顶层 frame、精确 loopback origin 和管理页面。action 仅 open/summary/update/decide/prepare/apply/cancel；main 的 daily-bot-controller 持有授权代际和最终快照，license operations 只允许固定 Device 路径。renderer 不获取 token、Cookie 或文件选择能力。服务端响应白名单由 shared/daily-bot-contract 校验；错误只返回公开代码。开关显示服务器确认值与 observedAt，失败不回退本地。

当前界面只调用 open/update，首次开启不依赖旧数据确认；其余 action 保留兼容。云端备份整库恢复无需通过这些导入 action，界面也不展示旧数据或接管结果。
