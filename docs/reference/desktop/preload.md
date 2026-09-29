# preload 桥与 IPC 全量注册表

[preload.js](../../../src/electron/preload.js) 暴露 `dailyBots`、`fanProfiles`、`giftExport`、`songAssistantDesktop`、`musicAPI`、`bilibiliAuth`、`dynamicLotteryAuth`、`liraLicense` 八个命名空间。本文是通道、方向、载荷与 action 的唯一成表处；窗口生命周期见 [main.md](main.md)，更新状态见 [update.md](update.md)，登录与会话见 [auth.md](auth.md)。invoke、事件和复用通道中的 action 分别核对，不混算。

## 1. 安全模型

所有桥仅暴露固定方法，不暴露 `ipcRenderer`、任意 URL 请求、Device token、Cookie 或租户选择器。窗口保持 `contextIsolation: true`、`nodeIntegration: false`。下表记录实际来源检查，不能把一种 registrar 的规则套给所有 IPC。

| handler owner | 当前主窗口 webContents / 精确 desktop origin | 主 frame 对象 | pathname 范围 |
| --- | --- | --- | --- |
| [main-window-ipc.js](../../../src/electron/ipc/main-window-ipc.js)：music、playback、bilibili、desktop 资源检查 | 必须 | 必须 | `/`、`/admin`、`/settings`、`/songs` |
| [update-ipc.js](../../../src/electron/ipc/update-ipc.js)：其余 desktop | 必须 | 必须 | 上述路径加 `/license` |
| [daily-bot-ipc.js](../../../src/electron/ipc/daily-bot-ipc.js) | 必须 | 必须 | `/`、`/admin`、`/settings` |
| [fan-profile-ipc.js](../../../src/electron/ipc/fan-profile-ipc.js)、[gift-export-ipc.js](../../../src/electron/ipc/gift-export-ipc.js) | 必须 | 必须 | `/`、`/admin`、`/settings`、`/songs` |
| [dynamic-lottery-auth-ipc.js](../../../src/electron/ipc/dynamic-lottery-auth-ipc.js)、[gift-interaction-ipc.js](../../../src/electron/ipc/gift-interaction-ipc.js) | 必须 | 必须 | 不另检查路径，包含同 origin 的 `/license` |
| [license-ipc.js](../../../src/electron/ipc/license-ipc.js)：overlay-filters GET/PUT、overlay-viewers GET | 必须 | 必须 | 不另检查路径 |
| 同上：其余 license | 必须 | **不要求** mainFrame 对象 | 不另检查路径；同 origin 子 frame 也通过该来源检查 |

非法来源返回 `{ok:false,error:'IPC_SOURCE_INVALID'}`；license registrar 另带脱敏 `state`。此检查不是远端授权，具体操作仍受 LicenseManager 的授权及代次约束。当前主窗口匹配同时限定实际 Chromium session；renderer 不能指定分区。不要将未实施的路径/frame 限制写成已有保护。

## 2. renderer → main（invoke）

以下每行的无参数表示 preload 不发送参数；只有资源检查 handler 明确拒绝额外参数。除明确标出的错误封装外，旧 music/bilibili/desktop handler 的异常可使 invoke Promise reject，不能假定所有返回都有 `ok`。

### 2.1 songAssistantDesktop

Owner 为 [update-ipc.js](../../../src/electron/ipc/update-ipc.js)。直接消费者是 [desktop.js](../../../public/js/desktop.js) 的更新/目录入口与窗口控件，以及 [settings-operations.js](../../../public/js/admin/settings-operations.js)；资源检查也由桌面 UI 消费。

| 通道 | 桥方法与输入 | 成功返回 / 公开失败 |
| --- | --- | --- |
| `desktop:get-info` | `getInfo()` | `{version,isPackaged,platform,dataDir,logFile,terminalLogFile,githubRepoUrl,updateState}` |
| `desktop:get-resource-integrity-state` | `getResourceIntegrityState()` | 资源检查快照；多余参数 `IPC_ARGUMENTS_INVALID` |
| `desktop:check-resource-integrity` | `checkResourceIntegrity()` | 当前/新任务快照，重复请求合并；同上 |
| `desktop:check-for-updates` | `checkForUpdates()` | 更新状态对象，字段与错误状态见 [update.md](update.md) |
| `desktop:download-update` | `downloadUpdate()` | 更新状态对象 |
| `desktop:install-update` | `installUpdate()` | 更新状态对象；安装前停止资源检查，生命周期见 [main.md](main.md#7-关闭序列与播放状态冲刷) |
| `desktop:open-data-dir` | `openDataDir()` | `shell.openPath` 的空字符串或错误文字 |
| `desktop:open-log-dir` | `openLogDir()` | 同上 |
| `desktop:open-github` | `openGithub()` | `undefined`（等待系统打开固定仓库地址） |
| `desktop:set-auto-update` | `setAutoUpdate(enabled)`，调用方传 boolean | `undefined`；handler 只记录 `Boolean(enabled)`，不严格校验/持久化；设置另经 HTTP 保存 |
| `desktop:gift-display` | `reportGiftDisplay(gift)`，兼容任意旧载荷 | `{ok:true}`，no-op，无当前业务消费者 |
| `desktop:restart` | `restart()` | `undefined`；受控关停后 relaunch/exit |
| `desktop:close-window` | `closeWindow()` | `undefined` |
| `desktop:minimize-window` | `minimizeWindow()` | `undefined` |
| `desktop:maximize-window` | `maximizeWindow()` | `undefined`；切换最大化状态 |

资源检查仅接受管理页面；其余本组允许 `/license`。资源快照的 `revision`、状态及错误语义由 [更新文档](update.md)「客户端资源检查」维护。

### 2.2 musicAPI 与 bilibiliAuth

Owner 为 [music-ipc.js](../../../src/electron/ipc/music-ipc.js)、[bilibili-ipc.js](../../../src/electron/ipc/bilibili-ipc.js)，会话任务由 [desktop-auth-controller.js](../../../src/electron/desktop-auth-controller.js) 串行化/取消。音乐平台字符串 trim/lowercase 后仅 `qq` / `netease`；无效平台 reject。健康查询允许省略平台以查询全部。

| 通道 | 桥方法与输入 | 成功返回 / 特殊约束 |
| --- | --- | --- |
| `music:get-auth-state` | `musicAPI.getAuthState(platform)` | MusicAuth（下文） |
| `music:login` | `musicAPI.login(platform)` | `{platform,snapshot,state}`，等待登录窗关闭，state 为 MusicAuth（读取失败时仅 `{loggedIn:false}`） |
| `music:logout` | `musicAPI.logout(platform)` | 最新 MusicAuth |
| `music:clear-cache` | `musicAPI.clearCache()` | `{cleared:[platform]}`，只清浏览器缓存 |
| `music:provider-health` | `musicAPI.providerHealth(platform?)` | 单个 `{source,name,ok,status,message,auth}` 或数组；status=logged-in/public-ok/api-error，auth 为脱敏登录摘要，见 [provider-registry.js](../../../src/music/provider-registry.js) |
| `music:select-local-files` | `musicAPI.selectLocalFiles()` | `{ok:true,canceled,files:[{path,name,ext}]}`；取消时 files=[]；原生对话框选 mp3/flac/wav/aac/ogg/m4a/wma，选中路径加入本地媒体允许列表 |
| `music:get-recent-local-files` | `musicAPI.getRecentLocalFiles()` | `{files:[{path,name,ext}]}`，仅仍存在的已允许路径 |
| `music:select-wesing-cache` | `musicAPI.selectWeSingCacheDirectory()` | `{ok:true,canceled,path}`；取消 path=''，选目录不等于保存配置 |
| `music:resolve-local-media-urls` | `musicAPI.resolveLocalMediaUrls(paths)`，字符串数组；非数组按 [] | `{results:{[path]:{ok:true,url}或{ok:false,reason}}}`；reason=`missing`/`not-allowed`/`error`，URL 为 `local-media://media/<base64url>` |
| `playback:save-state` | `musicAPI.savePlaybackState(clientId,payload)` → `{clientId,payload}` | `{saved:true,bytes}`（bytes 实为 JSON 文本 String.length），或 `{saved:false,reason:'stale-snapshot'}`；保存异常为 `{ok:false,error}`，runtime 未就绪返回 `{ok:false,error:'Playback store not available'}`；缺省 clientId=`default`、payload={}，快照格式见 [播放文档](../frontend/playback.md) |
| `playback:flush-ack` | `musicAPI.confirmShutdownFlush()` | `{ok:true}`，确认当前退出 flush |
| `bilibili:get-auth-state` | `bilibiliAuth.getAuthState()` | BilibiliAuth（下文） |
| `bilibili:get-profile` | `bilibiliAuth.getProfile()` | `{uid,name,avatarUrl}`；未登录 uid=0/当前值，名称和头像为空 |
| `bilibili:login` | `bilibiliAuth.login()` | `{snapshot,state}`，state 为 BilibiliAuth（读取失败时仅 `{loggedIn:false}`） |
| `bilibili:logout` | `bilibiliAuth.logout()` | 最新 BilibiliAuth |

MusicAuth 为 `{platform,name,loggedIn,cookieCount,keyCookieNames,encryptedSnapshotExists,lastSavedAt,encryptionAvailable}`；BilibiliAuth 无 platform，增加 `uid,hasSessdata`，其余同类元数据；不含 Cookie 值。snapshot 为保存结果（可空，含 savedAt/cookieCount），不是明文凭据。实际 owner 为 [music-auth-manager.js](../../../src/electron/music-auth-manager.js)、[bilibili-auth.js](../../../src/electron/bilibili-auth.js)。

直接消费者：音乐登录与健康由 [provider/manager.js](../../../public/js/playback/provider/manager.js)、[provider-operations.js](../../../public/js/playback/operations/provider-operations.js) 调用；文件与 URL 由 [local/manager.js](../../../public/js/playback/local/manager.js) 和 [playback-controls.js](../../../public/js/playback/features/playback-controls.js) 调用；WeSing 由 [wesing-service.js](../../../public/js/playback/services/wesing-service.js) 调用；保存/退出由 [state-persistence.js](../../../public/js/playback/operations/state-persistence.js)、[initializer.js](../../../public/js/playback/core/initializer.js) 调用；Bilibili 由 [settings-auth.js](../../../public/js/admin/settings-auth.js) 调用。

### 2.3 dynamicLotteryAuth

Owner 为 [dynamic-lottery-auth-ipc.js](../../../src/electron/ipc/dynamic-lottery-auth-ipc.js)，消费者 [dynamic-lottery.js](../../../public/js/admin/dynamic-lottery.js)。不接收 UID、streamerId、Cookie 或快照路径。

| 通道 | 桥方法与输入 | 返回 |
| --- | --- | --- |
| `dynamic-lottery-auth:get-state` | `getState()` | `{ok:true,state:{loggedIn,uid,warning}}` |
| `dynamic-lottery-auth:login` | `login()` | 同上，等待独立抽奖账号窗口关闭 |
| `dynamic-lottery-auth:logout` | `logout()` | 同上，清除当前主体的专用会话 |

uid 仅接受非零开头十进制字符串 1–64 位；未登录返回空字符串。warning 为公开代码或空字符串。错误 `{ok:false,error}` 的代码仅 `IPC_SOURCE_INVALID`、`LOTTERY_IDENTITY_UNAVAILABLE`、`LOTTERY_SESSION_CHANGED`、`LOTTERY_SESSION_DISPOSED`、`LOTTERY_AUTH_BUSY`、`LOTTERY_AUTH_ENCRYPTION_UNAVAILABLE`、`LOTTERY_AUTH_RESTORE_FAILED`，其他收敛为 `LOTTERY_AUTH_FAILED`。专用账号不切换直播账号；主进程按可信主体隔离、取消和丢弃迟到结果，详见 [auth.md](auth.md)。

### 2.4 liraLicense

除礼物互动外，owner 均为 [license-ipc.js](../../../src/electron/ipc/license-ipc.js)。本组失败一般为 `{ok:false,state,error,index?,fieldErrors?}`：error 匹配 `^[A-Z][A-Z0-9_]{0,63}$`，其他异常收敛 `LICENSE_ERROR`；index 为非负安全整数；fieldErrors 只保留欢迎设置白名单字段与原因。各行还受 §1 的差异化来源规则约束，远端请求由 LicenseManager 持有凭据、固定路径和授权代次。

| 通道 | 桥方法与输入 | 成功 DTO / 特有公开错误 | 直接消费者 |
| --- | --- | --- | --- |
| `license:get-state` | `getState()` | `{ok:true,...LicenseSnapshot}` | [license.js](../../../public/js/license.js)、settings-auth |
| `license:activate` | `activate({accountName,password,activationCode})` | `{ok,state,error?,streamer?}`；ACTIVATION_INPUT_INVALID / ACCOUNT_NAME_LENGTH / PASSWORD_TOO_LONG / ACTIVATION_CODE_INVALID | license.js |
| `license:retry` | `retry()` | `{ok,...LicenseSnapshot}`，ok 表示 authorized | license.js |
| `license:get-gift-catalog-state` | `getGiftCatalogState()` | `{ok:true,...CatalogSnapshot}` | license.js、[catalog-update-toast.js](../../../public/js/admin/gifts/catalog-update-toast.js) |
| `license:retry-gift-catalog` | `retryGiftCatalog()` | `{ok,...CatalogSnapshot}`，ok 表示 ready；未授权 LICENSE_REQUIRED | 同上 |
| `license:get-profile` | `getProfile()` | `{ok:true,...LicenseSnapshot}` | settings-auth、[server-overlay-url.js](../../../public/js/admin/server-overlay-url.js) |
| `license:get-overlay-settings` | `getOverlaySettings()` | OverlaySettings | [danmaku-overlay-settings.js](../../../public/js/admin/danmaku-overlay-settings.js)、server-overlay-url |
| `license:update-overlay-settings` | `updateOverlaySettings({style,fullscreenDurationSeconds,styleOptions?})` | OverlaySettings；INVALID_OVERLAY_STYLE / INVALID_OVERLAY_DURATION | danmaku-overlay-settings |
| `license:get-overlay-filters` | `getOverlayFilters()` | `{ok:true,blockedUsers:[{uid,name}],blockedKeywords:[]}` | [danmaku-overlay-filters.js](../../../public/js/admin/danmaku-overlay-filters.js) |
| `license:update-overlay-filters` | `updateOverlayFilters(patch)` | 同上；非法参数/不支持能力见 filters contract | 同上 |
| `license:get-overlay-viewers` | `getOverlayViewers()` | `{ok:true,roomId,viewers:[{uid,name}]}` | 同上 |
| `license:get-welcome-settings` | `getWelcomeSettings()` | `{ok:true,enabled,messages}` | [danmaku-welcome.js](../../../public/js/admin/danmaku-welcome.js)（V1 兼容） |
| `license:update-welcome-settings` | `updateWelcomeSettings(patch)` | 同上；INVALID_WELCOME_SETTINGS / INVALID_WELCOME_MESSAGES | 同上 |
| `license:get-welcome-settings-v2` | `getWelcomeSettingsV2()` | 完整 V2 配置和 schemaVersion:2；仅明确 404 回落 V1 投影 schemaVersion:1 | danmaku-welcome |
| `license:update-welcome-settings-v2` | `updateWelcomeSettingsV2(patch)` | 完整 V2 配置，不降级重放；可带 fieldErrors | 同上 |
| `license:get-pk-report-settings` | `getPkReportSettings()` | `{ok:true,enabled:boolean}` | [danmaku-pk-report.js](../../../public/js/admin/danmaku-pk-report.js) |
| `license:update-pk-report-settings` | `updatePkReportSettings({enabled})`，严格 boolean、唯一字段 | 同上；INVALID_PK_REPORT_SETTINGS / INVALID_RESPONSE | 同上 |
| `license:sync-songs` | `syncSongs(songs)`，数组 ≤5000，JSON.stringify.length ≤4×1024×1024（UTF-16 单元，不是字节） | `{ok,count?,index?,songPageUrl?}`；SONG_LIST_INVALID / SONG_LIST_TOO_LARGE | [cloud-song-sync.js](../../../public/js/admin/cloud-song-sync.js) |
| `license:get-cloud-songs` | `getCloudSongs()` | `{songs:[SongPublic]}`，没有统一 ok 外层 | 同上 |
| `license:get-song-page-background` | `getSongPageBackground()` | BackgroundResponse | [song-background.js](../../../public/js/admin/song-background.js) |
| `license:upload-song-page-background` | `uploadSongPageBackground(bytes,fileName)` → `{bytes,fileName}`，非空 Uint8Array ≤5 MiB，fileName 为提示 | BackgroundResponse；BACKGROUND_IMAGE_REQUIRED / PAYLOAD_TOO_LARGE | 同上 |
| `license:delete-song-page-background` | `deleteSongPageBackground()` | BackgroundResponse，background 可 null | 同上 |
| `license:get-gift-interaction-state` | `getGiftInteractionState()` | GiftInteractionSnapshot | [interaction-controls.js](../../../public/js/admin/gifts/interaction-controls.js) |
| `license:set-gift-interaction` | `setGiftInteraction(key,enabled)` → `{key,enabled}`，拒绝额外字段 | GiftInteractionSnapshot；INVALID_GIFT_INTERACTION / GIFT_INTERACTION_PENDING / CLOUD_SYNC_FAILED | 同上 |

共享 DTO 与约束：

- **LicenseSnapshot**：`{state,error,streamer?,device?}`；state 为 checking/needs_activation/needs_connection/authorizing/authorized/blocked，error 为受限代码或 null。streamer 只含 accountName(32)、displayName(80)、subdomain(63)、songPageUrl?/manageUrl?；device 只含 id(128)、name(100)、status(32)、licenseId(128)，括号为字符串截断上限。activate 将三字段转字符串后要求非空，上限分别 64/256/256；不接受 renderer 选择服务地址。
- **CatalogSnapshot**：`{status,background,phase,completed,total,available,failed,percent,currentGiftId,currentGiftName,completedAt,error,warning}`。status=required/running/updating/ready/error；phase=idle/catalog/images/complete/error；计数非负且 completed≤total、available/failed≤completed、percent≤100；礼物 ID/名称上限 32/100；background 严格 boolean；completedAt 为 ISO 时间或 null。首次 running 与后台 updating 区分；后台 images 计数只表示本次下载，单图失败保留旧图。返回登录表单不撤销授权，renderer 离开准备流程后忽略迟到进度；进入 Admin 仍由 main 判定。
- **OverlaySettings**：`{ok:true,style,fullscreenDurationSeconds,styleOptions?,overlayUrl}`。style 仅 bubble/signal/minimal/ranked/transparent/identity/outline/cream/glow；时长整数 2–30；可选 styleOptions 由 [danmaku-style-options.js](../../../src/shared/danmaku-style-options.js) 归一化。overlayUrl 为无凭据/query/fragment 的 HTTPS `/overlay/<16位base64url>`；消费者另验证与可信资料 origin 相同。它是只读 overlay capability，不能代替 Device token。
- **过滤设置**：[overlay-filters-contract.js](../../../src/shared/overlay-filters-contract.js) 是字段 owner。非空 patch 只含 blockedUsers/blockedKeywords；最多 500 人/200 词，UID 为 1–20 位非零开头数字，name≤80、词≤100；在线观众≤150。清空仅提交相应空数组；404/405 映射 OVERLAY_FILTERS_UNSUPPORTED。只在服务器确认后更新已保存值。
- **欢迎配置**：V1 非空 patch 只含 enabled(boolean)/messages；词库 1–30 条，每条非空且 ≤80 Unicode code point，禁止控制字符，随后 trim。V2 的 enabled/greetingEnabled/attentionEnabled/rareNamePinyinEnabled 为 boolean；welcomeDelaySeconds=0–300、greetingDelaySeconds=1–600、welcomeMinHonorLevel/greetingMinHonorLevel=0–999、attentionMinHonorLevel=1–999，均为整数；messages/greetingMessages/attentionWelcomeMessages/attentionGreetingMessages 沿用词库规则。完整响应要求所有字段，关闭 welcome 时不能开启 greeting/attention，greeting 开启时 delay 必须大于 welcome delay。校验和 fieldErrors 白名单见 [welcome-settings-contract.js](../../../src/shared/welcome-settings-contract.js)，并发草稿见 [main.md](main.md#服务器进场欢迎设置)。
- **SongPublic**：只复制 [license-ipc.js](../../../src/electron/ipc/license-ipc.js) 的 `SONG_PUBLIC_FIELDS`（ID、标题/名称、歌手、分类、tags、语言、来源、备注、价格、片段、启用、排序、时间及其兼容别名）；值仅 null/string/boolean/有限 number，字符串截断 4096，不透传对象或数组。
- **BackgroundResponse**：`{ok,background:null或{url?,previewUrl?,bytes?,updatedAt?}}`；相对 url 与可信 HTTPS previewUrl 均经过清洗，不返回凭据 query。previewUrl 由 main 基于可信服务 origin 解析，renderer 不指定远端地址。
- **GiftInteractionSnapshot**：`{ok,values:{giftAutoThanksEnabled,giftStatsQueryEnabled},status,error}`，两个值均 boolean；status=confirmed/pending/unconfirmed，error 为代码或 null。key 仅这两个开关，enabled 严格 boolean；owner 为 [gift-interaction-ipc.js](../../../src/electron/ipc/gift-interaction-ipc.js) 和 cloud-sync-controller。意图并入已有同步队列，省略另一开关以保留服务器值，只有确认目标值后才显示成功。见 [规格](../../../specs/gift-interaction-controls.md)。

### 2.5 dailyBots、fanProfiles 与 giftExport

| 通道 | 桥方法与输入 | 返回 | handler / 直接消费者 |
| --- | --- | --- | --- |
| `daily-bots:invoke` | `dailyBots.invoke({action,contextId?,payload?})` | `{ok:true,contextId,accountName,...actionResult}`；失败 `{ok:false,error}` | [daily-bot-ipc.js](../../../src/electron/ipc/daily-bot-ipc.js) / [danmaku-daily-bots.js](../../../public/js/admin/danmaku-daily-bots.js) |
| `fan-profiles:invoke` | `fanProfiles.invoke({action,contextId?,payload?})` | `{ok:true,contextId,data,syncStatus,roomId,accountName}`；失败见 §5 | [fan-profile-ipc.js](../../../src/electron/ipc/fan-profile-ipc.js) / [fans/index.js](../../../public/js/admin/fans/index.js)、[automatic-update.js](../../../public/js/admin/fans/automatic-update.js) |
| `gift-export:settings` | `giftExport.settings(options?)` | `{ok:true,data:{mode,background,directory,custom}}` | [gift-export-ipc.js](../../../src/electron/ipc/gift-export-ipc.js) / [export-preview.js](../../../public/js/admin/gifts/export-preview.js) |
| `gift-export:prepare` | `giftExport.prepare(selection)` | `{ok:true,data:ExportTask}` | 同上 |
| `gift-export:configure` | `giftExport.configure({id,mode,background,directoryAction?,remember?})` | `{ok:true,data:ExportTask}` | 同上 |
| `gift-export:save` | `giftExport.save(id)` → `{id}` | **直接**返回 `{ok:true,saved,directory}` 或 `{ok:false,cancelled,saved,directory,error}`；启动前异常可仅 `{ok:false,error}` | 同上 |
| `gift-export:cancel` | `giftExport.cancel(id?)`，原始 id | `{ok:true,data:undefined}`；不匹配的非空 id 不取消当前任务 | 同上 |
| `gift-export:open-folder` | `giftExport.openFolder(id)` → `{id}` | `{ok:true,data:{ok:true}}`，要求该任务已保存≥1张 | 同上 |

礼物导出其他方法失败统一 `{ok:false,error}`，保留中文错误，否则“礼物导出失败，请重新打开预览。”；来源非法仍用 IPC_SOURCE_INVALID。参数与任务时序见 §6。

## 3. 消息、订阅与播放持久化

当前 preload **没有 renderer → main 的 `ipcRenderer.send`**；退出 ack 也使用 invoke。下表是 main → renderer 消息，由 preload 的 on 包装。所有 on 方法剥离 Electron event，只传载荷；无效 callback 返回 no-op，否则返回 `removeListener` 取消函数，只移除该次订阅。页面/toolbox 释放时必须调用取消函数，重新进入不得叠加订阅。

| 通道 | 桥订阅方法 | 载荷 | 发送 owner / 直接消费者 |
| --- | --- | --- | --- |
| `gift-export:progress` | `giftExport.onProgress(callback)` | `{id,saved,total}`，均为该任务已保存进度 | gift-export-ipc / export-preview，按当前 id 过滤 |
| `desktop:resource-integrity-state` | `songAssistantDesktop.onResourceIntegrityState(callback)` | 资源检查快照 | [desktop-resource-integrity.js](../../../src/electron/desktop-resource-integrity.js) / desktop.js，按单调 revision 忽略旧值 |
| `desktop:show-update-page` | `songAssistantDesktop.onShowUpdatePage(callback)` | 无 | 预留监听，当前 main 无发送者 / desktop.js |
| `desktop:update-state` | `songAssistantDesktop.onUpdateState(callback)` | 更新状态，见 [update.md](update.md) | main 的 sendUpdateState / desktop.js |
| `desktop:window-maximized` | `songAssistantDesktop.onWindowMaximized(callback)` | boolean | main 的 maximize/unmaximize / 桌面窗口控件 |
| `app:prepare-shutdown` | `musicAPI.onPrepareShutdown(callback)` | 无 | [playback-flush.js](../../../src/electron/playback-flush.js) / playback initializer |
| `license:gift-interaction-state-changed` | `liraLicense.onGiftInteractionStateChanged(callback)` | GiftInteractionSnapshot | gift-interaction-ipc / interaction-controls |
| `license:state-changed` | `liraLicense.onStateChanged(callback)` | LicenseSnapshot | license-ipc / license.js、Admin 账户与各云端面板 |
| `license:gift-catalog-state-changed` | `liraLicense.onGiftCatalogStateChanged(callback)` | CatalogSnapshot | license-ipc / license.js、catalog-update-toast |

授权/目录事件发送到当前存活主窗口，并非“所有窗口”；license-ipc 发送时不另外检查页面路径或 origin。礼物互动发送另外检查精确 origin；资源检查发送还检查管理页。sender 检查与远端代次检查不能替代 renderer 自身任务 ID/草稿版本判断。

播放保存链路：StorageManager → savePlaybackState → music-ipc → desktopRuntime.persistPlaybackSnapshot → playback-store 的 play_queue_state。退出时 main 发 prepare-shutdown，renderer 保存后 confirmShutdownFlush；main 等 ack 或 2 秒超时后继续清理，见 [关闭时序](main.md#7-关闭序列与播放状态冲刷)。礼物 SSE/pull 没有 renderer IPC：main 将事件导入本地投影，再经 HTTP/WS snapshot、历史和 gift:frame 消费。

## 4. 每日机器人 action

[daily-bot-controller.js](../../../src/electron/daily-bot-controller.js) 和 [daily-bot-contract.js](../../../src/shared/daily-bot-contract.js) 拥有本节。请求对象仅 action/contextId/payload；除 open 外必须带当前 contextId，payload 缺省 {}，各 action 拒绝未知字段。revision 为非负安全整数。

| action | payload | actionResult |
| --- | --- | --- |
| `open` | {} | `{data:DailyBotSettings}` |
| `summary` | {} | `{summary}`，本地旧记录数量、词库状态、sourceLabel |
| `update` | `{kind:'checkin'或'fortune',enabled:boolean,expectedRevision}` | `{data:DailyBotSettings}` |
| `decide` | `{decision:'no-legacy'或'fresh-start',expectedRevision,legacyStoppedConfirmed:true}` | `{data:DailyBotSettings}`；no-legacy 遇现存数据/自定义词库失败 |
| `prepare` | `{legacyStoppedConfirmed:true,ownershipConfirmed:true,libraryChoice:{checkin,fortune},blessings?,fortunes?}`；choice 各为 legacy/builtin/corrected，corrected 提供相应词库 | `{draftId,summary,blessings,fortunes,cutoffAt,digest,resumed}` |
| `apply` | `{draftId}` | 成功 `{data,imported:true}`；preflight 未通过 `{data,preflight:{valid:false,issues}}` |
| `cancel` | `{id,expectedRevision}`，id 为服务器 import ID | `{data:DailyBotSettings}` |

DailyBotSettings 为 `{executionOwner:'server',observedAt,takeover,checkin,fortune}`。takeover 含 state(pending/importing/ready)、decision(null/no-legacy/fresh-start/imported)、revision、legacyStoppedAt、importId、sourceDigest；后三项可 null。checkin/fortune 各含 enabled/revision/reason；reason 白名单为 pending/importing/disabled/running/streamer-disabled/monitor-disabled/room-not-set/waiting-login/monitor-disconnected。observedAt 规范为 ISO。

prepare 冻结本机来源摘要及 SHA256 digest；canonical UTF-8 数据预算 16 MiB。apply 每批≤250条，使用同一 import ID 的 start/status/upload/preflight/commit，丢失提交响应不改 ID；提交前后检查来源，变化时返回 DAILY_BOT_SOURCE_CHANGED 或 DAILY_BOT_COMMITTED_SOURCE_CHANGED。preflight 最多100条 issues，字段/原因白名单由 controller 的 safePreflight 维护。

上下文由 main 的 `[server origin,streamerId,authorizationEpoch]` 生成 UUID；账号/授权代次变化就清空上下文和草稿，每次远端 await 前后检查。并发请求返回 DAILY_BOT_BUSY；dispose 清空状态并解除订阅（无 whenIdle）。公开错误允许 DAILY_BOT_*、LICENSE_NOT_AUTHORIZED；非该前缀的404映射 DAILY_BOT_UNSUPPORTED，其他为 DAILY_BOT_UNAVAILABLE。常见还有 DAILY_BOT_ACCOUNT_CHANGED、DAILY_BOT_INVALID_REQUEST、DAILY_BOT_DRAFT_REQUIRED、DAILY_BOT_TAKEOVER_CONFLICT、DAILY_BOT_IMPORT_TOO_LARGE。

当前 UI 只调用 open/update；其他 action 是旧数据接管兼容，不是首次开启的前置步骤。云端备份整库恢复不经过这些 action，失败不能回退本地执行。

## 5. 粉丝档案 action 与 DTO

Owner：[fan-profile-controller.js](../../../src/electron/fan-profile-controller.js)、[profile-service.js](../../../src/fans/profile-service.js)、[profile-transfer.js](../../../src/fans/profile-transfer.js)。scope 由已认证的 `[normalized server origin,streamerId]` 决定，roomId 只是名单来源。open/auto-update-status 可不带 contextId，其余必须匹配当前上下文。相同 scope 续期保留 contextId，但切换授权 epoch 会取消旧请求；换账号或失去授权后 ID 失效。异步工作同时核对 ID/epoch，名单还核对 roomId。dispose 清 timer/请求/订阅，whenIdle 等同步、名单及自动任务，先于 DB 关闭。

成功外层见 §2.5，syncStatus 为 offline/pending/syncing/ready/unsupported；下表只列 data。失败 `{ok:false,error,existingId?}`：保留中文错误，否则“档案操作失败，输入尚未保存，请重试。”；身份冲突可附 existingId，非法来源为 IPC_SOURCE_INVALID。它不是统一枚举错误码接口。领域 payload 必须对象、非数组，JSON.stringify.length≤16×1024×1024（UTF-16 单元）。

| action | payload | data |
| --- | --- | --- |
| `open` / `list` | `{query?,archived?,filters?}`；query≤300，filters 可 favorite/incomplete/active/past/unknown | `{profiles,settings}` |
| `auto-update-status` | {} | 一次性通知或 null；通知含 reason=scheduled/startup、status=success/error、成功计数或 error |
| `sync-guard-roster` | `{expectedRoomId?}`，提供时须匹配当前 roomId | `{roomId,ownerUid,total,created,updated,skipped}`；并发同步拒绝 |
| `settings` | {} | 当前 scope 设置 |
| `configure` | `{autoCreate:boolean,autoUpdate:boolean,autoSyncGuardRoster?:boolean}` | 更新后的 scope 设置 |
| `detail` | `{id}`，非空所属档案 ID，文本≤100 | ProfileDetail |
| `find` | `{identity}` | ProfileDetail 或 null |
| `create` | ProfilePatch，alias 必填 | ProfileDetail |
| `save` | `{id,revision,...ProfilePatch}` | ProfileDetail；revision 必须与现存版本相等 |
| `save-record` | `{profileId,id?,revision?,kind,data,occurredAt?}`；修改须匹配记录 revision，kind 不可改变 | `{record,profile:ProfileDetail}` |
| `resolve-membership` | `{profileId,id,choice:'adopt'或'keep'}`，id 指 pending 会员依据 | ProfileDetail |
| `preview-merge` | `{id,revision,targetId,targetRevision?,patch?}`；源未绑定身份，目标已绑定 | `{source,target,recordCount}` |
| `merge` | 同预览，必须给当前 targetRevision、`prefer:'source'或'target'` | `{profile,snapshotId}`；先创建恢复点 |
| `suppression-list` | {} | `[{key,identity:[platform,type,value]}]` |
| `unsuppress` | `{identity,confirm:true}` | true |
| `reminders` | {} | 当前 scope 提醒数组 |
| `reminder-state` | `{profileId,key,status:'handled'或'ignored'或'snoozed'}` | true；snoozed 延至次日 |
| `delete` | `{id,confirm:true,suppress:boolean}` | true |
| `delete-all` | `{confirm:true}` | `{deletedCount}` |
| `backup` | {} | BackupV1 |
| `preview-restore` | `{backup}` | `{added,updated,conflicts:[{incomingId,existingId,name,revision}],scope,digest,currentDigest}` |
| `restore` | `{backup,digest,currentDigest,conflicts:'keep'或'replace'}` | `{snapshotId,added,updated}`，先保存恢复点并保留当前 cursor |
| `snapshots` | {} | 本机恢复点列表 |
| `preview-snapshot` | `{snapshotId}` | 与 preview-restore 同型 |
| `restore-snapshot` | `{snapshotId,confirm:true,digest,currentDigest}` | `{snapshotId}`，先备份当前 scope，再完整恢复，cursor=0/epoch=null |
| `export-list` | `{fields?}`，仅 alias/platformName/uid/summary/birthday/mbti/notes；缺省前三项 | CSV 字符串（BOM、公式转义、非归档） |
| `preview-legacy` | `{profileId,from,to}`，日期范围；档案必须有 typed UID | `{count,unownedCount,from,to,digest,records}` |
| `import-legacy` | 同上加 `{confirmOwnership:true,digest}` | ProfileDetail；按预览摘要认领，sourceKey 去重 |

ProfilePatch 校验 owner 为 [validation.js](../../../src/fans/validation.js)：alias≤100、summary≤300、notes≤20000、nextTopic≤2000、zodiac≤30、mbtiNote≤500；长度按 JavaScript String.length（UTF-16 code unit）在 trim **前**检查，null 文本转空。tags≤30项、每项≤50，先检查再过滤空值/去重；formerNames≤3项、每项≤200。favorite/archived/milestoneReminders/expiryReminders 严格 boolean；MBTI 为空或规范16型，mbtiConfirmedAt 为日期。

identity 可 null，否则 `{platform:'bilibili',type:'uid'或'open_id',value}`；value≤128、无空白/控制符，UID 为1–25位非零开头数字，不把 open_id 转 UID。birthday 可 null，否则 monthDay、calendar=solar/lunar、year(null或1900至当前年)、leapMonth、leapDay=feb28/mar01、thisYearDate、advance；日期校验由 validation/dates 拥有。

ProfileDetail 包含保存后的档案（id/revision/时间/identity/资料）及 formerNames、zodiacHint、records、songs、preferences、membership、guardRoster、currentGuardLevel、musicSummary、musicStats（90天 count/categories）、reminders。列表还附 medalLevel、lastInteraction、nextReminder；列表不是详情记录的替代。

记录 kind 支持 membership/song/preference/anniversary/note/topic/caution/followup。occurredAt 为可解析带时区 ISO 时间，省略用当前时间；修改检查 revision，保留 original 和修订历史。membership 的 type 为 interval/baseline/observation/first：interval 指定 date 起止或 instant 起止，end 必须晚于 start；interval/observation level=1/2/3；observation 需 observedAt、status=inactive 或默认 observed；baseline 需 asOf、totalDays/continuousDays 至少一个，数值为0–100000安全整数且累计≥连续；first 需 date。冲突观察进入 pending，resolve-membership 才采用/保留，不能把观察日推算成连续会员天数。其他 kind 字段与限制见 `recordData`：songName/label 等必填；note 类 body≤10000，纪念日 advanceDays≤30。

BackupV1 为 `{format:'lira-fan-profiles',version:1,scope,exportedAt,profiles,settings,suppressions}`，每个 profiles 项内嵌自己的 records/reminders；只恢复相同 scope，profiles≤10000，ID和 typed identity 不重复，记录必须保留 original/revisions 与合法时间。guardRoster 若存在需合法 roomId/ownerUid、level 和 observedAt。预览 digest/currentDigest 同时绑定输入与当前状态；修改备份或当前数据后必须重新预览。详情见 [profile-transfer.js](../../../src/fans/profile-transfer.js) 与 [profile-merge.js](../../../src/fans/profile-merge.js)，功能验收见 [fan-profiles.md](../../../specs/fan-profiles.md)。

## 6. 礼物导出任务与取消

Owner：[gift-export-controller.js](../../../src/electron/gift-export-controller.js)、[gift-export-runtime.js](../../../src/server/gift-export-runtime.js)、[query-service.js](../../../src/bilibili/gift/query-service.js) 的 getGiftSelection。

- settings 不传参数读取默认值；写入只含可选 mode=combined/separate、background=transparent/white、directoryAction=choose/default，拒绝未知字段与非法值。renderer 不传保存路径，目录由原生对话框或系统图片目录产生。取消目录选择不写入；导航/任务代次变化/销毁后忽略迟到选择。
- prepare 的 selection 必须带当前 viewRevision；可带 eventIds（1–10000个非空字符串，各≤64）或历史筛选/排序条件，规则见 [礼物 HTTP 契约](../backend/api.md)。查回数量必须匹配去重 ID 数；筛选结果最多10000条且不能为空。冻结当前来源、流水、展示设置、目录和礼物卡片；后续默认设置只影响新任务。
- ExportTask 为 `{id,snapshot,root,directory,mode,background,files:[{start,count,fileName}],custom}`。snapshot 含 viewRevision/asOf/items、同步元数据、selectedCount/cardsPartial、config/catalog；卡片转换可改变 items 的组织，selectedCount 保留原选中记录数。
- configure 要求当前 id、合法 mode/background；directoryAction 可省略，remember===true 只记忆目录。条目数1–10000；combined 每图最多39行，separate 每图1行。运行中不可改配置或再次 prepare；完成的任务不可重复 save。失败后 configure 生成新目录并重置保存计数。
- save 使用独占任务目录/文件，逐张 render/capture/write，渲染步骤有20秒期限；viewRevision 变化立即使任务失效。进度 `{id,saved,total}` 表示已完成文件，不表示所有文件必然成功。取消或部分失败保留已写文件，返回 saved/directory；不承诺取消能撤回正在完成的文件写入。
- 主窗口非原地导航或 destroyed 调用 cancel；dispose 也取消并销毁隐藏渲染窗口。取消不匹配的旧 id 不影响新任务；preparationGeneration 防止旧 prepare 覆盖新任务。renderer 按 id 过滤迟到 progress，关闭预览解除订阅。openFolder 只允许已保存至少一张的任务，不能传任意路径。

验收入口：[legacy-ipc-source.test.js](../../../test/desktop/legacy-ipc-source.test.js)、[fan-profiles-ipc.test.js](../../../test/fan-profiles/fan-profiles-ipc.test.js)、[daily-bot-controller.test.js](../../../test/bots/daily-bot-controller.test.js)、[gift-export-controller.test.js](../../../test/gifts/gift-export-controller.test.js)。这些是聚焦证据入口，不代表本文执行过所有 Electron 实机流程。
