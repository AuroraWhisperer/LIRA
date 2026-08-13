# 自动更新运行时

> 涉及文件:[src/electron/update-manager.js](../../../src/electron/update-manager.js)、[src/electron/main.js](../../../src/electron/main.js)(IPC 与启动触发)、[src/electron/preload.js](../../../src/electron/preload.js)(桥)

本文档是自动更新运行时的**唯一事实源**:状态机、运行时配置、事件、状态载荷、错误映射只在此成文。electron-builder / publish 配置与发布流程见 [../engineering/build.md](../engineering/build.md)(本文件不重复配置块);IPC 通道表见 [preload.md](preload.md) §2。

## 1. 职责边界

| 侧 | 事实 | 出处 |
|---|---|---|
| 运行时 | `electron-updater` 6.x 的 `autoUpdater`;延迟加载(`getAutoUpdater` 首次调用才 require,避免 ready 前初始化) | [update-manager.js:10-15](../../../src/electron/update-manager.js#L10-L15) |
| 版本来源 | GitHub `AuroraWhisperer/Request-song` Releases 的 `latest.yml` | [../engineering/build.md](../engineering/build.md) |
| 开关 | 设置 `enableAutoUpdate === 'true'`(设置存储见 [../backend/storage.md](../backend/storage.md) §7) | [main.js:677-685](../../../src/electron/main.js#L677-L685) |
| 触发 | 主窗口 `ready-to-show` 后,仅**打包版且开关开启**时延迟 **1s** 首查 | [main.js:339-343](../../../src/electron/main.js#L339-L343) |

## 2. 状态机

状态对象 `updateState = {status, message, version, canDownload, canInstall, progress, updateVersion}`(初值 `idle`/`尚未检查更新`,见 [update-manager.js:17-25](../../../src/electron/update-manager.js#L17-L25))。**status 枚举与迁移**(唯一成表处):

```
idle ──checkForUpdates──▶ checking ──▶ available ──▶ downloading ──▶ downloaded ──▶ installing
                           │             │               │
                           └─────────────┴───────────────┴──▶ error(任意阶段失败)
checking ──无新版本──▶ not-available
!app.isPackaged ──▶ dev-disabled(开发模式直入,不联网)
```

| status | 含义 | canDownload / canInstall | 进入方式 | 出处 |
|---|---|---|---|---|
| `idle` | 初始 | false / false | 启动 | [update-manager.js:17-25](../../../src/electron/update-manager.js#L17-L25) |
| `checking` | 检查中 | false / false | autoUpdater `checking-for-update` 事件 | [update-manager.js:41-47](../../../src/electron/update-manager.js#L41-L47) |
| `available` | 发现新版本 | **true** / false | `update-available` 事件 | [update-manager.js:49-55](../../../src/electron/update-manager.js#L49-L55) |
| `not-available` | 已是最新 | false / false | `update-not-available` 事件 / 404 兜底映射(§5) | [update-manager.js:57-63](../../../src/electron/update-manager.js#L57-L63) |
| `downloading` | 下载中 | false / false | `download-progress` 事件 / `downloadUpdate()` | [update-manager.js:65-86](../../../src/electron/update-manager.js#L65-L86) |
| `downloaded` | 下载完成 | false / **true** | `update-downloaded` 事件 | [update-manager.js:88-96](../../../src/electron/update-manager.js#L88-L96) |
| `installing` | 安装中(重启) | false / false | `installUpdate()` | [update-manager.js:150-159](../../../src/electron/update-manager.js#L150-L159) |
| `error` | 失败 | false / false | autoUpdater `error` 事件 / 各函数 catch | [update-manager.js:98-105](../../../src/electron/update-manager.js#L98-L105) |
| `dev-disabled` | 开发模式禁用 | false / false | `checkForUpdates()` 且未打包 / 启动即置位 | [update-manager.js:116-122](../../../src/electron/update-manager.js#L116-L122) |

> 状态名以代码为准:`available` / `not-available`(旧文档写的 `update-available` / `no-update` 已纠正);`progress` 仅在 downloading / downloaded 非空。

## 3. 运行时配置与事件

`configureAutoUpdater({onStateChange, writeLog, updater})`([update-manager.js:31-106](../../../src/electron/update-manager.js#L31-L106)):

| 配置 | 值 | 说明 |
|---|---|---|
| `autoDownload` | true | 检查到新版本后自动开始下载 |
| `autoInstallOnAppQuit` | true | 退出应用时自动完成安装 |
| `allowPrerelease` | false | 只接受正式版 |
| `disableDifferentialDownload` | true | 禁用增量下载,整包下载 |

订阅的 electron-updater 事件 → 状态迁移:checking-for-update / update-available / update-not-available / download-progress / update-downloaded / error(错误映射见 §5)。`download-progress` 中计算下载速度 `speed = bytesDiff / timeDiff`(首帧为 0),percent 钳制 0-100([update-manager.js:65-86](../../../src/electron/update-manager.js#L65-L86))。

## 4. IPC 与 UI 同步

| 通道 | 方向 | 说明 | 出处 |
|---|---|---|---|
| `desktop:check-for-updates` | 渲染→主 | 手动检查 | [main.js:388-391](../../../src/electron/main.js#L388-L391) |
| `desktop:download-update` | 渲染→主 | 手动下载(`autoDownload=true` 下通常已自动开始) | [main.js:392-395](../../../src/electron/main.js#L392-L395) |
| `desktop:install-update` | 渲染→主 | 安装并重启 | [main.js:396-399](../../../src/electron/main.js#L396-L399) |
| `desktop:set-auto-update` | 渲染→主 | **仅记日志**(持久化走 `/api/settings`) | [main.js:403-406](../../../src/electron/main.js#L403-L406) |
| `desktop:update-state` | 主→渲染 | 状态推送(`onUpdateStateChange` → `sendUpdateState`) | [main.js:695-710](../../../src/electron/main.js#L695-L710) |

`desktop:update-state` 载荷:`{status, message, version(当前应用版本), canDownload, canInstall, progress, updateVersion}`,其中:

- `progress = {percent, transferred, total, speed}`(downloading,速度字节/秒)
- `progress = {percent: 100}`(downloaded)
- `progress = null`(其余状态)

形状出处 [update-manager.js:81-95](../../../src/electron/update-manager.js#L81-L95)。前端消费:管理页 `js/desktop.js` 的 `onUpdateState`(调用方见 [preload.md](preload.md) §4)。

`installUpdate()`([update-manager.js:150-159](../../../src/electron/update-manager.js#L150-L159)):仅 `canInstall` 放行;置 `installing` → `app.releaseSingleInstanceLock()`(允许新实例启动)→ `autoUpdater.quitAndInstall(true, true)`(静默安装 + 装后启动)。

## 5. friendlyUpdateError 映射

`friendlyUpdateError(error)`([update-manager.js:161-173](../../../src/electron/update-manager.js#L161-L173))按错误文本正则归类(唯一成表处):

| 匹配 | status | 用户文案 |
|---|---|---|
| `404` + `releases.atom` / `latest.yml` / `github` | `not-available` | 当前 GitHub Releases 里还没有可用更新包。 |
| `checksum mismatch` / `sha512` / `sha256` / `hash mismatch` | `error` | 更新包校验失败,请前往 GitHub Releases 手动下载最新安装包。 |
| `ENOTFOUND` / `ECONNRESET` / `ETIMEDOUT` / `EAI_AGAIN` / `ERR_CONNECTION` / `ERR_NETWORK` / `ERR_INTERNET` / `network` / `timeout` | `error` | 暂时无法连接 GitHub 更新服务,请稍后再试。 |
| 其他 | `error` | 暂时无法检查更新,详细原因已写入日志。 |

消费点:autoUpdater `error` 事件与 `checkForUpdates`/`downloadUpdate` 的 catch 均走该映射([update-manager.js:98-105](../../../src/electron/update-manager.js#L98-L105)、[115-148](../../../src/electron/update-manager.js#L115-L148));main.js `setUpdateError` 同样调用并下推状态([main.js:712-721](../../../src/electron/main.js#L712-L721))。
