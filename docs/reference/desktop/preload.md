# preload 桥与 IPC 全量注册表

[preload.js](../../../src/electron/preload.js) 向渲染进程暴露 `playbackOutput`、`audioAssistant`、`plannerReminders`、`desktopNotifications`、`dailyBots`、`fanProfiles`、`giftExport`、`weeklySchedule`、`songAssistantDesktop`、`musicAPI`、`bilibiliAuth`、`dynamicLotteryAuth`、`guardExpiryAuth`、`liraLicense` 十四个命名空间。本文档是 IPC 通道、方向、载荷与 action 的**单一事实来源**；窗口生命周期见 [main.md](main.md)，更新状态见 [update.md](update.md)，登录与会话见 [auth.md](auth.md)。下表按 `invoke` 通道、主进程推送事件与复用通道内的 `action` 分别登记，不合并计数。

## 1. 安全模型

所有桥仅暴露固定方法，不暴露 `ipcRenderer`、任意 URL 请求、Device 令牌、Cookie 或租户选择器。主窗口保持 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`。下表列出各组 IPC 的实际来源校验规则；不同注册器的校验范围不同，不能一概而论。

| 处理器归属模块 | 当前主窗口 `webContents` 与精确本地源 | 主 frame 对象 | 允许路径（`pathname`） |
| --- | --- | --- | --- |
| [main-window-ipc.js](../../../src/electron/ipc/main-window-ipc.js)：music、playback、playback-output、bilibili、audio-assistant、desktop 资源检查与客户端外观 | 必须 | 必须 | `/`、`/admin`、`/settings`、`/songs` |
| [screen-color-picker.js](../../../src/electron/screen-color-picker.js)：桌面全屏取色（复用主窗口注册器） | 必须 | 必须 | `/`、`/admin`、`/settings`、`/songs` |
| [desktop-shell-ipc.js](../../../src/electron/ipc/desktop-shell-ipc.js)：其余 desktop 通道 | 必须 | 必须 | 上述路径加 `/license` |
| [daily-bot-ipc.js](../../../src/electron/ipc/daily-bot-ipc.js) | 必须 | 必须 | `/`、`/admin`、`/settings` |
| [planner-reminder-ipc.js](../../../src/electron/ipc/planner-reminder-ipc.js) | 必须 | 必须 | 仅 `/admin` |
| [desktop-notifications-ipc.js](../../../src/electron/ipc/desktop-notifications-ipc.js) | 必须 | 必须 | 仅 `/admin` |
| [weekly-schedule-ipc.js](../../../src/electron/ipc/weekly-schedule-ipc.js)：周表 PNG 导出（复用主窗口注册器） | 必须 | 必须 | `/`、`/admin`、`/settings`、`/songs` |
| [fan-profile-ipc.js](../../../src/electron/ipc/fan-profile-ipc.js)、[gift-export-ipc.js](../../../src/electron/ipc/gift-export-ipc.js)（复用主窗口注册器） | 必须 | 必须 | `/`、`/admin`、`/settings`、`/songs` |
| [guard-expiry-ipc.js](../../../src/electron/ipc/guard-expiry-ipc.js)：大航海到期同步 | 必须 | 必须 | `/`、`/admin`、`/settings`、`/songs` |
| [dynamic-lottery-auth-ipc.js](../../../src/electron/ipc/dynamic-lottery-auth-ipc.js)、[gift-interaction-ipc.js](../../../src/electron/ipc/gift-interaction-ipc.js)（复用主窗口注册器） | 必须 | 必须 | `/`、`/admin`、`/settings`、`/songs` |
| [license-ipc.js](../../../src/electron/ipc/license-ipc.js)：统一 `safeHandle`，含 [font-library-ipc.js](../../../src/electron/ipc/font-library-ipc.js) | 必须 | 必须 | 复用主窗口注册器：`/`、`/admin`、`/settings`、`/songs`、`/license`；字体重试另要求已授权 |

非法来源返回 `{ok:false,error:'IPC_SOURCE_INVALID'}`；授权注册器通过共享拒绝回调额外保留脱敏 `state`。`/license` 用于首次激活、状态与初始化进度读取；同源子 frame 与其他同源页面不能通过授权来源检查。来源校验不替代远端授权，具体操作仍受 `LicenseManager` 的授权与代次约束。当前主窗口匹配同时限定实际 Chromium `session`，渲染进程不能指定分区。

标准四个管理页路径由 [admin-page-paths.js](../../../src/shared/admin-page-paths.js) 定义。daily-bot、planner-reminder 与 desktop-notifications 同样复用主窗口注册器，但显式传入表中更窄的路径；后两者还在注册时声明各通道允许的参数数量。

## 2. renderer → main（`invoke`）

下表中「无参数」表示 preload 不传参；资源检查及客户端外观处理器会显式校验参数个数。除明确标出的错误封装外，旧 `music` / `bilibili` / `desktop` 处理器抛出的异常会使 `invoke` Promise reject，调用方不能假定所有返回都带 `ok`。

### 2.1 songAssistantDesktop

归属模块：[desktop-shell-ipc.js](../../../src/electron/ipc/desktop-shell-ipc.js)，客户端外观由 [client-appearance-ipc.js](../../../src/electron/ipc/client-appearance-ipc.js) 负责。直接调用方为 [desktop.js](../../../public/js/desktop.js) 的更新/目录入口与窗口控件、[settings-operations.js](../../../public/js/admin/settings-operations.js) 及 [desktop-resource-integrity.js](../../../public/js/desktop-resource-integrity.js)。

| 通道 | 桥方法与输入 | 成功返回 / 公开失败 |
| --- | --- | --- |
| `desktop:set-client-theme` | `setClientTheme(themeId)`，恰好一个合法主题 ID 字符串（枚举及默认值定义见 [client-theme.js](../../../src/shared/client-theme.js)） | 成功 `{ok:true,themeId}`；失败 `{ok:false,error}`（`IPC_SOURCE_INVALID` / `IPC_ARGUMENTS_INVALID` / `CLIENT_THEME_INVALID` / `CLIENT_THEME_SAVE_FAILED`），失败不切换已提交状态 |
| `desktop:set-client-font` | `setClientFont(fontId)`。受信管理主窗口提交一个界面字体 ID，`system` 恢复客户端原有排版 | 成功 `{ok:true,fontId}`。失败 `{ok:false,error}`，错误码为 `IPC_SOURCE_INVALID`、`IPC_ARGUMENTS_INVALID`、`CLIENT_FONT_INVALID` 或 `CLIENT_THEME_SAVE_FAILED`。候选见[字体主题目录](../../../public/js/shared/client-font-theme.js)。 |
| `desktop:get-info` | `getInfo()` | `{version,isPackaged,platform,dataDir,logFile,terminalLogFile,githubRepoUrl,updateState}` |
| `desktop:pick-screen-color` | `pickScreenColor()`，无参数（归属模块：[screen-color-picker.js](../../../src/electron/screen-color-picker.js)，调用方：共享 `color-picker.js`） | 选中 `{ok:true,sRGBHex:'#rrggbb'}`；取消 `{ok:true,canceled:true}`；失败 `{ok:false,error}`（`IPC_SOURCE_INVALID` / `IPC_ARGUMENTS_INVALID` / `SCREEN_COLOR_PICK_BUSY` / `SCREEN_COLOR_PICK_FAILED`） |
| `desktop:cancel-screen-color` | `cancelScreenColor()`，无参数；仅受信主窗口可取消 | `{ok:true}`；来源或参数错误同上；无进行中取色时无副作用 |
| `desktop:get-resource-integrity-state` | `getResourceIntegrityState()` | 资源检查快照；多余参数返回 `IPC_ARGUMENTS_INVALID` |
| `desktop:check-resource-integrity` | `checkResourceIntegrity()` | 当前或新建任务快照，重复请求合并；多余参数同上 |
| `desktop:check-for-updates` | `checkForUpdates()` | 更新状态对象，字段与错误状态见 [update.md](update.md) |
| `desktop:download-update` | `downloadUpdate()` | 更新状态对象 |
| `desktop:install-update` | `installUpdate()` | 更新状态对象；安装前停止资源检查，生命周期见 [main.md](main.md#7-关闭序列与播放状态冲刷) |
| `desktop:open-data-dir` | `openDataDir()` | 成功返回空字符串；目录未就绪或 `shell.openPath` 返回错误文本时 reject，由桌面入口提示失败 |
| `desktop:open-log-dir` | `openLogDir()` | 同上 |
| `desktop:open-github` | `openGithub()` | `undefined`（调用系统浏览器打开固定仓库地址） |
| `desktop:set-auto-update` | `setAutoUpdate(enabled)`，布尔值 | `undefined`；处理器仅记录 `Boolean(enabled)`，设置另经 HTTP 持久化 |
| `desktop:gift-display` | `reportGiftDisplay(gift)`，兼容旧参数 | 返回 `{ok:true}`，空操作（历史兼容保留，当前无业务调用方） |
| `desktop:restart` | `restart()` | `undefined`；受控关停后重启或退出 |
| `desktop:close-window` | `closeWindow()` | `undefined` |
| `desktop:minimize-window` | `minimizeWindow()` | `undefined` |
| `desktop:maximize-window` | `maximizeWindow()` | `undefined`；切换最大化状态 |

外观桥不接受路径、CSS 或 URL，外部工具页面无写入权限（新打开工具通过 HTML 获取只读主题）。资源快照的 `revision`、状态及错误语义见 [更新文档](update.md)「客户端资源检查」。

取色专用预加载脚本不向页面暴露主桌面桥。内部 `screen-color-picker:image`（主进程 → 临时窗口）仅发送本屏内存 PNG data URL；`screen-color-picker:reply`（临时窗口 → 主进程）发送 `{type:'ready'}`、`{type:'cancel'}` 或 `{type:'pick',x,y}`（归一化坐标，有限数且 `0 ≤ x,y < 1`）。主进程仅接受当前操作已登记窗口的 `mainFrame` 与精确本地页面 URL，依据内存图像计算 HEX，主桌面页面无法获取截图。临时窗口生命周期见 [windows.md](windows.md#5-全屏取色窗口)。

### 2.2 musicAPI 与 bilibiliAuth

归属模块：[music-ipc.js](../../../src/electron/ipc/music-ipc.js)、[bilibili-ipc.js](../../../src/electron/ipc/bilibili-ipc.js)，会话任务由 [desktop-auth-controller.js](../../../src/electron/desktop-auth-controller.js) 串行化与取消。音乐平台字符串经 `trim` / 转小写后仅接受 `qq` / `netease`，无效平台直接 reject；健康查询允许省略平台以查询全部。

| 通道 | 桥方法与输入 | 成功返回 / 特殊约束 |
| --- | --- | --- |
| `music:get-auth-state` | `musicAPI.getAuthState(platform)` | `MusicAuth`（见下文） |
| `music:login` | `musicAPI.login(platform)` | `{platform,snapshot,state}`，等待登录窗关闭，`state` 为 `MusicAuth`（读取失败时仅 `{loggedIn:false}`） |
| `music:logout` | `musicAPI.logout(platform)` | 最新 `MusicAuth` |
| `music:clear-cache` | `musicAPI.clearCache()` | `{cleared:[platform]}`，只清浏览器缓存 |
| `music:provider-health` | `musicAPI.providerHealth(platform?)` | 单个 `{source,name,ok,status,message,auth}` 或数组；`status` 为 `logged-in` / `public-ok` / `api-error`，`auth` 为脱敏登录摘要（见 [provider-registry.js](../../../src/music/provider-registry.js)） |
| `music:select-local-files` | `musicAPI.selectLocalFiles()` | `{ok:true,canceled,files:[{path,name,ext}]}`；取消时 `files=[]`；原生对话框限选 `mp3`/`flac`/`wav`/`aac`/`ogg`/`m4a`/`wma`，选中路径加入本地媒体允许列表 |
| `music:get-recent-local-files` | `musicAPI.getRecentLocalFiles()` | `{files:[{path,name,ext}]}`，仅仍存在的已允许路径 |
| `music:select-wesing-cache` | `musicAPI.selectWeSingCacheDirectory()` | `{ok:true,canceled,path}`；取消时 `path=''`，选目录不等于保存配置 |
| `music:resolve-local-media-urls` | `musicAPI.resolveLocalMediaUrls(paths)`，字符串数组（非数组按 `[]`） | `{results:{[path]:{ok:true,url} 或 {ok:false,reason}}}`；`reason` 为 `missing` / `not-allowed` / `error`，URL 为 `local-media://media/<base64url>` |
| `playback:save-state` | `musicAPI.savePlaybackState(clientId,payload)` → `{clientId,payload}` | `{saved:true,bytes}`（`bytes` 为 JSON 文本的 `String.length`）或 `{saved:false,reason:'stale-snapshot'}`；异常为 `{ok:false,error}`，运行时未就绪返回 `{ok:false,error:'Playback store not available'}`；缺省 `clientId='default'`、`payload={}`，快照格式见 [播放文档](../frontend/playback.md) |
| `playback:flush-ack` | `musicAPI.confirmShutdownFlush()` | `{ok:true}`，确认当前退出冲刷 |
| `bilibili:get-auth-state` | `bilibiliAuth.getAuthState()` | `BilibiliAuth`（见下文） |
| `bilibili:get-profile` | `bilibiliAuth.getProfile()` | `{uid,name,avatarUrl}`；未登录时 `uid` 为 `0` 或当前值，名称与头像为空 |
| `bilibili:login` | `bilibiliAuth.login()` | `{snapshot,state}`，`state` 为 `BilibiliAuth`（读取失败时仅 `{loggedIn:false}`） |
| `bilibili:logout` | `bilibiliAuth.logout()` | 最新 `BilibiliAuth` |

`MusicAuth` 为 `{platform,name,loggedIn,cookieCount,keyCookieNames,encryptedSnapshotExists,lastSavedAt,encryptionAvailable}`；`BilibiliAuth` 无 `platform`，新增 `uid`、`hasSessdata`，均不含 Cookie 明文。`snapshot` 为保存元数据（可为空，含 `savedAt` / `cookieCount`）。底层实现归属 [music-auth-manager.js](../../../src/electron/music-auth-manager.js) 与 [bilibili-auth.js](../../../src/electron/bilibili-auth.js)。

直接调用方：音乐登录与健康由 [provider/manager.js](../../../public/js/playback/provider/manager.js)、[provider-operations.js](../../../public/js/playback/operations/provider-operations.js) 调用；文件与 URL 由 [local/manager.js](../../../public/js/playback/local/manager.js) 与 [playback-controls.js](../../../public/js/playback/features/playback-controls.js) 调用；WeSing 由 [wesing-service.js](../../../public/js/playback/services/wesing-service.js) 调用；保存与退出冲刷由 [state-persistence.js](../../../public/js/playback/operations/state-persistence.js)、[initializer.js](../../../public/js/playback/core/initializer.js) 调用；Bilibili 由 [settings-auth.js](../../../public/js/admin/settings-auth.js) 调用。

### 2.3 dynamicLotteryAuth

归属模块：[dynamic-lottery-auth-ipc.js](../../../src/electron/ipc/dynamic-lottery-auth-ipc.js)，调用方：[dynamic-lottery.js](../../../public/js/admin/dynamic-lottery.js)。不接收 UID、`streamerId`、Cookie 或快照路径。

| 通道 | 桥方法与输入 | 返回 |
| --- | --- | --- |
| `dynamic-lottery-auth:get-state` | `getState()` | `{ok:true,state:{loggedIn,uid,warning}}` |
| `dynamic-lottery-auth:login` | `login()` | 同上，等待独立抽奖账号窗口关闭 |
| `dynamic-lottery-auth:logout` | `logout()` | 同上，清除当前主体的专用会话 |

`uid` 仅接受 1–64 位非零开头十进制字符串，未登录为空字符串；`warning` 为公开代码或空字符串。失败 `{ok:false,error}` 仅透传 `IPC_SOURCE_INVALID`、`LOTTERY_IDENTITY_UNAVAILABLE`、`LOTTERY_SESSION_CHANGED`、`LOTTERY_SESSION_DISPOSED`、`LOTTERY_AUTH_BUSY`、`LOTTERY_AUTH_ENCRYPTION_UNAVAILABLE`、`LOTTERY_AUTH_RESTORE_FAILED`，其余收敛为 `LOTTERY_AUTH_FAILED`。隔离与取消边界见 [auth.md](auth.md#14-动态抽奖专用账号)。

### 2.4 liraLicense

除礼物互动外，统一注册与来源检查由 [license-ipc.js](../../../src/electron/ipc/license-ipc.js) 负责；弹幕、欢迎和 PK 设置处理器位于 [license-overlay-ipc.js](../../../src/electron/ipc/license-overlay-ipc.js)，歌单与背景处理器位于 [license-songs-ipc.js](../../../src/electron/ipc/license-songs-ipc.js)，公共返回值过滤位于 [license-public-values.js](../../../src/electron/ipc/license-public-values.js)。子模块仅通过统一 `safeHandle` 注册。失败一般返回 `{ok:false,state,error,index?,fieldErrors?}`：`error` 匹配 `^[A-Z][A-Z0-9_]{0,63}$`（其余收敛为 `LICENSE_ERROR`），`index` 为非负安全整数，`fieldErrors` 仅保留欢迎设置白名单字段与原因。远端请求的凭据与授权代次由 `LicenseManager` 维护（见 [auth.md](auth.md) §15）。

| 通道 | 桥方法与输入 | 成功 DTO / 特有公开错误 | 直接调用方 |
| --- | --- | --- | --- |
| `license:get-state` | `getState()` | `{ok:true,...LicenseSnapshot}` | [license.js](../../../public/js/license.js)、`settings-auth` |
| `license:activate` | `activate({accountName,password,activationCode})` | `{ok,state,error?,streamer?}`；`ACTIVATION_INPUT_INVALID` / `ACCOUNT_NAME_LENGTH` / `PASSWORD_TOO_LONG` / `ACTIVATION_CODE_INVALID` | `license.js` |
| `license:retry` | `retry()` | `{ok,...LicenseSnapshot}`，`ok` 表示已授权 | `license.js` |
| `license:get-font-library-state` | `getFontLibraryState()` | `{ok:true,...FontLibrarySnapshot}` | `license.js`、`font-library-toast`、`font-library-loader` |
| `license:retry-font-library` | `retryFontLibrary()`，无参数 | `{ok,...FontLibrarySnapshot}`；未授权 `LICENSE_REQUIRED`；重试公共资源清单与未完成下载 | `font-library-toast` |
| `license:get-gift-catalog-state` | `getGiftCatalogState()` | `{ok:true,...CatalogSnapshot}` | `license.js`、[catalog-update-toast.js](../../../public/js/admin/gifts/catalog-update-toast.js) |
| `license:retry-gift-catalog` | `retryGiftCatalog()` | `{ok,...CatalogSnapshot}`，`ok` 表示就绪；未授权 `LICENSE_REQUIRED` | 同上 |
| `license:get-profile` | `getProfile()` | `{ok:true,...LicenseSnapshot}`；同授权生命周期在途读取并发复用（见 [main.md](main.md#21-设备授权生命周期)） | `settings-license`、`server-overlay-url` |
| `license:get-overlay-settings` | `getOverlaySettings()` | `OverlaySettings` | [danmaku-overlay-settings.js](../../../public/js/admin/danmaku-overlay-settings.js)、`server-overlay-url` |
| `license:update-overlay-settings` | `updateOverlaySettings({style,fullscreenDurationSeconds,styleOptions?,layout?,styleParameters?})` | `OverlaySettings`；`INVALID_OVERLAY_STYLE` / `INVALID_OVERLAY_DURATION` / `INVALID_OVERLAY_LAYOUT` / `INVALID_STYLE_PARAMETERS` | `danmaku-overlay-settings` |
| `license:get-overlay-filters` | `getOverlayFilters()` | `{ok:true,blockedUsers:[{uid,name}],blockedKeywords:[]}` | [danmaku-overlay-filters.js](../../../public/js/admin/danmaku-overlay-filters.js) |
| `license:update-overlay-filters` | `updateOverlayFilters(patch)` | 同上；错误见下文过滤设置 | 同上 |
| `license:get-overlay-viewers` | `getOverlayViewers()` | `{ok:true,roomId,viewers:[{uid,name}]}` | 同上 |
| `license:get-welcome-settings` | `getWelcomeSettings()` | `{ok:true,enabled,messages}` | [danmaku-welcome.js](../../../public/js/admin/danmaku-welcome.js)（V1 兼容） |
| `license:update-welcome-settings` | `updateWelcomeSettings(patch)` | 同上；`INVALID_WELCOME_SETTINGS` / `INVALID_WELCOME_MESSAGES` | 同上 |
| `license:get-welcome-settings-v2` | `getWelcomeSettingsV2()` | 完整 V2 配置（`schemaVersion: 2`）；仅明确 HTTP 404 回退 V1（`schemaVersion: 1`） | `danmaku-welcome` |
| `license:update-welcome-settings-v2` | `updateWelcomeSettingsV2(patch)` | 完整 V2 配置，不降级重放；可附 `fieldErrors` | 同上 |
| `license:get-pk-report-settings` | `getPkReportSettings()` | `{ok:true,enabled,reportEnabled,visitorWelcomeEnabled,visitorWelcomeDelaySeconds,visitorWelcomeMessages}`；旧服务器仅返回 `enabled` | [danmaku-pk-report.js](../../../public/js/admin/danmaku-pk-report.js) |
| `license:update-pk-report-settings` | `updatePkReportSettings(patch)`，非空已知字段 patch | 同上；`INVALID_PK_REPORT_SETTINGS` / `INVALID_RESPONSE` | 同上 |
| `license:get-fixed-reply-settings` | `getFixedReplySettings()` | `{ok:true,customExactReplyEnabled,customExactReplies,scheduledDanmakuEnabled,scheduledDanmaku}`，可附点赞/分享/关注感谢六字段；`FIXED_REPLY_UNSUPPORTED` / `INVALID_RESPONSE` | 弹幕互动固定回复 |
| `license:update-fixed-reply-settings` | `updateFixedReplySettings(patch)`，精确/定时回复与互动感谢字段（至少一项） | 同上；`INVALID_FIXED_REPLY_SETTINGS` / `FIXED_REPLY_UNSUPPORTED` / `INVALID_RESPONSE` | 同上 |
| `license:get-viewer-name-settings` / `license:update-viewer-name-settings` | `getViewerNameSettings()` / `updateViewerNameSettings({enabled?,blockedWords?})`，至少一项 | `{ok:true,enabled,blockedWords}`；`INVALID_VIEWER_NAME_SETTINGS`；旧服务器缺词库字段时禁用编辑器 | 昵称管理 |
| `license:list-viewer-names` | `listViewerNames({page})`，正整数 `1–999999999` | `{ok:true,items:[{uid,name}],page,pageSize:20,total}`；页码由服务器校正 | [danmaku-viewer-names.js](../../../public/js/admin/danmaku-viewer-names.js) |
| `license:update-viewer-name` / `license:delete-viewer-name` | `updateViewerName({uid,name})` / `deleteViewerName(uid)` | 更新返回 `{ok:true,uid,name}`，删除 `{ok:true}`；`INVALID_VIEWER_NAME_REQUEST` / `VIEWER_NAME_BLOCKED` / `VIEWER_NAME_NOT_FOUND` / `VIEWER_NAMES_UNSUPPORTED` | 同上 |
| `license:sync-songs` | `syncSongs(songs)`，数组 ≤ 5000；归一化后 `{songs}` UTF-8 ≤ 5 MiB | `{ok,count?,index?,songPageUrl?}`；`SONG_LIST_INVALID` / `PAYLOAD_TOO_LARGE` / `SONG_*_TOO_LONG`（含零基 `index`） | 兼容入口 |
| `license:get-local-song-count` | `getLocalSongCount()` | `{ok:true,count,generation}`；本机完整歌库数量及确认代次 | [cloud-song-sync.js](../../../public/js/admin/cloud-song-sync.js) |
| `license:sync-current-songs` | `syncCurrentSongs(generation)`，非负安全整数；共用 5 MiB UTF-8 上限 | `{ok,count,index?,songPageUrl?}`；`CLOUD_SONGS_CHANGED` / `CLOUD_SYNC_NOT_READY` / `PAYLOAD_TOO_LARGE` / `SONG_*_TOO_LONG`（含零基 `index`） | 同上 |
| `license:get-cloud-songs` | `getCloudSongs()` | `{songs:[SongPublic]}`（无统一 `ok` 外层） | 同上 |
| `license:get-cloud-song-count` | `getCloudSongCount()` | `{ok:true,count}`；优先读 `cloud-state.songs.count`，旧服务器缺字段时回退完整歌库；非法报 `INVALID_RESPONSE` | `cloud-song-sync` |
| `license:get-song-page-access` / `license:set-song-page-access` | `getSongPageAccess()` / `setSongPageAccess(enabled)`（仅布尔值） | `{ok:true,enabled:boolean}`；`INVALID_SONG_PAGE_ACCESS` / `INVALID_RESPONSE` | 同上 |
| `license:get-song-page-background` | `getSongPageBackground()` | `BackgroundResponse` | [song-background.js](../../../public/js/admin/song-background.js) |
| `license:upload-song-page-background` | `uploadSongPageBackground(bytes,fileName)` → `{bytes,fileName}`，非空 `Uint8Array` ≤ 5 MiB | `BackgroundResponse`；`BACKGROUND_IMAGE_REQUIRED` / `PAYLOAD_TOO_LARGE` | 同上 |
| `license:delete-song-page-background` | `deleteSongPageBackground()` | `BackgroundResponse`（`background` 可为 `null`） | 同上 |
| `license:get-gift-interaction-state` | `getGiftInteractionState()` | `GiftInteractionSnapshot` | [interaction-controls.js](../../../public/js/admin/gifts/interaction-controls.js) |
| `license:set-gift-interaction` | `setGiftInteraction(key,enabled)` → `{key,enabled}`，拒绝额外字段 | `GiftInteractionSnapshot`；`INVALID_GIFT_INTERACTION` / `GIFT_INTERACTION_PENDING` / `CLOUD_SYNC_FAILED` | 同上 |
| `license:set-gift-thanks-templates` | `setGiftThanksTemplates({gift,guard})` | `GiftInteractionSnapshot`；`INVALID_GIFT_THANKS_TEMPLATES` / `GIFT_THANKS_UNSUPPORTED` / `GIFT_INTERACTION_PENDING` / `CLOUD_SYNC_FAILED` | [danmaku-gift-thanks.js](../../../public/js/admin/danmaku-gift-thanks.js) |
| `license:set-gift-thanks-replies` | `setGiftThanksReplies({gift,captain,admiral,governor})` | `GiftInteractionSnapshot`；`INVALID_GIFT_THANKS_REPLIES` / `GIFT_THANKS_UNSUPPORTED` / `GIFT_INTERACTION_PENDING` / `CLOUD_SYNC_FAILED` | 同上 |

**共享 DTO 与校验约束**：

- **`LicenseSnapshot`**：`{state,error,streamer?,device?}`；`state` 为 `checking` / `needs_activation` / `needs_connection` / `authorizing` / `authorized` / `blocked`，`error` 为受限代码或 `null`。`streamer` 仅含 `accountName`(32)、`displayName`(80)、`subdomain`(63)、`songPageUrl?`、`manageUrl?`；`device` 仅含 `id`(128)、`name`(100)、`status`(32)、`licenseId`(128)（括号内为字符串截断上限）。`activate` 三字段均要求非空（上限 64 / 256 / 256），不接受渲染进程指定服务器地址。
- **`FontLibrarySnapshot`**：`{status,total,completed,failed,currentFont,totalBytes,downloadedBytes,completedAt}`；覆盖共享字体包与公共大图，`status` 为 `idle` / `checking` / `downloading` / `ready` / `error`，计数与字节数非负且 `completed ≤ total`、`failed ≤ completed`、`downloadedBytes ≤ totalBytes`，`currentFont` 最长 100 字符。不透传原始异常、下载地址或磁盘路径。
- **`CatalogSnapshot`**：`{status,background,phase,completed,total,available,failed,percent,currentGiftId,currentGiftName,completedAt,error,warning}`；`status` 为 `required` / `running` / `updating` / `ready` / `error`，`phase` 为 `idle` / `catalog` / `images` / `complete` / `error`，礼物 ID/名称上限 32/100，`background` 严格布尔值，`completedAt` 为 ISO 时间或 `null`。
- **`OverlaySettings`**：`{ok:true,style,fullscreenDurationSeconds,styleOptions?,layout?,styleParameters?,overlayUrl}`。`style` 与 `styleOptions` 由 [danmaku-style-options.js](../../../src/shared/danmaku-style-options.js) 校验，时长为 `2–30` 整数，`layout` 与 `styleParameters` 分由 [danmaku-layout.js](../../../src/shared/danmaku-layout.js) 和 [component-style-parameters.js](../../../src/shared/component-style-parameters.js) 校验，省略的可选字段不由 IPC 补写。`overlayUrl` 由 IPC 与场景云控制器共用 [remote-url-policy.js](../../../src/shared/remote-url-policy.js) 的 `normalizeRemoteOverlayUrl` 校验，为无凭据/查询参数/片段、DNS 主机名的 HTTPS `/overlay/<16位base64url>`，是只读叠加层访问凭证，不能代替 Device 令牌。
- **过滤设置**：校验归属 [overlay-filters-contract.js](../../../src/shared/overlay-filters-contract.js)。非空 patch 仅含 `blockedUsers` / `blockedKeywords`（最多 500 人 / 200 词，UID 为 1–20 位非零开头数字，`name ≤ 80`，词 `≤ 100`）；在线榜候选 `≤ 200`（请求 `/api/device/overlay-viewers?limit=200`）。404/405 映射 `OVERLAY_FILTERS_UNSUPPORTED`。
- **欢迎配置（V1 / V2 及全部扩展）**：校验与 `fieldErrors` 白名单归属 [welcome-settings-contract.js](../../../src/shared/welcome-settings-contract.js)，并发草稿与业务调度见 [main.md](main.md#服务器进场欢迎设置)。
  - **V1**：非空 patch 仅含 `enabled`（布尔）与 `messages`（1–30 条，每条非空、无控制字符、`≤ 80` Unicode 码位并 trim）。
  - **V2 基础字段**：`enabled`、`greetingEnabled`、`attentionEnabled`、`rareNamePinyinEnabled` 为布尔；`welcomeDelaySeconds`（`0–300`）、`greetingDelaySeconds`（`1–600`）、`welcomeMinHonorLevel` / `greetingMinHonorLevel`（`0–999`）、`attentionMinHonorLevel`（`1–999`）为整数；`messages` / `greetingMessages` / `attentionWelcomeMessages` / `attentionGreetingMessages` 沿用词库校验。关闭主欢迎时不能开启二次问候或重点关注；二次问候延时必须大于首次欢迎延时。
  - **V2 增量扩展**：均走同一 V2 通道，旧 V2 缺失对应扩展字段时仅禁用该项控件，半缺失或类型错误直接拒绝：
    - 多天未到欢迎：`returningEnabled`（布尔）与 `returningMessages`（沿用词库校验，成对返回；主欢迎关闭时不可启用）。
    - 时段欢迎：`timeWelcomeEnabled`（布尔）与 `timeWelcomeMessages`（5 个北京时间固定时段键，每段沿用词库校验；请求可提交非空时段子集由服务端合并，响应须含完整 5 段）。
    - 个人欢迎词：`userWelcomeMessages`（0–100 条 `{uid,message}`，UID 为 1–20 位非零开头十进制字符串且唯一；空数组清空，省略保留；非法返回 `INVALID_WELCOME_MESSAGES` 与白名单 `fieldErrors`，不回显条目内容）。
    - 粉丝牌与开播连接提示：`welcomeOwnMedalOnly`（可选布尔，默认 `false`）、`liveGreetingEnabled`（可选布尔，默认 `true`，独立提交且响应须回显才确认）。
    - 欢迎黑白名单：`welcomeWhitelist` / `welcomeBlacklist`（精确 UID 字符串数组，拒绝数字 UID、重复或非法值，错误投影 `INVALID_USERS`；各自独立保存）。
- **固定回复与 PK 播报**：
  - 固定回复处理器由 [license-fixed-reply-ipc.js](../../../src/electron/ipc/license-fixed-reply-ipc.js) 注册，校验归属 [fixed-reply-contract.js](../../../src/shared/fixed-reply-contract.js)：`customExactReplyEnabled` / `scheduledDanmakuEnabled` 为布尔；`customExactReplies` 最多 30 条 `{trigger,reply}`（1–30 / 1–120 字符，触发词唯一且禁占「菜单」）；`scheduledDanmaku` 含 `mode`（`fixed`/`random`）、`intervalSeconds`/`minSeconds`/`maxSeconds`（10–86400 整数且 `min ≤ max`）、`selection`（`sequential`/`random`）、`messages`（最多 300 条、1–120 字）；点赞/分享/关注感谢为 6 个成组字段（3 布尔 + 3 词库，各 0–30 条、1–120 字，全缺保留旧四字段响应，半缺拒绝）。云端 `revision` 仅在主进程用于刷新内存去重投影，不透传给渲染进程（主进程去重与调度见 [main.md](main.md#服务器固定回复设置)）。
  - PK 播报校验归属 [pk-report-settings-contract.js](../../../src/shared/pk-report-settings-contract.js)：`enabled` / `reportEnabled` / `visitorWelcomeEnabled` 为布尔，`visitorWelcomeDelaySeconds` 为 0–300 整数，`visitorWelcomeMessages` 为 1–30 条、1–80 字符（无控制字符）。旧服务器仅返回 `{ok:true,enabled}` 时禁用新增控件，半缺失拒绝。
- **昵称管理**：由 [license-viewer-name-ipc.js](../../../src/electron/ipc/license-viewer-name-ipc.js) 注册，[viewer-names-contract.js](../../../src/shared/viewer-names-contract.js) 严格校验允许的参数字段并仅返回白名单公开字段：UID 为正十进制字符串，昵称为单行 1–10 个 Unicode 字素簇，黑名单最多 200 个非空单行词（每词 `≤ 40` UTF-16 码元）。旧服务器 404/405 提示升级，缺失 UID 的 404 保留 `VIEWER_NAME_NOT_FOUND`。
- **`SongPublic`**：只复制 [license-songs-ipc.js](../../../src/electron/ipc/license-songs-ipc.js) 的 `SONG_PUBLIC_FIELDS`（基础标量字段，字符串截断 4096，不透传嵌套对象或数组）。单曲文本上限（UTF-16 码元）：歌名/歌手 200、曲风 120、标签 500、语言/核对平台 80、备注/价格/歌切 1000。
- **`BackgroundResponse`**：`{ok,background: null 或 {url?,previewUrl?,bytes?,updatedAt?}}`，`previewUrl` 由主进程基于可信服务源解析，不含凭据查询参数。
- **`GiftInteractionSnapshot`**：`{ok,values:{giftAutoThanksEnabled,giftStatsQueryEnabled},templates,replies,status,error}`，`status` 为 `confirmed` / `pending` / `unconfirmed`。`templates` 为旧 `{gift,guard}`，`replies` 为 `{gift,captain,admiral,governor}`（各为 `{enabled,mode:'plain'|'mention',messages}`，1–20 条单行纯文本 `≤ 120` 字，`{称呼}` / `{礼物}` / `{金额}` 可省略且各至多一次；校验归属 [gift-thanks-templates.js](../../../public/js/shared/gift-thanks-templates.js)）。注册归属 [gift-interaction-ipc.js](../../../src/electron/ipc/gift-interaction-ipc.js)，状态与同步队列由 [gift-interaction-controller.js](../../../src/electron/gift-interaction-controller.js) 维护（见 [规格](../../../specs/gift-interaction-controls.md)）。

### 2.5 dailyBots、fanProfiles 与 giftExport

`dailyBots.invoke` 的 `update` 载荷保留 `kind` / `enabled` / `expectedRevision`，仅 `kind='fortune'` 可附带 `drawMode: 'daily' | 'random'`（省略保留云端模式；读取结果缺省代表旧服务器不支持，详见 [云端抽签](../backend/bilibili/danmaku.md#62-云端抽签与默认词库)）。

| 通道 | 桥方法与输入 | 返回 | 处理器 / 直接调用方 |
| --- | --- | --- | --- |
| `daily-bots:invoke` | `dailyBots.invoke({action,contextId?,payload?})` | `{ok:true,contextId,accountName,...actionResult}`；失败 `{ok:false,error}` | [daily-bot-ipc.js](../../../src/electron/ipc/daily-bot-ipc.js) / [danmaku-daily-bots.js](../../../public/js/admin/danmaku-daily-bots.js) |
| `planner-reminders:get-state` | `plannerReminders.getState()` | `{ok:true,supported:boolean}` | [planner-reminder-ipc.js](../../../src/electron/ipc/planner-reminder-ipc.js) / [streamer-planner.js](../../../public/js/admin/streamer-planner.js) |
| `planner-reminders:sync` | `plannerReminders.sync({capturedAt,agenda})`，兼容旧提醒数组 | 同上；失败 `{ok:false,error}` | [工作台同步器](../../../public/js/admin/streamer-planner-reminders.js) / [主进程调度](../../../src/electron/planner-reminder-controller.js) |
| `desktop-notifications:get-state` | `desktopNotifications.getState()`，无参数 | `{ok:true,supported:boolean,settings:DesktopNotificationSettings}` | [desktop-notifications-ipc.js](../../../src/electron/ipc/desktop-notifications-ipc.js) / [desktop-notification-settings.js](../../../public/js/admin/desktop-notification-settings.js) |
| `desktop-notifications:update` | `desktopNotifications.update(patch)`，单参数 | 同上；失败 `{ok:false,error}` | 同上；持久化与通知归属 [desktop-notifications.js](../../../src/electron/desktop-notifications.js) |
| `fan-profiles:invoke` | `fanProfiles.invoke({action,contextId?,payload?})` | `{ok:true,contextId,data,syncStatus,roomId,accountName}`；失败见 §5 | [fan-profile-ipc.js](../../../src/electron/ipc/fan-profile-ipc.js) / [fans/index.js](../../../public/js/admin/fans/index.js)、[automatic-update.js](../../../public/js/admin/fans/automatic-update.js) |
| `gift-export:settings` | `giftExport.settings(options?)` | `{ok:true,data:{mode,background,sortBy,rowGap,mergeAcrossDates,directory,custom}}` | [gift-export-ipc.js](../../../src/electron/ipc/gift-export-ipc.js) / [export-preview.js](../../../public/js/admin/gifts/export-preview.js) |
| `gift-export:prepare` | `giftExport.prepare(selection)` | `{ok:true,data:ExportTask}` | 同上 |
| `gift-export:configure` | `giftExport.configure({id,mode,background,sortBy?,rowGap?,mergeAcrossDates?,styleSource?,customStyle?,directoryAction?,remember?})` | `{ok:true,data:ExportTask}` | 同上 |
| `gift-export:save` | `giftExport.save(id, roomGuard?)` → `{id,roomGuard?}` | **直接**返回 `{ok:true,saved,directory}` 或 `{ok:false,cancelled,saved,directory,error}`；启动前异常可仅 `{ok:false,error}` | 同上 |
| `gift-export:cancel` | `giftExport.cancel(id?)`，原始 `id` | `{ok:true,data:undefined}`；不匹配的非空 `id` 不取消当前任务 | 同上 |
| `gift-export:open-folder` | `giftExport.openFolder(id)` → `{id}` | `{ok:true,data:{ok:true}}`，要求该任务已保存 `≥ 1` 张 | 同上 |
| `weekly-schedule:export-png` | `weeklySchedule.exportPng(template)`，完整周表模板对象 | `{ok:true,saved:true,filePath}`、取消 `{ok:true,cancelled:true}` 或 `{ok:false,error}`；参数个数错误返回 `IPC_ARGUMENTS_INVALID` | [weekly-schedule-ipc.js](../../../src/electron/ipc/weekly-schedule-ipc.js) / [weekly-schedule/editor.js](../../../public/js/admin/weekly-schedule/editor.js) |

**补充载荷与校验约束**：

- **周表 PNG 导出**：沿用主窗口来源校验（见 §1）。渲染进程只提交模板数据，不能指定输出路径、页面 URL、HTML 或脚本。主进程校验固定 10 套版式、7 天、4 个模块与前三名字段上限，以及 PNG/JPEG/WebP data URL（单图 ≤ 12 MiB、合计 ≤ 48 MiB、最大边 ≤ 8192 px、总像素 ≤ 32M 即 3200 万像素）；传入原始 SVG、远程 URL 或超限数据直接拒绝。保存路径仅来自原生 PNG 对话框，无额外推送事件；窗口生命周期和落盘规则见 [周表导出生命周期](main.md#周表-png-导出)。
- **礼物导出**：除 `save` 外失败统一返回 `{ok:false,error}`（仅展示显式 `publicMessage` 业务提示，否则回退「礼物导出失败，请重新打开预览。」；来源非法返回 `IPC_SOURCE_INVALID`）。详细任务与取消时序见 §6。
- **日程提醒（`plannerReminders`）** 只接受主窗口同源 `/admin` 主框架。工作台成功保存后用一条 `sync` 原子替换排程。`capturedAt` 是采样时刻，`agenda` 是按换行分隔的 JSON 对象，空字符串清空排程。
  - 每行包含唯一非空 `id`（≤ 128 个 UTF-16 码元）、日历上的 `localAt`（`YYYY-MM-DDTHH:mm`）和采样时区的 `remindAt`。两个时间戳都是有效日期范围内的安全整数毫秒值。将 `localAt` 按 UTC 解释，与 `remindAt` 的差值最多一天，以容纳时区偏移。待提醒项带非空 `title`（≤ 80）和 `detail`（≤ 500）。当该本地分钟按 UTC 解释后距采样时刻已至少一天，工作台可以省略这两个字段。主进程为仍待补送的相同日程沿用已有正文。
  - `agenda` 上限为 50 × 1024² 个 UTF-16 码元，逐行解析，每行最多 4376 个码元，包含正文的最大 JSON 转义开销。投影比工作台已保存的 v3 JSON 更小。当前 [Electron 43.8.3 的 DOM 存储配额](https://github.com/electron/electron/blob/v43.8.3/patches/chromium/dom_storage_limits.patch) 为每个 origin 100 MiB，由键和值共享。
  - 主进程分别按采样时刻和接收时区统计仍需投递的未来提醒。任一集合超过 1000 条即返回 `PLANNER_REMINDERS_LIMIT`，保留上次有效排程。定时器与唤醒检查按当前时区的日历时间投递。应用启动跳过历史，管理页重载保留仍在日历上的待补送项。相同 ID 与本地分钟在本次运行内只投递一次，删除或改期在下次检查前生效。
  - 旧数组仍按接收时刻处理，最多 1000 项，每项仅含 `{id,title,detail,remindAt}`，沿用固定毫秒截止时间。旧数组过长、载荷非法或额外字段均返回 `PLANNER_REMINDERS_INVALID`。参数个数错误返回 `IPC_ARGUMENTS_INVALID`，控制器已停止返回 `PLANNER_REMINDERS_STOPPED`。
- **系统通知设置（`desktopNotifications`）**：`DesktopNotificationSettings` 仅含 `plannerRemindersEnabled`（布尔，默认 `true`）、`largeGiftEnabled`（布尔，默认 `false`）、`largeGiftThresholdRmb`（数值，默认 `1000`，非负、最多两位小数且换算整数分为安全整数，采用严格大于比较）。`update` 接受至少一项的部分修改，拒绝额外字段、空对象及非法金额（`DESKTOP_NOTIFICATIONS_INVALID` / `DESKTOP_NOTIFICATIONS_SAVE_FAILED` / `DESKTOP_NOTIFICATIONS_STOPPED` / `IPC_ARGUMENTS_INVALID`）。`ok:true` 表示设置已保存；礼物来源不可用或启用边界尚未确认时，保留启用设置并等待可信来源恢复，该阶段不补发通知。执行与关停行为见 [本机系统通知](main.md#本机系统通知)。

### 内置播放输出

归属模块：[playback-output-ipc.js](../../../src/electron/ipc/playback-output-ipc.js)（沿用主窗口来源校验，见 §1）。`playbackOutput.invoke({ op, value? })` → `playback-output:invoke`，返回 `{ ok, error?, data?, stale? }`；`onFault(callback)` 订阅 `playback-output:fault` 的 `{ stream, error }` 并返回取消订阅函数。

| `op` | `value` 与行为 |
| --- | --- |
| `list` | 无参数；返回输出数组 `{ deviceId, name, backend, endpointId }`（音频组件未就绪时返回 `{ok:true,data:[],preparing:true}`，不阻塞默认浏览器播放） |
| `open` | 仅 `deviceId`（最长 2048 字符，不含 NUL/换行，允许 `wasapi` / `directsound` / `waveout` / `asio` 前缀，原生层复核真实设备）；返回主进程生成的 `stream`、`backend`、`endpointId` |
| `write` | 仅正安全整数 `stream` 和 `8–16384` 字节、8 字节对齐的 `ArrayBuffer` PCM；过期 `stream` 丢弃；原生层校验有限采样并钳位，返回 `bufferedFrames` |
| `stop` | 无参数；取消当前流并释放设备 |

禁止提交 PID、文件、URL、程序或命令行。每层最多排队 4 条（原生调用 5 秒超时，启动 15 秒超时），流标识与包序号由主进程生成；主进程工作程序生命周期见 [main.md](main.md#内置播放原生输出)。

### 电音助手

组件准备与电音助手会话均沿用主窗口来源校验（见 §1）：

- **组件准备**：`audioAssistant.getComponentState()` → `audio-component:get-state`、`retryComponent()` → `audio-component:retry`（均无参数），`onComponentState(callback)` 订阅 `audio-component:state` 并返回取消订阅函数。快照为 `{status,totalBytes,downloadedBytes,revision,error?}`（`status` 为 `idle` / `checking` / `downloading` / `installing` / `ready` / `error`），错误文案脱敏，不得从渲染进程指定组件或 URL。
- **电音助手会话（[audio-assistant-ipc.js](../../../src/electron/ipc/audio-assistant-ipc.js)）**：`audioAssistant.invoke({ op, value? })` → `audio-assistant:invoke`，返回 `{ ok, error?, state? }`；`audioAssistant.onState(callback)` 订阅 `audio-assistant:state` 并返回取消订阅函数。

| `op` | `value` 与行为 |
| --- | --- |
| `get` | 无参数；惰性启动并获取统一会话快照 |
| `configure` | 仅允许 [本机参数](../backend/storage.md#电音助手本机数据) 的 `strength` / `semitones` / `speedPercent` / `volume` / `outputId` / `cableId` / `inputId` / `loopbackId` / `inputChannels` / `inputMusic`，以及 `original: boolean`、`source: auto\|file\|pid:正整数\|input\|loopback`；数值为范围内整数，设备 ID `≤ 1024` 字符且禁 NUL，声道索引 `0–127`，未知键拒绝（`deviceSource` 由原生会话派生，不可直接提交） |
| `file` | 仅限已通过 `musicAPI.selectLocalFiles` 授权的音频路径（复用 `local-media` 允许列表） |
| `start` / `stop` | 无参数；启停所选歌曲或设备声音，停止可取消进行中的启动 |
| `refresh` / `recover` | 无参数；空闲时刷新来源与设备 / 恢复遗留原声路由 |
| `mixer` | 无参数；仅打开固定的 Windows 音量混合器设置 URI |

快照包含 `ready`、`running`、`starting`、`source`、`sourceProcessId`、`internalSource`、`settings`、`original`、`status`、`song`、`sourceDevice`、`fileName`、`apps`、`outputs`、`outputChoices`、`inputs`、`inputDevice`、`inputError`、`inputLevel`、`level`、`position`、`duration`、`pendingRecovery`、`recoveryDeferred`、`revision`（渲染进程按 `revision` 接收更新）。`internalSource` 由主进程依据本实例 PID 与 `app.getAppMetrics()` 判定；`pendingRecovery` 表示仍有恢复工作，`recoveryDeferred=true` 表示剩余记录由存活守护负责、通道静音已归还且无错误，界面不显示恢复警告（主进程生命周期见 [main.md](main.md#电音助手生命周期)）。

主进程启动原生组件时用 `LIRA_AUDIO_METER_FRAMES=1` 协商周期电平帧。支持此约定的组件在名单稳定时发送 `levels`，首次状态和名单变更仍发送完整 `state`。桌面桥以当前子进程的完整帧为起点合并电平，也能直接消费旧组件连续发来的完整帧。主进程在 `audio-assistant:state` 上推送完整快照或带 `baseRevision` 的变更。每个页面首次订阅（包括重载后）或检测到版本断档时，preload 通过沿用主窗口来源校验的无参数 `audio-assistant:sync` 请求缓存，主进程在同一状态通道上发回完整快照，无需启动组件。页面内的迟订阅者直接收到已有快照。每次 `onState` 回调及 `invoke` 返回的 `state` 均为完整状态。

### 大航海到期同步桥

`window.guardExpiryAuth` 由 [guard-expiry-ipc.js](../../../src/electron/ipc/guard-expiry-ipc.js) 注册（沿用主窗口来源校验，见 §1），退出时幂等移除。

| 方法 | IPC 通道 | 参数 |
| --- | --- | --- |
| `getState` | `guard-expiry:get-state` | 无 |
| `setSource` | `guard-expiry:set-source` | `'shared'` 或 `'separate'` |
| `login` | `guard-expiry:login` | 无；打开隔离的房主登录窗 |
| `logout` | `guard-expiry:logout` | 无；只清除独立云端登录 |

成功返回 `{ok:true,account:{source,loggedIn,uid,displayName,revision}}`（未登录时 `uid` 为 `null`）；取消返回 `{ok:true,cancelled:true}`；失败返回 `{ok:false,error}`（仅透传白名单错误码，如 `GUARD_EXPIRY_OWNER_MISMATCH`、`GUARD_EXPIRY_ROOM_REQUIRED`、`GUARD_EXPIRY_SOURCE_CHANGED`、`GUARD_EXPIRY_UNSUPPORTED`，不返回原始异常或 Cookie）。认证生命周期见 [auth.md](auth.md#16-可选的大航海到期账号)。

## 3. 消息、订阅与播放持久化

当前 preload 不提供渲染进程 → 主进程的单向 `ipcRenderer.send`（退出确认同样走 `invoke`）。下表为主进程向渲染进程推送的事件，均由 preload 的私有 `subscribe` 封装为固定通道的 `on*` 订阅方法，不向渲染进程开放通道参数。回调前会先剥离 Electron `event` 参数，只传入数据载荷；无载荷事件不传参数。传入无效回调时返回空函数，否则返回取消订阅函数（仅移除本次注册的监听）。页面或工具箱卸载时必须调用取消函数，避免重复进入时叠加订阅。

| 通道 | 桥订阅方法 | 载荷 | 发送模块 / 直接调用方 |
| --- | --- | --- | --- |
| `gift-export:progress` | `giftExport.onProgress(callback)` | `{id,saved,total}`（该任务已保存进度） | `gift-export-ipc` / `export-preview`（按当前 `id` 过滤） |
| `desktop:resource-integrity-state` | `songAssistantDesktop.onResourceIntegrityState(callback)` | 资源检查快照 | [desktop-resource-integrity.js](../../../src/electron/desktop-resource-integrity.js) / [资源检查 UI](../../../public/js/desktop-resource-integrity.js)（按单调 `revision` 忽略旧值） |
| `desktop:show-update-page` | `songAssistantDesktop.onShowUpdatePage(callback)` | 无 | 预留监听，当前主进程无发送方 / `desktop.js` |
| `desktop:update-state` | `songAssistantDesktop.onUpdateState(callback)` | 更新状态（见 [update.md](update.md)） | [desktop-update-controller.js](../../../src/electron/desktop-update-controller.js) 的 `sendUpdateState` / `desktop.js` |
| `desktop:window-maximized` | `songAssistantDesktop.onWindowMaximized(callback)` | `boolean` | [desktop-main-window.js](../../../src/electron/desktop-main-window.js) / 桌面窗口控件 |
| `bilibili:identity-changed` | `bilibiliAuth.onIdentityChanged(callback)` | 无 | 云端同步改变本机 B 站身份后，设置页重新读取本机登录态及资料 |
| `app:prepare-shutdown` | `musicAPI.onPrepareShutdown(callback)` | 无 | [playback-flush.js](../../../src/electron/playback-flush.js) / 播放器初始化模块 |
| `license:gift-interaction-state-changed` | `liraLicense.onGiftInteractionStateChanged(callback)` | `GiftInteractionSnapshot` | `gift-interaction-ipc` / `interaction-controls` |
| `license:state-changed` | `liraLicense.onStateChanged(callback)` | `LicenseSnapshot` | `license-ipc` / `license.js`、Admin 账户与各云端面板 |
| `license:font-library-state-changed` | `liraLicense.onFontLibraryStateChanged(callback)` | `FontLibrarySnapshot` | `font-library-ipc` / `license.js`、`font-library-toast`、`font-library-loader` |
| `license:gift-catalog-state-changed` | `liraLicense.onGiftCatalogStateChanged(callback)` | `CatalogSnapshot` | `license-ipc` / `license.js`、`catalog-update-toast` |

授权与目录事件仅发送到当前存活主窗口，不广播给辅助窗口；礼物互动发送另校验精确本地源，资源检查发送另校验管理页路径。主进程的来源校验与远端代次检查，不能替代渲染进程自身的任务 ID 与草稿版本校验。

- **播放保存与退出冲刷**。播放器在读取队列快照前注册 `app:prepare-shutdown` 监听器，因此初始读取期间也能响应退出并保存周表。收到事件时，监听器并行发起播放状态保存和周表保存。播放快照由 `createStatePersistence` 经 `musicAPI.savePlaybackState`、`music-ipc` 与 `desktopRuntime.persistPlaybackSnapshot` 交给 `playback-store` 写入 `play_queue_state`。若 IPC 与 HTTP 保存均失败，则保留待存快照。周表编辑器等待本机 IndexedDB 事务提交。两项均成功或无待存内容时，该监听器调用一次 `musicAPI.confirmShutdownFlush()`。任一项失败时记录告警，主进程最多等待确认 2 秒后继续关闭。见[关闭时序](main.md#7-关闭序列与播放状态冲刷)。
- **无 IPC 的主进程内部同步**：礼物日汇总、近期明细同步以及礼物 SSE / 增量拉取均仅在主进程内执行，不新增渲染进程 IPC，也不暴露 Device 令牌、UID 或服务端内部房间；前端统一通过本地 HTTP 与 WebSocket 快照/历史/`gift:frame` 读取投影结果（接口见 [API](../backend/api.md)）。

## 4. 每日机器人 action

归属模块：[daily-bot-controller.js](../../../src/electron/daily-bot-controller.js)、[daily-bot-contract.js](../../../src/shared/daily-bot-contract.js)。请求对象仅允许 `action` / `contextId` / `payload`（除 `open` 外须带当前 `contextId`，`payload` 缺省 `{}`，各 action 拒绝未知字段）；`revision` 为非负安全整数。

| `action` | `payload` | `actionResult` |
| --- | --- | --- |
| `open` | `{}` | `{data:DailyBotSettings}` |
| `summary` | `{}` | `{summary}`（本地旧记录数量、词库状态、`sourceLabel`） |
| `update` | `{kind:'checkin'\|'fortune',enabled:boolean,expectedRevision,drawMode?}` | `{data:DailyBotSettings}` |
| `library-read` | `{kind:'checkin'\|'fortune'}` | `{library:{kind,version,library}}`；主进程缓存当前授权上下文结果，远端按内容版本条件读取 |
| `library-save` | `{kind,expectedVersion,library}` | 同上；提交单份完整词库并校验响应摘要，不改变开关 |
| `decide` | `{decision:'no-legacy'\|'fresh-start',expectedRevision,legacyStoppedConfirmed:true}` | `{data:DailyBotSettings}`；`no-legacy` 遇现存数据或自定义词库失败 |
| `prepare` | `{legacyStoppedConfirmed:true,ownershipConfirmed:true,libraryChoice:{checkin,fortune},blessings?,fortunes?}`（`choice` 为 `legacy`/`builtin`/`corrected`） | `{draftId,summary,blessings,fortunes,cutoffAt,digest,resumed}` |
| `apply` | `{draftId}` | 成功 `{data,imported:true}`；预检未通过 `{data,preflight:{valid:false,issues}}` |
| `cancel` | `{id,expectedRevision}`（`id` 为服务端 import ID） | `{data:DailyBotSettings}` |

`DailyBotSettings` 为 `{executionOwner:'server',observedAt,takeover,checkin,fortune}`：`takeover` 含 `state`（`pending`/`importing`/`ready`）、`decision`、`revision`、`legacyStoppedAt`、`importId`、`sourceDigest`；`checkin` / `fortune` 各含 `enabled`、`revision`、`reason`（白名单：`pending` / `importing` / `disabled` / `running` / `streamer-disabled` / `monitor-disabled` / `room-not-set` / `waiting-login` / `monitor-disconnected`）；`observedAt` 为规范 ISO 时间。

`prepare` 冻结本机来源摘要与 SHA-256 `digest`（规范化 UTF-8 上限 16 MiB）；`apply` 每批 `≤ 250` 条，复用同一 import ID，来源变化报 `DAILY_BOT_SOURCE_CHANGED` / `DAILY_BOT_COMMITTED_SOURCE_CHANGED`；`preflight` 最多 100 条 `issues`（白名单由 `safePreflight` 维护）。

上下文由主进程依据 `[server origin, streamerId, authorizationGeneration]` 生成 UUID，续期保留与失效边界遵循 [auth.md](auth.md) §15。并发请求返回 `DAILY_BOT_BUSY`；`dispose` 清空状态并解除订阅（无单独 `whenIdle`）。公开错误允许 `DAILY_BOT_*` 与 `LICENSE_NOT_AUTHORIZED`（非该前缀的 404 映射 `DAILY_BOT_UNSUPPORTED`，其余收敛为 `DAILY_BOT_UNAVAILABLE`）。

当前界面调用 `open` / `update` / `library-read` / `library-save`（其余 action 为旧数据接管兼容）。词库 `version` 为规范 JSON 的 SHA-256；主进程校验字段形状（每字段 1–1024 UTF-16 码元）与响应摘要，条件读取的紧凑回执核对已确认缓存，保存的紧凑回执核对本次提交副本，含完整词库的回执按返回内容计算摘要。主进程校验成功后还原完整 DTO。`DAILY_BOT_LIBRARY_CONFLICT` 保留草稿，`DAILY_BOT_LIBRARY_INVALID` 提示修改，404 仅提示更新服务器且原开关可用。

## 5. 粉丝档案 action 与 DTO

归属模块：[fan-profile-controller.js](../../../src/electron/fan-profile-controller.js)、[profile-service.js](../../../src/fans/profile-service.js)、[profile-transfer.js](../../../src/fans/profile-transfer.js)。作用域由已认证的 `[normalized server origin, streamerId]` 决定，`roomId` 仅为名单来源。`open` / `calendar` / `auto-update-status` 可不带 `contextId`，其余须匹配当前上下文；授权代次续期与失效边界见 [auth.md](auth.md) §15（名单操作额外核对 `roomId`）。`dispose` 清理定时器、请求与订阅，`whenIdle` 等待同步、名单与自动任务完成，先于数据库关闭。

成功外层结构见 §2.5（`syncStatus` 为 `offline` / `pending` / `syncing` / `ready` / `unsupported`），下表仅列 `data`。失败返回 `{ok:false,error,existingId?}`（仅展示显式 `publicMessage` 业务提示，否则回退「档案操作失败，输入尚未保存，请重试。」；身份冲突可附 `existingId`，非法来源为 `IPC_SOURCE_INVALID`），该通道不采用统一枚举错误码。请求参数 `payload` 必须是普通对象（非数组），序列化为 UTF-8 JSON 后不超过 16 MiB；`preview-restore` / `restore` 额外允许 1 KiB 的摘要与冲突选项外层结构，备份本体仍不超过 16 MiB。手工完整备份文件最多 10000 份档案，导出前按两空格缩进 JSON 的实际 UTF-8 字节数预检容量与数量，超限直接报错且不生成下载文件。本机恢复点通过 `snapshotId` 在主进程读取，仍校验格式、归属、身份与记录，但不受上述文件数量或字节限制。

| `action` | `payload` | `data` |
| --- | --- | --- |
| `open` / `list` | `{query?,archived?,filters?}`（`query ≤ 300`，`filters` 可含 `favorite`/`incomplete`/`active`/`past`/`unknown`） | `{profiles,settings}` |
| `auto-update-status` | `{}` | 一次性通知或 `null`（含 `reason: 'scheduled'\|'startup'`、`status: 'success'\|'error'`、成功计数或 `error`） |
| `sync-guard-roster` | `{expectedRoomId?}`（提供时须匹配当前 `roomId`） | `{roomId,ownerUid,total,created,updated,skipped,skippedDetails,profileRefresh:{updated,failed,skipped}}`；并发同步拒绝 |
| `preview-identity` | `{uid:string}`，带当前 `contextId` | `{uid,name,avatarUrl}`；只读 B 站公开资料，Cookie 留主进程，同上下文与 UID 在途请求并发复用 |
| `lookup-former-names` | `{uid:string}`，带当前 `contextId` | `{uid,names:string[]}`；主进程仅向 Aicu 传 UID（不传 B 站凭据），10 秒超时 |
| `supplement-former-names` | `{id}`（当前账号未归档且已绑定 UID 的档案） | `{added,profile:ProfileDetail}`；合并去重，返回后复核身份与授权 |
| `former-name-targets` | `{}` | `{ids:string[]}`（未归档、未屏蔽且有 UID 的档案 ID，供串行批量补充） |
| `settings` | `{}` | 当前作用域设置 |
| `configure` | `{autoCreate,autoUpdate,autoSyncGuardRoster?,accompanyMilestones?,showAccompanyInCalendar?}` | 更新后的作用域设置（陪伴节点规则见粉丝档案规格） |
| `guard-expiry` | 同 `list` 筛选条件，须带 `contextId` | 只读投影 `{state,observedAt,badges:[{profileId,level,days}]}`（`state` 为 `ready`/`loginRequired`/`ownerMismatch`/`roomNotConfigured`/`sourceChanged`/`unavailable`/`unsupported`）。传 `archived:true` 时仍读取页头所需的云端状态，返回 `badges:[]`，跳过用于匹配徽标的本机档案列表查询 |
| `detail` | `{id}`（非空所属档案 ID，`≤ 100` 字符） | `ProfileDetail` |
| `find` | `{identity}` | `ProfileDetail` 或 `null` |
| `create` | `ProfilePatch`（`alias` 必填） | `ProfileDetail` |
| `save` | `{id,revision,...ProfilePatch}` | `ProfileDetail`；`revision` 须匹配现存修订号 |
| `save-record` | `{profileId,id?,revision?,kind,data,occurredAt?}`（修改须匹配记录 `revision`，`kind` 不可改） | `{record,profile:ProfileDetail}` |
| `resolve-membership` | `{profileId,id,choice:'adopt'\|'keep'}`（`id` 为待确认的会员记录 ID） | `ProfileDetail` |
| `preview-merge` | `{id,revision,targetId,targetRevision?,patch?}`（源未绑定身份，目标已绑定） | `{source,target,recordCount}` |
| `merge` | 同预览，须附当前 `targetRevision` 与 `prefer: 'source'\|'target'` | `{profile,snapshotId}`（先创建恢复点） |
| `suppress` | `{id,revision}`（要求绑定可靠身份） | `true`；加入当前作用域黑名单并保留资料 |
| `suppression-list` | `{}` | `[{key,identity:[platform,type,value],name}]` |
| `unsuppress` | `{identity,confirm:true}` | `true`；解除屏蔽 |
| `reminders` | `{}` | 当前作用域提醒数组 |
| `calendar` | `{}`（只读，可不带 `contextId`） | 日期提醒数组 `{id,profileId,key,title,date,time:'',type:'personal',detail,readonly:true}`（目标日前 3 天至当天展示，排除已处理/忽略/暂缓、归档与黑名单） |
| `reminder-state` | `{profileId,key,status:'handled'\|'ignored'\|'snoozed'}` | `true`（`snoozed` 延至次日） |
| `delete` | `{id,confirm:true,suppress:boolean}` | `true` |
| `delete-all` | `{confirm:true}` | `{deletedCount}` |
| `backup` | `{}` | `BackupV2` |
| `preview-restore` | `{backup}` | `{added,updated,conflicts:[{incomingId,existingId,name,revision}],suppressionConflicts:[{existingId,name}],scope,digest,currentDigest}` |
| `restore` | `{backup,digest,currentDigest,conflicts:'keep'\|'replace'}` | `{snapshotId,added,updated}`（先建恢复点并保留当前游标） |
| `snapshots` | `{}` | 本机恢复点列表 |
| `preview-snapshot` | `{snapshotId}` | 同 `preview-restore` |
| `restore-snapshot` | `{snapshotId,confirm:true,digest,currentDigest}` | `{snapshotId}`（先备份当前作用域再完整恢复，保留黑名单，`cursor=0`、`epoch=null`） |
| `export-list` | `{fields?}`（`alias`/`platformName`/`uid`/`summary`/`birthday`/`mbti`/`notes`，缺省前三项） | CSV 字符串（含 BOM 与公式转义，排除归档与黑名单；生日为 `公历 MM-DD` / `农历 MM-DD` / `农历闰月 MM-DD`，未填则为空） |
| `preview-legacy` | `{profileId,from,to}`（档案必须已绑定带类型的明确 UID） | `{count,unownedCount,from,to,digest,records}` |
| `import-legacy` | 同上加 `{confirmOwnership:true,digest}` | `ProfileDetail`（按摘要认领，`sourceKey` 去重） |

**数据结构与关键约束**：

- **名单补查与跳过明细**：`profileRefresh` 仅统计名单外 UID 资料（`updated` / `failed` / `skipped` 与名单本身的 `created` / `updated` / `skipped` 独立；部分失败仍保留已成功入库数据）。`skippedDetails` 解释名单 `skipped`：上游身份不可用为 `{rank,reason:'hidden-identity'|'invalid-uid'}`（隐藏身份不附带 UID/昵称），本机跳过为 `{uid,name,reason:'archived'|'suppressed'}`（归属模块：[bilibili-guard-roster.js](../../../src/shared/bilibili-guard-roster.js)、[guard-roster-import.js](../../../src/fans/guard-roster-import.js)）。
- **`ProfilePatch` 校验（[validation.js](../../../src/fans/validation.js)）**：按 `String.length`（UTF-16 码元）在 `trim` **前**校验：`alias ≤ 100`、`summary ≤ 300`、`notes ≤ 20000`、`nextTopic ≤ 2000`、`zodiac ≤ 30`、`mbtiNote ≤ 500`、`preferredFormerName ≤ 200`；`tags ≤ 30` 项（每项 `≤ 50`）；`formerNames` 每项 `≤ 200`；布尔标志严格为布尔；`MBTI` 为空或规范 16 型。`save` 切换 `archived` 时保留 `guardRoster` 与会员记录，`detail` / `list` 的 `currentGuardLevel` 不清空。
- **曾用名与到期并发复用**：曾用名查询按上下文/授权代次/UID 合并在途请求（批量由前端逐人间隔 1 秒调用单人接口）；默认展示投影 `formerName` 优先人工 `preferredFormerName` 或最近可靠 `lastEntry.name`。到期标记由 `src/fans/guard-expiry.js` 独立投影，并发读取按上下文/房间合并（规则见 [粉丝档案规格](../../../specs/fan-profiles.md)）。
- **身份、生日与记录**：`identity` 为 `null` 或 `{platform:'bilibili',type:'uid'|'open_id',value}`（`value ≤ 128`，UID 为 1–25 位非零开头数字，不将 `open_id` 转 UID）。`birthday` 含 `monthDay`、`calendar`（`solar`/`lunar`）、`year`（`null` 或 `1900` 至当年）、`leapMonth`、`leapDay`（`feb28`/`mar01`）、`thisYearDate`、`advance`。记录 `kind` 支持 `membership` / `song` / `preference` / `anniversary` / `note` / `topic` / `caution` / `followup`，修改校验修订号并保留 `original` 与修订历史（`membership` 支持 `interval` / `baseline` / `observation` / `first`，冲突观察进入待确认态；`note` 正文 `≤ 10000`，纪念日 `advanceDays ≤ 30`）。
- **`ProfileDetail`**：含档案本体及 `formerNames`、`zodiacHint`、`records`、`songs`、`preferences`、`membership`、`guardRoster`、`guardAccompany`、`currentGuardLevel`、`musicSummary`、`musicStats`（近 30 天）、`reminders`（列表另附 `medalLevel`、`lastInteraction`、`nextReminder`）。
- **`BackupV2` 与恢复预览**：`{format:'lira-fan-profiles',version:2,scope,exportedAt,profiles,settings,suppressions}`，导入兼容 v1；仅恢复相同作用域，档案 ID 与绑定身份不可重复。`digest` 校验备份内容；`currentDigest` 校验本机数据，仅排除设置中的 `cursor`、`epoch`、`synchronizedAt`、`coverageSince`、`syncStatus`。空事实同步不会使预览失效，档案、记录、提醒处理、屏蔽或用户设置变化仍须重新预览。`suppressionConflicts` 列出备份将新增屏蔽的现存档案，独立于资料冲突；文件恢复的 `keep` / `replace`、歌曲来源兼容及事务回滚见[存储参考](../backend/storage.md#粉丝档案songdb-v6-新增六表--v14-模板表)，行为依据见[粉丝档案规格](../../../specs/fan-profiles.md#持久化契约)。

## 6. 礼物导出任务与取消

归属模块：[gift-export-controller.js](../../../src/electron/gift-export-controller.js)、[gift-export-runtime.js](../../../src/server/gift-export-runtime.js)、[query-service.js](../../../src/bilibili/gift/query-service.js) 的 `getGiftSelection`。

礼物导出与粉丝档案仅透传拥有者显式标记的 `publicMessage`，明确的业务校验错误由 [public-error.js](../../../src/shared/public-error.js) 创建；内部文件系统、SQLite 和网络异常即使含中文也不按原文返回。礼物保存路径错误仍按既有文件系统错误码映射为可公开提示，其他未知错误使用通用失败文案。

- `settings` 无参数时读取默认值。写入接受可选 `mode`（`combined`/`separate`）、`background`（`transparent`/`white`）、`sortBy`（`time`/`amount`）、`rowGap`（整数 `0–32`，单位为输出 PNG 像素）、布尔值 `mergeAcrossDates` 与 `directoryAction`（`choose`/`default`），拒绝未知字段与非法值。渲染进程不能传保存路径，目录由原生对话框或系统图片目录生成；取消选择不写入，导航/代次变化/销毁后忽略迟到结果。
- `prepare` 的 `selection` 须携带当前 `viewRevision`，可传 `eventIds`（1–10000 个非空字符串，各 `≤ 64`）或历史筛选条件。导出按时间从新到旧取回所选记录，查回条数须与去重 ID 数一致且不能为空（上限 10000 条）。冻结当前来源、流水、展示设置、目录与卡片，后续默认设置只影响新任务。见[礼物 HTTP 契约](../backend/api.md)。
- `ExportTask` 为 `{id,snapshot,root,directory,mode,background,sortBy,rowGap,mergeAcrossDates,styleSource,files:[{start,count,fileName}],custom}`。`snapshot` 含 `viewRevision` / `asOf` / `items`、同步元数据、`selectedCount` / `cardsPartial` 与 `config` / `catalog`。`sortBy` 默认 `time`。`amount` 在合并后、分页前按每张卡片的结算总金额降序排列，同额保留时间顺序。预览和 PNG 共用同一顺序与布局。`rowGap` 默认 16，适用于同一张图里每两张相邻卡片。单卡图禁用间距滑块，高度固定为 144 px。
- `styleSource` 默认为 `follow`，取本任务打开时的滚动礼物外观。切到 `custom` 时优先恢复上次自定义值，首次复制本任务的滚动外观。仅在自定义模式下可传完整 `customStyle`，包含 `tailStyle`、`textureStyle`、`thresholds` 三项。外形与纹理使用[滚动礼物枚举](../../../public/js/shared/gift-banner-styles.js)，金额为三个严格递增的正安全整数，单位为分。`snapshot.config` 是预览与写图共用的有效配置，`sheen` 固定为 `false`。`ExportTask.custom` 仍表示是否使用自选保存目录。
- `mergeAcrossDates` 默认关闭，预览按所选结算记录逐笔出卡，保留原数量。开启后按已确认的同人同礼物合并当天及历史记录；用今日资料合并的卡片以首条 `sourceEventId` 参与后续分组查询。每个任务复用一次合并结果，再次关闭即可恢复全部所选记录。
- `configure` 要求当前 `id` 与合法 `mode` / `background`。`remember === true` 时可记忆目录，传入样式参数时将来源与上次自定义值一并记忆。`combined` 每图最多 50 张卡片，高度上限 8768 px。允许的 0–32 px 间距均可容纳 50 张，超过 50 张时分页。`separate` 每图 1 张卡片。运行中不可修改配置或再次 `prepare`，已完成任务不可重复 `save`。取消选目录时沿用当前根目录，保留已记忆的目录设置。若同次调用的输出方式、背景、排序、间距、合并及样式选项均与当前任务一致，保留任务子目录、保存计数和完成状态。若这些选项有实际更改，更改仍生效。已尝试保存的任务在更改配置或显式重试时分配新子目录，保存计数从零开始，已写入的图片留在原处。
- 保存 PNG 时，主进程将此次预览的舰队人数 `{roomId,count}` 传给隐藏渲染窗口。人数超过 1000 时使用千舰款，人数未知时使用普通款。整批图片使用同一个人数快照。
- `save` 使用独占任务目录与防覆盖文件逐张渲染、截图并落盘（单步渲染超时 20 秒），`viewRevision` 变化立即使任务失效。进度 `{id,saved,total}` 表示已完成文件数；取消或部分失败保留已写文件并返回 `saved` / `directory`。
- 主窗口非原地导航或销毁时调用 `cancel`，`dispose` 取消任务并销毁隐藏渲染窗口；`preparationGeneration` 防止过期 `prepare` 覆盖新任务。宿主监听的绑定、去重与解绑和周表导出共用 [navigation-cancellation.js](../../../src/electron/ipc/navigation-cancellation.js)，各导出控制器仍拥有任务取消与清理。渲染进程按 `id` 过滤迟到进度并在关闭预览时取消订阅；`openFolder` 仅允许已保存至少一张的任务。

相关定向测试：[legacy-ipc-source.test.js](../../../test/desktop/legacy-ipc-source.test.js)、[fan-profiles-ipc.test.js](../../../test/fan-profiles/fan-profiles-ipc.test.js)、[daily-bot-controller.test.js](../../../test/bots/daily-bot-controller.test.js)、[daily-bot-takeover.test.js](../../../test/bots/daily-bot-takeover.test.js)、[gift-export-controller.test.js](../../../test/gifts/gift-export-controller.test.js)。
