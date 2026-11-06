# 自动更新运行时

> 涉及文件:[src/electron/update-manager.js](../../../src/electron/update-manager.js)、[src/electron/desktop-update-controller.js](../../../src/electron/desktop-update-controller.js)(状态投递与启动检查)、[src/electron/ipc/desktop-shell-ipc.js](../../../src/electron/ipc/desktop-shell-ipc.js)(IPC)、[src/electron/main.js](../../../src/electron/main.js)(接线)、[src/electron/preload.js](../../../src/electron/preload.js)(桥)

本文档是自动更新运行时的**唯一事实源**:状态机、运行时配置、事件、状态载荷、错误映射只在此成文。electron-builder / publish 配置与发布流程见 [../engineering/build.md](../engineering/build.md)(本文件不重复配置块);IPC 通道表见 [preload.md](preload.md) §2。

界面入口为「百宝箱 → 设置 → 关于与更新」，更新通知也定位到此页签。[desktop-update.html](../../../public/pages/admin/toolbox/desktop-update.html) 由设置片段嵌入一次；[desktop.js](../../../public/js/desktop.js) 拥有更新渲染并装配 [desktop-resource-integrity.js](../../../public/js/desktop-resource-integrity.js) 的资源检查 UI。数据目录、日志与资源检查位于「本地数据与支持」分区。更新状态机、自动检查开关和安装流程不变。

## 1. 职责边界

| 侧       | 事实                                                                                                      | 出处                                                                       |
| -------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 运行时   | `electron-updater` 6.x 的 `autoUpdater`;延迟加载(`getAutoUpdater` 首次调用才 require,避免 ready 前初始化) | [update-manager.js](../../../src/electron/update-manager.js) |
| 版本来源 | CDN `https://assets.lirahub.cn/downloads/latest.yml`                                                    | [../engineering/build.md](../engineering/build.md)                         |
| 开关     | 设置 `enableAutoUpdate === 'true'`(设置存储见 [../backend/storage.md](../backend/storage.md) §7)          | [desktop-update-controller.js](../../../src/electron/desktop-update-controller.js) 的 `readAutoUpdateSetting` |
| 触发     | 主窗口 `ready-to-show` 后,仅**打包版且开关开启**时延迟 **1s** 首查                                        | [desktop-update-controller.js](../../../src/electron/desktop-update-controller.js) 的 `scheduleStartupCheck`，由 main 注入窗口 `onReady` |

控制器通过 main 注入的 `getAutoUpdateSetting` 读取开关；启动检查已有待执行 timer 时不重复排队，`dispose()` 取消该 timer 并禁止再次安排。用于 UI 投递的状态快照及 timer 留在控制器内部，renderer 只接收快照。

## 2. 状态机

状态对象 `updateState = {status, message, version, canDownload, canInstall, progress, updateVersion}`(初值 `idle`/`尚未检查更新`,见 [update-manager.js](../../../src/electron/update-manager.js))。**status 枚举与迁移**(唯一成表处):

```
idle ──checkForUpdates──▶ checking ──▶ available ──▶ downloading ──▶ downloaded ──▶ installing
                           │             │               │
                           └─────────────┴───────────────┴──▶ error(任意阶段失败)
checking ──无新版本──▶ not-available
!app.isPackaged ──▶ dev-disabled(开发模式直入,不联网)
```

| status          | 含义         | canDownload / canInstall | 进入方式                                       | 出处                                                                           |
| --------------- | ------------ | ------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `idle`          | 初始         | false / false            | 启动                                           | [update-manager.js](../../../src/electron/update-manager.js)     |
| `checking`      | 检查中       | false / false            | autoUpdater `checking-for-update` 事件         | [update-manager.js](../../../src/electron/update-manager.js)     |
| `available`     | 发现新版本   | **true** / false         | `update-available` 事件                        | [update-manager.js](../../../src/electron/update-manager.js)     |
| `not-available` | 已是最新     | false / false            | `update-not-available` 事件 | [update-manager.js](../../../src/electron/update-manager.js)     |
| `downloading`   | 下载中       | false / false            | `download-progress` 事件 / `downloadUpdate()`  | [update-manager.js](../../../src/electron/update-manager.js)     |
| `downloaded`    | 下载完成     | false / **true**         | `update-downloaded` 事件                       | [update-manager.js](../../../src/electron/update-manager.js)     |
| `installing`    | 安装中(重启) | false / false            | `installUpdate()`                              | [update-manager.js](../../../src/electron/update-manager.js) |
| `error`         | 失败         | false / false            | autoUpdater `error` 事件 / 各函数 catch        | [update-manager.js](../../../src/electron/update-manager.js)   |
| `dev-disabled`  | 开发模式禁用 | false / false            | `checkForUpdates()` 且未打包 / 启动即置位      | [update-manager.js](../../../src/electron/update-manager.js) |

> 状态名以代码为准:`available` / `not-available`(旧文档写的 `update-available` / `no-update` 已纠正);`progress` 仅在 downloading / downloaded 非空。

## 3. 运行时配置与事件

Windows 更新器沿用 `electron-updater.autoUpdater` 及其 Electron HTTP executor，只在首次创建下载 helper 前将应用适配器的 `baseCachePath` 改为 `<安装目录>/updates`；实际缓存为其下的 `lira-updater/`。安装器成功后也将当前安装包留在此处，并移除 builder 在系统用户缓存中暂存的当前安装包。构建时由 package.json 的首个 generic provider（`https://assets.lirahub.cn/downloads/`）生成 `resources/app-update.yml`，安装包由同目录 `latest.yml` 指定，正常构建为 `lira-setup-{version}.exe`。运行时由 electron-updater 读取该文件，不读取打包后已剥离的 package.json `build` 字段，也不再调用 `setFeedURL` 覆盖；应用标识、摘要校验和自动下载/退出安装策略保持原有契约。

缓存根通过 `desktop-user-data.js` 按实际可执行文件位置解析，开发版按仓库根解析；不依赖迁移后的 Chromium `userData`，因此浏览器目录调整不会把更新文件写进 `data`。

`configureAutoUpdater({onStateChange, writeLog, updater})`([update-manager.js](../../../src/electron/update-manager.js)):

| 配置                          | 值    | 说明                       |
| ----------------------------- | ----- | -------------------------- |
| `autoDownload`                | true  | 检查到新版本后自动开始下载 |
| `autoInstallOnAppQuit`        | true  | 退出应用时自动完成安装     |
| `allowPrerelease`             | false | 只接受正式版               |
| `disableDifferentialDownload` | false | 优先增量下载，失败自动回退整包 |

generic provider 配置 `useMultipleRangeRequest: false`，逐段请求变化的数据，不要求 CDN 支持 multipart ranges。增量使用本地 `updates/lira-updater/installer.exe`、已缓存或远端旧块映射，以及新版 `.exe.blockmap`；缺少旧包、块映射不可用或分段失败时，由 electron-updater 回退整包并继续校验 SHA-512。有效的待安装包可直接复用；校验失败不能进入可安装状态。增量减少网络传输，程序仍由原 NSIS 安装器替换，数据原地保留条件见 [构建参考](../engineering/build.md#6-nsis-安装脚本buildinstallernsh)。CDN 上传与旧块映射保留规则见 [分发指南](../../guides/cdn-resources.md#客户端安装包与自动更新)。

订阅的 electron-updater 事件 → 状态迁移:checking-for-update / update-available / update-not-available / download-progress / update-downloaded / error(错误映射见 §5)。`download-progress` 中计算下载速度 `speed = bytesDiff / timeDiff`(首帧为 0),percent 钳制 0-100([update-manager.js](../../../src/electron/update-manager.js))。

## 客户端资源检查

音频组件由独立的 [组件准备 owner](main.md#电音助手生命周期) 校验和补齐，在同页下载任务中显示进度及重试；下面的安装资源诊断不会触发音频重下。

版本更新页「本地数据与支持」提供手动只读诊断，独立于更新状态机和授权构建指纹。`resource-integrity-manager.js` 拥有内存状态、单任务和取消；`desktop-resource-integrity.js` 负责原始文件系统及状态投递组合，主进程在退出/重启和安装更新前停止并等待检查。下载安装包和普通更新检查不停止资源检查。

只支持打包 Windows x64。固定读取 `resources/client-integrity-manifest.json`，核对 appVersion/platform/arch、schemaVersion=1、scope=packaged-app-resources、SHA-256 及安全路径；范围仅 `app.asar` 和清单中的 `app.asar.unpacked/` 普通文件。清单最多 4 MiB/10000 项，拒绝链接、目录穿越、Windows 路径别名和大小写重复。清单无效不重建基准、不联网回退；额外资源和用户数据不扫描。

`original-fs` 以 256 KiB 块顺序读取，比较文件大小、摘要及读取前后的句柄/路径身份。检查时限 120 秒，文件计数进度最多每 250 ms 推送一次，开始/结束立即通知。页面最多 20 条详情，日志最多 200 条，只含资源相对路径和归一化原因，无原始异常和文件内容。

快照字段：`revision`、`status`、`appVersion`、`scope`、`startedAt`、`finishedAt`、`totalFiles`（未知为 null）、`checkedFiles`、`complete`、`issueCount`、`unresolvedCount`、`details[{path,reasonCode}]`、`reasonCode`。状态为 idle/checking/passed/issues/inconclusive/unavailable/cancelled。确定缺失或不一致优先为 issues；存在读取失败/变化/超时则 complete=false，保留已确认异常。取消后不会被晚到回调覆盖，新一轮重新读取全部资源。

通过仅表示「本次检查范围内的资源与校验清单一致」，不是完整运行环境或防篡改认证。异常时建议备份后手动重装；日志与官方项目页面沿用已有受控入口，不自动更新、删除或修复。清单及最终安装器发布门禁见 [build.md](../engineering/build.md)。测试：`resource-integrity-files`、`resource-integrity-manager`、`desktop-resource-integrity`、`desktop-update-controller`、真实 `resource-integrity-electron`，以及既有更新页、IPC、退出回归。

## 4. IPC 与 UI 同步

通道、桥方法和方向只在 [preload.md](preload.md#21-songassistantdesktop) 维护；handler 由 [desktop-shell-ipc.js](../../../src/electron/ipc/desktop-shell-ipc.js) 注册。状态推送与错误处理由 [desktop-update-controller.js](../../../src/electron/desktop-update-controller.js) 的 `sendUpdateState` / `setUpdateError` 持有。

状态载荷沿用 §2 的对象，`version` 是当前应用版本，`progress` 随状态取值：

- `progress = {percent, transferred, total, speed}`(downloading,速度字节/秒；手动开始或重试下载时先清为 null，等待新进度事件)
- `progress = {percent: 100}`(downloaded)
- `progress = null`(其余状态)

形状出处 [update-manager.js](../../../src/electron/update-manager.js)。前端消费由 [desktop.js](../../../public/js/desktop.js) 的更新状态订阅负责。

更新状态只通过 `desktop:update-state` 投递，不再要求用户切换页面；发现新版本与下载完成仍显示可点击前往更新页的通知。界面「启动时自动检查更新」对应已有 `enableAutoUpdate`，只控制启动检查；手动「检查并下载更新」同样沿用自动下载。`available` 阶段显示准备下载，不展示需要用户点击才下载的假象；下载完成提示退出安装，应用内使用指南提供 `https://lirahub.cn/download/client` 官方下载入口，由服务器按同一清单跳转，资源检查保留官方项目页面入口。

`installUpdate()`([update-manager.js](../../../src/electron/update-manager.js)):仅 `canInstall` 放行；置 `installing` → `app.releaseSingleInstanceLock()`（允许新实例启动）→ `autoUpdater.quitAndInstall(true, true)`。updater 仍传递 `/S --updated --force-run`；新版 NSIS 安装器识别 `--updated` 后切换为可见的自动安装，直接显示真实进度与等待退出、备份、安装、恢复等阶段，不再要求选择安装范围、目录或点击完成。成功后窗口自动关闭，沿用普通用户启动与 `--updated` 参数；仅带 `--force-run` 时重新启动 LIRA。普通退出触发的自动安装也显示进度，但完成后保持应用关闭。安装器细节见 [build.md §6](../engineering/build.md#6-nsis-安装脚本buildinstallernsh)。

`electron-updater` 启动安装程序后、调用 `app.quit()` 前发出 Electron 原生
`before-quit-for-update`。主进程监听此事件，直接进入已有的受控关闭流程；即使本机来源
仍连接，也不会在安装已启动后再询问是否继续使用。普通关窗不凭下载完成状态跳过确认。

## 5. friendlyUpdateError 映射

`friendlyUpdateError(error)`（[update-manager.js](../../../src/electron/update-manager.js)）按错误文本正则归类（唯一成表处）：

| 匹配                                                                                                                               | status          | 用户文案                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------- |
| `404` + `latest.yml` / `ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`                                                                                  | `error` | 更新清单暂不可用，请稍后再试。                  |
| 其他 `404`                                                                                                                         | `error`         | 更新包暂不可用（HTTP 404），请稍后重试或反馈发布者。 |
| `checksum mismatch` / `sha512` / `sha256` / `hash mismatch`                                                                        | `error`         | 更新包校验失败，请重新检查并下载更新。 |
| `ENOTFOUND` / `ECONNRESET` / `ETIMEDOUT` / `EAI_AGAIN` / `ERR_CONNECTION` / `ERR_NETWORK` / `ERR_INTERNET` / `network` / `timeout` | `error`         | 暂时无法连接更新服务，请稍后再试。                  |
| 其他                                                                                                                               | `error`         | 更新失败，详细原因已写入错误日志。                      |

消费点：[update-manager.js](../../../src/electron/update-manager.js) 的 `handleUpdateError` 统一处理 autoUpdater `error` 事件与 `checkForUpdates`/`downloadUpdate` 的 catch；[桌面控制器](../../../src/electron/desktop-update-controller.js)的 `setUpdateError` 同样调用该映射并下推状态。

更新器的 error 事件与操作 Promise 的拒绝统一记录错误并下推状态；同一次操作中同一错误对象只记录一次，重新检查或下载时重新计数。只拒绝 Promise、未发出 error 事件的失败也会记录。错误详情通过桌面日志器写入 `logs/errors/desktop.log`，保留原始错误及堆栈；页面提示该相对位置，「日志目录」按钮仍打开 `logs/`。失败和安装状态清空旧下载进度。聚焦回归见 [update-manager.test.js](../../../test/desktop/update-manager.test.js) 与 [desktop-update-controller.test.js](../../../test/desktop/desktop-update-controller.test.js)。

## 6. 完整性验证与代码签名

**SHA-512 哈希验证**(当前已实现):electron-updater 在下载完成后,根据 `latest.yml` 中记录的 `sha512` 字段验证安装包完整性。校验失败映射到 `checksum mismatch` 错误(见 §5),阻止损坏或被篡改的更新包安装。

**Windows 代码签名**：签名与独立验证脚本已实现，构建/发布接入和真实证书验收仍待完成。脚本契约、当前限制和待办入口统一见 [代码签名参考](../engineering/code-signing.md)。安装包摘要验证不能证明发布者身份。
