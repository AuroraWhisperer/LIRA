# 自动更新运行时

> 涉及文件:[src/electron/update-manager.js](../../../src/electron/update-manager.js)、[src/electron/main.js](../../../src/electron/main.js)(IPC 与启动触发)、[src/electron/preload.js](../../../src/electron/preload.js)(桥)

本文档是自动更新运行时的**唯一事实源**:状态机、运行时配置、事件、状态载荷、错误映射只在此成文。electron-builder / publish 配置与发布流程见 [../engineering/build.md](../engineering/build.md)(本文件不重复配置块);IPC 通道表见 [preload.md](preload.md) §2。

## 1. 职责边界

| 侧       | 事实                                                                                                      | 出处                                                                       |
| -------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 运行时   | `electron-updater` 6.x 的 `autoUpdater`;延迟加载(`getAutoUpdater` 首次调用才 require,避免 ready 前初始化) | [update-manager.js:10-15](../../../src/electron/update-manager.js#L10-L15) |
| 版本来源 | GitHub `AuroraWhisperer/LIRA` Releases 的 `latest.yml`                                                    | [../engineering/build.md](../engineering/build.md)                         |
| 开关     | 设置 `enableAutoUpdate === 'true'`(设置存储见 [../backend/storage.md](../backend/storage.md) §7)          | [main.js](../../../src/electron/main.js)                 |
| 触发     | 主窗口 `ready-to-show` 后,仅**打包版且开关开启**时延迟 **1s** 首查                                        | [main.js](../../../src/electron/main.js)                 |

## 2. 状态机

状态对象 `updateState = {status, message, version, canDownload, canInstall, progress, updateVersion}`(初值 `idle`/`尚未检查更新`,见 [update-manager.js:17-25](../../../src/electron/update-manager.js#L17-L25))。**status 枚举与迁移**(唯一成表处):

```
idle ──checkForUpdates──▶ checking ──▶ available ──▶ downloading ──▶ downloaded ──▶ installing
                           │             │               │
                           └─────────────┴───────────────┴──▶ error(任意阶段失败)
checking ──无新版本──▶ not-available
!app.isPackaged ──▶ dev-disabled(开发模式直入,不联网)
```

| status          | 含义         | canDownload / canInstall | 进入方式                                       | 出处                                                                           |
| --------------- | ------------ | ------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `idle`          | 初始         | false / false            | 启动                                           | [update-manager.js:17-25](../../../src/electron/update-manager.js#L17-L25)     |
| `checking`      | 检查中       | false / false            | autoUpdater `checking-for-update` 事件         | [update-manager.js:41-47](../../../src/electron/update-manager.js#L41-L47)     |
| `available`     | 发现新版本   | **true** / false         | `update-available` 事件                        | [update-manager.js:49-55](../../../src/electron/update-manager.js#L49-L55)     |
| `not-available` | 已是最新     | false / false            | `update-not-available` 事件 / 404 兜底映射(§5) | [update-manager.js:57-63](../../../src/electron/update-manager.js#L57-L63)     |
| `downloading`   | 下载中       | false / false            | `download-progress` 事件 / `downloadUpdate()`  | [update-manager.js:65-86](../../../src/electron/update-manager.js#L65-L86)     |
| `downloaded`    | 下载完成     | false / **true**         | `update-downloaded` 事件                       | [update-manager.js:88-96](../../../src/electron/update-manager.js#L88-L96)     |
| `installing`    | 安装中(重启) | false / false            | `installUpdate()`                              | [update-manager.js:150-159](../../../src/electron/update-manager.js#L150-L159) |
| `error`         | 失败         | false / false            | autoUpdater `error` 事件 / 各函数 catch        | [update-manager.js:98-105](../../../src/electron/update-manager.js#L98-L105)   |
| `dev-disabled`  | 开发模式禁用 | false / false            | `checkForUpdates()` 且未打包 / 启动即置位      | [update-manager.js:116-122](../../../src/electron/update-manager.js#L116-L122) |

> 状态名以代码为准:`available` / `not-available`(旧文档写的 `update-available` / `no-update` 已纠正);`progress` 仅在 downloading / downloaded 非空。

## 3. 运行时配置与事件

Windows 更新器沿用 `electron-updater.autoUpdater` 及其 Electron HTTP executor，只在首次创建下载 helper 前将应用适配器的 `baseCachePath` 改为 `<安装目录>/updates`；实际缓存为其下的 `lira-updater/`。安装器成功后也将当前安装包留在此处，并移除 builder 在系统用户缓存中暂存的当前安装包。更新源、应用标识、签名校验和自动下载/退出安装策略保持原有契约。

缓存根通过 `desktop-user-data.js` 按实际可执行文件位置解析，开发版按仓库根解析；不依赖迁移后的 Chromium `userData`，因此浏览器目录调整不会把更新文件写进 `data`。

`configureAutoUpdater({onStateChange, writeLog, updater})`([update-manager.js:31-106](../../../src/electron/update-manager.js#L31-L106)):

| 配置                          | 值    | 说明                       |
| ----------------------------- | ----- | -------------------------- |
| `autoDownload`                | true  | 检查到新版本后自动开始下载 |
| `autoInstallOnAppQuit`        | true  | 退出应用时自动完成安装     |
| `allowPrerelease`             | false | 只接受正式版               |
| `disableDifferentialDownload` | true  | 禁用增量下载,整包下载      |

订阅的 electron-updater 事件 → 状态迁移:checking-for-update / update-available / update-not-available / download-progress / update-downloaded / error(错误映射见 §5)。`download-progress` 中计算下载速度 `speed = bytesDiff / timeDiff`(首帧为 0),percent 钳制 0-100([update-manager.js:65-86](../../../src/electron/update-manager.js#L65-L86))。

## 客户端资源检查

版本更新页「本地数据与支持」提供手动只读诊断，独立于更新状态机和授权构建指纹。`resource-integrity-manager.js` 拥有内存状态、单任务和取消；`desktop-resource-integrity.js` 负责原始文件系统及状态投递组合，主进程在退出/重启和安装更新前停止并等待检查。下载安装包和普通更新检查不停止资源检查。

只支持打包 Windows x64。固定读取 `resources/client-integrity-manifest.json`，核对 appVersion/platform/arch、schemaVersion=1、scope=packaged-app-resources、SHA-256 及安全路径；范围仅 `app.asar` 和清单中的 `app.asar.unpacked/` 普通文件。清单最多 4 MiB/10000 项，拒绝链接、目录穿越、Windows 路径别名和大小写重复。清单无效不重建基准、不联网回退；额外资源和用户数据不扫描。

`original-fs` 以 256 KiB 块顺序读取，比较文件大小、摘要及读取前后的句柄/路径身份。检查时限 120 秒，文件计数进度最多每 250 ms 推送一次，开始/结束立即通知。页面最多 20 条详情，日志最多 200 条，只含资源相对路径和归一化原因，无原始异常和文件内容。

快照字段：`revision`、`status`、`appVersion`、`scope`、`startedAt`、`finishedAt`、`totalFiles`（未知为 null）、`checkedFiles`、`complete`、`issueCount`、`unresolvedCount`、`details[{path,reasonCode}]`、`reasonCode`。状态为 idle/checking/passed/issues/inconclusive/unavailable/cancelled。确定缺失或不一致优先为 issues；存在读取失败/变化/超时则 complete=false，保留已确认异常。取消后不会被晚到回调覆盖，新一轮重新读取全部资源。

通过仅表示「本次检查范围内的资源与校验清单一致」，不是完整运行环境或防篡改认证。异常时建议备份后手动重装；日志与官方项目页面沿用已有受控入口，不自动更新、删除或修复。清单及最终安装器发布门禁见 [build.md](../engineering/build.md)。测试：`resource-integrity-files`、`resource-integrity-manager`、`desktop-resource-integrity`、`desktop-update-controller`、真实 `resource-integrity-electron`，以及既有更新页、IPC、退出回归。

## 4. IPC 与 UI 同步

通道、桥方法和方向只在 [preload.md](preload.md#21-songassistantdesktop) 维护；handler 由 [update-ipc.js](../../../src/electron/ipc/update-ipc.js) 注册。状态推送与错误处理由 [desktop-update-controller.js](../../../src/electron/desktop-update-controller.js) 的 `sendUpdateState` / `setUpdateError` 持有。

状态载荷沿用 §2 的对象，`version` 是当前应用版本，`progress` 随状态取值：

- `progress = {percent, transferred, total, speed}`(downloading,速度字节/秒)
- `progress = {percent: 100}`(downloaded)
- `progress = null`(其余状态)

形状出处 [update-manager.js:81-95](../../../src/electron/update-manager.js#L81-L95)。前端消费由 [desktop.js](../../../public/js/desktop.js) 的更新状态订阅负责。

`installUpdate()`([update-manager.js:150-159](../../../src/electron/update-manager.js#L150-L159)):仅 `canInstall` 放行;置 `installing` → `app.releaseSingleInstanceLock()`(允许新实例启动)→ `autoUpdater.quitAndInstall(true, true)`(静默安装 + 装后启动)。

## 5. friendlyUpdateError 映射

`friendlyUpdateError(error)`([update-manager.js:161-173](../../../src/electron/update-manager.js#L161-L173))按错误文本正则归类(唯一成表处):

| 匹配                                                                                                                               | status          | 用户文案                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------- |
| `404` + `releases.atom` / `latest.yml` / `github`                                                                                  | `not-available` | 当前 GitHub Releases 里还没有可用更新包。                  |
| `checksum mismatch` / `sha512` / `sha256` / `hash mismatch`                                                                        | `error`         | 更新包校验失败,请前往 GitHub Releases 手动下载最新安装包。 |
| `ENOTFOUND` / `ECONNRESET` / `ETIMEDOUT` / `EAI_AGAIN` / `ERR_CONNECTION` / `ERR_NETWORK` / `ERR_INTERNET` / `network` / `timeout` | `error`         | 暂时无法连接 GitHub 更新服务,请稍后再试。                  |
| 其他                                                                                                                               | `error`         | 暂时无法检查更新,详细原因已写入日志。                      |

消费点:autoUpdater `error` 事件与 `checkForUpdates`/`downloadUpdate` 的 catch 均走该映射([update-manager.js:98-105](../../../src/electron/update-manager.js#L98-L105)、[115-148](../../../src/electron/update-manager.js#L115-L148))；桌面控制器的 `setUpdateError` 同样调用并下推状态。

## 6. 完整性验证与代码签名

**SHA-512 哈希验证**(当前已实现):electron-updater 在下载完成后,根据 `latest.yml` 中记录的 `sha512` 字段验证安装包完整性。校验失败映射到 `checksum mismatch` 错误(见 §5),阻止损坏或被篡改的更新包安装。

**Windows 代码签名**：签名与独立验证脚本已实现，构建/发布接入和真实证书验收仍待完成。脚本契约、当前限制和待办入口统一见 [代码签名参考](../engineering/code-signing.md)。安装包摘要验证不能证明发布者身份。
