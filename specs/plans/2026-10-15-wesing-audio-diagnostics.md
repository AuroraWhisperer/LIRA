# 全民 K 歌多输出设备识别与播放诊断

Status: Awaiting Verification

## Goal

有、无独立声卡的主播都能自动识别全民 K 歌播放；在“重新检测”左侧提供“播放诊断”，正常播放时采样并展示、导出识别结果，便于远程定位歌词已读到但进度冻结的问题。

## Current Behavior

- 用户确认：有人声后仍等待歌词，LIRA 时间停在 00:05，使用独立或虚拟声卡。
- QRC 已加载；原生监视器仅检查 Windows 默认输出设备。合成原生回归已复现：默认设备残留停止会话、另一设备正常播放时返回 State=0、Peak=0。
- 现有采集引擎支持有声时外推冻结进度、真实暂停、恢复及重新校准；保持该逻辑，修复其音频输入。
- 当前临时诊断包需要另行运行，用户要求把实测入口放进产品。

## Ownership And Compatibility

- Native owner: `src/music/wesing-native-monitor-source.js`；PowerShell 采样装配 `wesing-monitor.js`。
- Runtime owner: `wesing-capture-engine.js`；新增同域 `wesing-diagnostics.js` 负责有界、按需采样及结果归纳。
- API: `src/server/routes/wesing-routes.js`、`src/server/api-context.js`；沿用管理端认证，新增 `POST /api/music/wesing/diagnose`，无用户参数、固定 20 秒；`diagnose/export` 仅按报告开始时间导出服务端持有的报告。
- UI: `public/pages/admin/playback/page.html`、`public/js/playback/services/wesing-service.js`，新增同目录 `wesing-diagnostics.js` 管理诊断面板；复用现有 CSS token 和请求适配器，导出保存到运行时注入的日志目录。
- Contracts: `docs/reference/backend/music/wesing.md`、`docs/reference/backend/api.md`、`docs/reference/frontend/playback.md`；测试地图 `docs/reference/engineering/test.md`。
- Guidance: 播放页使用指南与音乐 FAQ；引导入口无变化，不新增重复说明。
- 保持 QRC、设置、HTTP/WS 旧契约、歌词来源仲裁、Electron preload、权限和直播音频配置不变。诊断只使用当前采集器，不创建第二个监视进程、不读账号凭据、原始歌曲日志或录音。

## Proposed Changes

1. 枚举所有 active render endpoints，按 WeSing 进程过滤音频会话，跨设备合并活跃状态和峰值；单设备失败不遮蔽其他设备。释放每层 COM 引用。增加输出设备数及匹配/活跃会话数供诊断，普通业务状态不扩散这些原始字段。
2. 采集引擎在处理现有样本后交给诊断记录器。仅点击后记录 20 秒、间隔至少 250ms、最多 80 条；并发请求共用一次记录，停用/停止取消并清理计时器。`src/server.js` 在等待在途 HTTP 请求完成之前取消诊断，避免关窗等待完整 20 秒；保留播放器关闭前写回顺序。白名单记录进度、播放/歌词状态、音频统计和错误标志，不返回缓存路径、token 或原始对象。
3. 诊断面板点击后展开并显示采样说明；运行中禁止重复启动，结束显示客户端、歌词、进度、音频结果。失败可重试；收起不被迟到结果重新展开。报告由用户点击“导出诊断”保存 JSON；不会自动发送。

### 日志文件夹导出调整（2026-10-15 用户补充）

- “导出诊断”改为写入 LIRA 已有日志目录，复用 `resolveDataPaths(dataDir).logDir`；文件名为 `wesing-playback-diagnostic-YYYY-MM-DD_HH-mm-ss-SSS.json`，时间取导出时的本机时间。
- 诊断 owner 只保留最近一份已完成报告；新增管理端 `POST /api/music/wesing/diagnose/export`，以 `startedAt` 匹配当前报告。服务器生成固定目录和文件名，只保存自身采集的白名单内容，不接收文件路径或报告正文。用排他创建避免覆盖同名文件。
- UI 点击后请求保存并显示路径，失败可重试；保持手动导出，不自动录入文件，不新增 Electron 权限或通道。
- 验证保存目录/英文时间命名/内容、未诊断及过期报告拒绝、写入失败与不覆盖，认证边界、前端重试与实际 Electron 保存。同步接口、WeSing 契约和使用指南。
- 已完成：157/157 相关回归、27/27 架构检查、10 个相关文件语法检查通过。隔离 Electron 实际点击保存产生 `logs/wesing-playback-diagnostic-2026-10-15_19-20-01-237.json`，内容含 61 条诊断样本，界面显示完整路径，没有浏览器下载或页面错误；实例已关闭。证据：`tmp/wesing-export-ui-CutV84/`。技术文档、测试地图与使用指南同步，远端声卡实播仍待用户更新版本后验证。

## Milestones And Verification

- [x] 多设备修复：原生合成设备回归先失败后通过；覆盖默认、非默认、无匹配、暂停、跨设备顺序、设备失败和音量不可用。既有时钟/录制模式用例通过。
- [x] 诊断记录：合成样本和假时钟验证时限、数量上限、并发共享、停止、无样本、进度冻结/推进及字段白名单；真实 HTTP 验证未认证与 overlay 访问被拒绝，关闭时提前结束采样。
- [x] 产品入口：前端验证按钮顺序、重复初始化/点击、采样结果、安全文本输出、失败重试、收起和报告导出；隔离 Electron 布局、真实认证接口与下载完成验证通过。
- [x] 同步技术文档、测试地图和播放指南/FAQ；文档、架构与固定版本契约检查通过。完成 diff、空白和工作区状态检查。
- [ ] 主播电脑使用更新后的版本，在内置或外置/虚拟声卡的实际播放中验收；必要时导出内置诊断。当前未构建安装包或发布版本。

Commands:

```text
node --test test/wesing/wesing-native-audio.test.js test/wesing/wesing-capture-timing.test.js test/wesing/wesing-capture-recording-mode.test.js
node --experimental-vm-modules --test --test-concurrency=4 test/wesing/*.test.js test/playback/playback-wesing*.test.js test/server/server-lifecycle.test.js test/admin/frontend-usage-guide.test.js test/admin/admin-page-composition.test.js
npm run verify:docs
npm run verify:architecture
npm run verify:contracts -- D:/Work/Live/tmp/server-contract-67119e81
```

## Verification Results

- 2026-10-15：相关回归 153/153 通过；原生错误隔离分支调整后，原生/时钟/录制模式 22/22 再次通过。文档 10/10、架构 27/27，通过固定提交的 10 份服务器契约样本。
- 架构检查最初指出新增空 catch；已改为明确跳过失败设备、在枚举失败时返回已收集状态。没有提高债务基线。默认服务器工作区与契约锁版本不同，复用已存在的 `tmp/server-contract-67119e81` 固定提交工作区通过验证，没有改动服务器仓库或契约锁。
- 隔离 Electron 使用真实生产 HTML/CSS/preload、桌面请求认证和真实服务器采样；只有全民进程/音频输入为合成。匿名 `/admin` 401、授权页面 200；实际点击验证 20 秒采样、错误重试、收起、两份 JSON 下载完成与白名单字段。冻结场景为 00:05 → 00:05；有声场景原始进度仍固定，歌词时钟推进并显示当前行。全程仅启动一个测试监视器，无页面错误或横向溢出，实例已关闭。证据：`tmp/wesing-ui-4e1NWS/`。
- 原生 COM 本机只读烟测：用不匹配任何进程的 PID 枚举到 2 个输出设备，12ms，匹配会话 0；确认真实接口可调用，不将本机结果当作主播声卡验收。
- 技术文档和使用指南已同步；引导页入口不变，现有缓存配置截图仍准确描述缓存区域，不额外改动引导配置或截图。

## Failure Handling And Done When

诊断失败不改变播放器或歌词状态；所有记录和计时器有界，停止时释放。仅反向修改本任务拥有的变更，不动既有 `outputs/`。不提交、发布或更改版本；主播旧安装包不会自动获得本地修复。

完成条件：默认和其他输出设备的合成原生识别通过、采集时钟回归通过、诊断按钮/结果/导出/权限与资源清理通过、桌面验收与文档同步完成。真实主播声卡验收如未取得，明确记录限制，不将合成结果称为她电脑已修复。
