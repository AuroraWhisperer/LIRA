# 自动更新运行时

> 涉及文件：[src/electron/update-manager.js](../../../src/electron/update-manager.js)、[src/electron/desktop-update-controller.js](../../../src/electron/desktop-update-controller.js)（状态推送与启动检查）、[src/electron/ipc/desktop-shell-ipc.js](../../../src/electron/ipc/desktop-shell-ipc.js)（IPC）、[src/electron/main.js](../../../src/electron/main.js)（接线）、[src/electron/preload.js](../../../src/electron/preload.js)（预加载桥）

本文档是自动更新运行时的**单一事实来源**，集中维护状态机、运行时配置、事件监听、状态载荷和错误映射。`electron-builder` / publish 配置与发布流程见 [../engineering/build.md](../engineering/build.md)，IPC 通道表见 [preload.md](preload.md) §2。

界面入口为「百宝箱 → 设置 → 系统与关于」，更新通知也定位到此页签。[desktop-update.html](../../../public/pages/admin/toolbox/desktop-update.html) 由设置片段嵌入一次；[desktop.js](../../../public/js/desktop.js) 负责更新界面的渲染，并接入 [desktop-resource-integrity.js](../../../public/js/desktop-resource-integrity.js) 的资源检查界面。数据目录、日志与资源检查位于「本地数据与诊断」分区。

## 1. 职责边界

| 侧 | 事实 | 出处 |
| --- | --- | --- |
| 运行时 | `electron-updater` 6.x 的 `autoUpdater`；延迟加载（`getAutoUpdater` 首次调用才 `require`，避免 `ready` 前初始化） | [update-manager.js](../../../src/electron/update-manager.js) |
| 版本来源 | CDN `https://assets.lirahub.cn/downloads/latest.yml` | [../engineering/build.md](../engineering/build.md) |
| 开关 | 设置 `enableAutoUpdate === 'true'`（设置存储见 [../backend/storage.md](../backend/storage.md) §7） | [desktop-update-controller.js](../../../src/electron/desktop-update-controller.js) 的 `readAutoUpdateSetting` |
| 触发 | 主窗口 `ready-to-show` 后，仅**打包版且开关开启**时安排 **1s** 定时器，到时更新状态仍为 `idle` 才发起首查 | [desktop-update-controller.js](../../../src/electron/desktop-update-controller.js) 的 `scheduleStartupCheck`，由主进程注入窗口 `onReady` |

控制器通过主进程注入的 `getAutoUpdateSetting` 读取开关；若已有待执行的启动检查定时器，则不重复调度；调用 `dispose()` 会取消定时器并禁止再次安排。如果用户在定时器触发前已手动完成下载，更新器保留 `downloaded` 状态和安装入口。更新状态由 `update-manager` 唯一持有，控制器通过 `getUpdateState()` 读取并推送快照，外部错误通过 `reportUpdateError()` 进入同一状态更新路径。控制器仅持有启动检查定时器与安装前排空钩子，渲染进程只接收快照。

## 2. 状态机

状态对象 `updateState = {status, message, version, canDownload, canInstall, progress, updateVersion}`（初值 `idle` / `尚未检查更新`，见 [update-manager.js](../../../src/electron/update-manager.js)）。`status` 枚举与状态流转：

```text
idle ──checkForUpdates──▶ checking ──▶ available ──▶ downloading ──▶ downloaded ──▶ installing
                           │             │               │
                           └─────────────┴───────────────┴──▶ error（任意阶段失败）
checking ──无新版本──▶ not-available
!app.isPackaged ──▶ dev-disabled（开发模式直入，不联网）
```

| `status` | 含义 | `canDownload` / `canInstall` | 进入方式 | 出处 |
| --- | --- | --- | --- | --- |
| `idle` | 初始 | `false` / `false` | 启动 | [update-manager.js](../../../src/electron/update-manager.js) |
| `checking` | 检查中 | `false` / `false` | `autoUpdater` 的 `checking-for-update` 事件 | [update-manager.js](../../../src/electron/update-manager.js) |
| `available` | 发现新版本 | **`true`** / `false` | `update-available` 事件 | [update-manager.js](../../../src/electron/update-manager.js) |
| `not-available` | 已是最新 | `false` / `false` | `update-not-available` 事件 | [update-manager.js](../../../src/electron/update-manager.js) |
| `downloading` | 下载中 | `false` / `false` | `download-progress` 事件 / `downloadUpdate()` | [update-manager.js](../../../src/electron/update-manager.js) |
| `downloaded` | 下载完成 | `false` / **`true`** | `update-downloaded` 事件 | [update-manager.js](../../../src/electron/update-manager.js) |
| `installing` | 安装中（重启） | `false` / `false` | `installUpdate()` | [update-manager.js](../../../src/electron/update-manager.js) |
| `error` | 失败 | 更新包消失时 `true` / `false`，启动安装程序失败时 `false` / `true`，其他错误 `false` / `false` | 更新或安装失败 | [update-manager.js](../../../src/electron/update-manager.js) |
| `dev-disabled` | 开发模式禁用 | `false` / `false` | `checkForUpdates()` 且未打包 / 启动即置位 | [update-manager.js](../../../src/electron/update-manager.js) |

> 状态名以代码为准：`available` / `not-available`（旧文档曾写作 `update-available` / `no-update`，已纠正）；`progress` 仅在 `downloading` / `downloaded` 时非空。

## 3. 运行时配置与事件

Windows 端复用 `electron-updater.autoUpdater` 及 Electron HTTP 下载器，仅在首次初始化下载组件前将应用适配器的 `baseCachePath` 设为 `<安装目录>/updates`（实际缓存目录为 `<安装目录>/updates/lira-updater/`）。安装成功后也会将当前安装包保留在此处，并清理 builder 在系统用户缓存中暂存的副本。构建时由 `package.json` 的首个 generic provider（`https://assets.lirahub.cn/downloads/`）生成 `resources/app-update.yml`，安装包由同目录 `latest.yml` 指定（正常构建为 `lira-setup-{version}.exe`）。运行时由 `electron-updater` 直接读取该文件，不再读取打包后已剔除的 `package.json` `build` 字段，也不再调用 `setFeedURL` 覆盖配置。

缓存根目录通过 `desktop-user-data.js` 按实际可执行文件位置解析，开发版按仓库根目录解析；不依赖迁移后的 Chromium `userData`，因此浏览器目录调整不会把更新文件写进 `data`。

`configureAutoUpdater({onStateChange, writeLog, updater})`（[update-manager.js](../../../src/electron/update-manager.js)）：

先安装状态通知与日志回调，再惰性初始化 updater 并绑定事件。生产启动在安排检查和创建正常管理页面前完成此配置；`reportUpdateError` 委托同一状态 owner，不在桌面控制器另建状态副本。

| 配置 | 值 | 说明 |
| --- | --- | --- |
| `autoDownload` | `true` | 检查到新版本后自动开始下载 |
| `autoInstallOnAppQuit` | `true` | 退出应用时自动完成安装 |
| `allowPrerelease` | `false` | 只接受正式版 |
| `disableDifferentialDownload` | `false` | 优先增量下载，失败自动回退整包 |

generic provider 配置 `useMultipleRangeRequest: false`，逐段请求变化的数据，不要求 CDN 支持 multipart ranges。增量下载使用本地 `updates/lira-updater/installer.exe`、已缓存或远端旧块映射，以及新版 `.exe.blockmap`；缺少旧包、块映射不可用或分段请求失败时，由 `electron-updater` 自动回退整包并继续校验 SHA-512。有效的待安装包可直接复用，校验失败则不能进入可安装状态。增量下载仅减少网络传输，程序替换仍由原 NSIS 安装器完成（数据原地保留条件见 [构建参考](../engineering/build.md#6-nsis-安装脚本buildinstallernsh)）；普通嵌入式安装仅将安装包复制到安装盘的缓存。手动重装时，若缓存中已有 `current.blockmap`，安装器用 SHA-256 比较新旧安装包。摘要相同则保留原包和块映射，摘要不同或无法核实时先删除旧块映射，再替换缓存的安装包。若旧块映射无法删除（例如文件被占用），安装器保留缓存中的旧安装包和块映射，继续安装。应用内更新保留对应映射。CDN 上传与旧块映射保留规则见 [分发指南](../../guides/cdn-resources.md#客户端安装包与自动更新)。

订阅的 `electron-updater` 事件对应状态流转：`checking-for-update` / `update-available` / `update-not-available` / `download-progress` / `update-downloaded` / `error`（错误映射见 §5）。`download-progress` 中计算下载速度 `speed = bytesDiff / timeDiff`（首帧为 0），`percent` 钳制在 `0–100`（[update-manager.js](../../../src/electron/update-manager.js)）。

## 客户端资源检查

音频组件由独立的 [音频组件准备模块](main.md#电音助手生命周期) 校验和补齐，在同页下载任务中显示准备进度，并为可重试的失败提供「重试」；下面的安装资源诊断不会触发音频重下。

版本更新页「本地数据与诊断」提供手动只读诊断，独立于更新状态机和授权构建指纹。`resource-integrity-manager.js` 负责维护内存状态、单任务互斥和取消控制；`desktop-resource-integrity.js` 负责原始文件系统读取与状态推送接线，主进程在退出、重启和安装更新前会先停止并等待检查结束。下载安装包和普通更新检查不会中断资源检查。

该诊断只支持打包后的 Windows x64 客户端，固定读取 `resources/client-integrity-manifest.json`，核对 `appVersion` / `platform` / `arch`、`schemaVersion=1`、`scope=packaged-app-resources`、SHA-256 及安全路径；范围仅限 `app.asar` 和清单中的 `app.asar.unpacked/` 普通文件。清单最多 4 MiB / 10000 项，拒绝符号链接、目录穿越、Windows 路径别名和大小写重复。清单无效时不重建基准、不联网回退；额外资源和用户数据不纳入扫描。

检查使用 `original-fs` 按 256 KiB 块顺序读取，比较文件大小、摘要及读取前后的句柄/路径身份。单次检查超时 120 秒，文件计数进度最多每 250ms 推送一次，开始与结束时立即通知。页面最多展示 20 条详情，日志最多记录 200 条，只含资源相对路径和归一化原因，不包含原始异常或文件内容。

快照字段：`revision`、`status`、`appVersion`、`scope`、`startedAt`、`finishedAt`、`totalFiles`（未知为 `null`）、`checkedFiles`、`complete`、`issueCount`、`unresolvedCount`、`details[{path,reasonCode}]`、`reasonCode`。状态为 `idle` / `checking` / `passed` / `issues` / `inconclusive` / `unavailable` / `cancelled`。确定缺失或不一致优先判为 `issues`；存在读取失败、文件变化或超时时 `complete=false`，并保留已确认异常。取消后不会被迟到回调覆盖，新一轮检查会重新读取全部资源。

检查通过仅表示「本次检查范围内的资源与校验清单一致」，不构成完整运行环境或防篡改证明。发现异常时建议备份后手动重装；日志目录与官方项目页面沿用既有受控入口，不自动更新、删除或修复。清单生成及最终安装器发布门禁见 [build.md](../engineering/build.md)。配套测试包括 `resource-integrity-files`、`resource-integrity-manager`、`desktop-resource-integrity`、`desktop-update-controller`、真实 `resource-integrity-electron`，以及更新页、IPC 和退出回归。

## 4. IPC 与 UI 同步

通道、桥方法和方向在 [preload.md](preload.md#21-songassistantdesktop) 维护；处理器由 [desktop-shell-ipc.js](../../../src/electron/ipc/desktop-shell-ipc.js) 注册，状态推送与错误处理由 [desktop-update-controller.js](../../../src/electron/desktop-update-controller.js) 的 `sendUpdateState` / `setUpdateError` 负责。

状态载荷沿用 §2 的对象，`version` 为当前应用版本，`progress` 随状态取值：

- `progress = {percent, transferred, total, speed}`（`downloading`，速度单位为字节/秒；手动开始或重试下载时先清为 `null`，等待新进度事件）
- `progress = {percent: 100}`（`downloaded`）
- `progress = null`（其余状态）

数据结构出处：[update-manager.js](../../../src/electron/update-manager.js)；前端渲染由 [desktop.js](../../../public/js/desktop.js) 的更新状态订阅负责。

更新状态只通过 `desktop:update-state` 推送，不再要求用户切换页面；发现新版本与下载完成仍显示可点击前往更新页的通知。界面「启动时自动检查更新」对应设置 `enableAutoUpdate`，只控制启动检查；手动「检查并下载更新」同样沿用自动下载。`available` 阶段直接显示准备下载，避免让用户误以为需要手动点击才开始下载；下载完成后提示退出安装，授权页遇到 `BUILD_NOT_ALLOWED` 时显示固定的官网安装包链接，由系统浏览器打开。应用内使用指南也提供 `https://lirahub.cn/download/client` 官方下载入口（由服务器按同一清单跳转），资源检查保留官方项目页面入口。

每次切换「启动时自动检查更新」都会立即发出带 `keepalive` 的本机保存请求，离开或关闭页面后仍可完成。同页连续切换时，全部请求结束后，勾选状态和文字采用成功写入中编辑序号最大的值。若本轮保存全部失败，则恢复到本轮首次点击前的值。写序头 `X-Lira-Update-Edit` 的格式见[设置域](../backend/api.md#2-设置域settings)。

Windows 上，`installUpdate()` 使用 `electron-updater` 下载并校验通过的待安装文件。显式安装前先排空正在运行的资源检查，再确认安装包仍是普通文件；文件消失时保留单实例锁并显示「重新下载」。安装器启动失败时可重试安装，资源检查也可再次发起。

安装启动命令沿用 `--updated /S --force-run`。更新管理器会等待系统确认已创建安装进程，遇到 `EACCES` / `UNKNOWN` 时走随包的提权助手；并发安装请求共用一次启动。启动成功后才释放单实例锁，发出 `before-quit-for-update` 并调用 `app.quit()` 进入受控关闭，退出时只启动一次安装程序；下一次下载完成后重新启用普通退出自动安装。普通退出自动安装会显示进度，完成后保持应用关闭（安装向导行为见 [构建参考](../engineering/build.md#6-nsis-安装脚本buildinstallernsh)）。

普通重启在排空结束后检查待安装更新：若更新安装启动成功则交由安装器重启；若安装包已消失或启动失败，则通过 `app.relaunch()` 重新打开当前版本。关闭排空与播放状态冲刷顺序见 [主进程关闭序列](main.md#7-关闭序列与播放状态冲刷)。

## 5. `friendlyUpdateError` 映射

`friendlyUpdateError(error)`（[update-manager.js](../../../src/electron/update-manager.js)）按错误文本正则归类：

| 匹配 | `status` | 用户文案 |
| --- | --- | --- |
| `404` + `latest.yml` / `ERR_UPDATER_CHANNEL_FILE_NOT_FOUND` | `error` | 找不到更新清单（HTTP 404），请稍后重新检查更新。 |
| 其他 `404` | `error` | 找不到更新包，请稍后重试。如需联系管理员，请提供错误码 HTTP 404。 |
| `checksum mismatch` / `sha512` / `sha256` / `hash mismatch` | `error` | 更新包校验失败，请重新检查并下载更新。 |
| `ENOTFOUND` / `ECONNRESET` / `ETIMEDOUT` / `EAI_AGAIN` / `ERR_CONNECTION` / `ERR_NETWORK` / `ERR_INTERNET` / `network` / `timeout` | `error` | 暂时无法连接更新服务，请稍后再试。 |
| 其他 | `error` | 更新失败，详细原因已写入错误日志。 |

调用点：[update-manager.js](../../../src/electron/update-manager.js) 的 `handleUpdateError` 统一处理 `autoUpdater` 的 `error` 事件与 `checkForUpdates` / `downloadUpdate` 的 `catch`；[桌面控制器](../../../src/electron/desktop-update-controller.js)的 `setUpdateError` 同样调用该映射并推送状态。

更新器的 `error` 事件与操作 Promise 拒绝统一记录错误并推送状态；同一次操作中同一错误对象只记录一次、推送一次错误状态，重新检查或下载时重新计数。`checkForUpdates()` 在检查完更新清单后立即返回，不会阻塞等待下载完成；后台自动下载的 `downloadPromise` 会立刻绑定同一套错误处理逻辑，防止出现未捕获的 Promise 异常。即使仅 Promise 失败而未触发 `error` 事件，同样会记录错误日志。错误详情经桌面日志模块写入 `logs/errors/desktop.log`，保留原始错误与堆栈；页面提示该相对位置，「日志目录」按钮打开 `logs/`。失败和安装状态会清空旧下载进度。定向测试见 [update-manager.test.js](../../../test/desktop/update-manager.test.js) 与 [desktop-update-controller.test.js](../../../test/desktop/desktop-update-controller.test.js)。

## 6. 完整性验证与代码签名

- **SHA-512 哈希验证**（已实现）：`electron-updater` 在下载完成后，根据 `latest.yml` 中记录的 `sha512` 字段验证安装包完整性。校验失败映射到 `checksum mismatch` 错误（见 §5），阻止损坏或被篡改的更新包安装。
- **Windows 代码签名**：签名与独立验证脚本已实现，构建/发布接入和真实证书验收尚待完成。脚本契约、当前限制与待办入口见 [代码签名参考](../engineering/code-signing.md)。安装包摘要验证不能替代发布者身份证明。
