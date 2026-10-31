# 客户端架构与命名审查整改

Status: Completed
Date: 2026-10-28
Baseline: `7caf830e66d913f615a6cca5d63718db65c668ab` 加当前工作树；已有未提交改动保留。

## Goal

按[复核报告](../../../docs/reports/2026-10-28-client-architecture-naming-review.md)处理保留的 11 项：修复供应商回执、明确运行时归属、消除内部名称与文档歧义。9 个记录项不产生整改。用户已授权实施，直接在当前工作树分批完成，不提交、分支、发布或恢复其他暂停计划。

## Architecture and constraints

保留 Electron main 内嵌 Node 的模块化单体、原生 JavaScript/CSS 和既有原生音频工作程序。只将 browser-source DOM 适配模块放回 overlays；不改变状态、资源或事务所有权。

- 公共 HTTP/WS/IPC、preload 全局名、URL、配置键和持久化格式不变；连接测试的 `provider` 字段保持原结构并返回真实解析结果。
- 保留 `deepseekResponsesUrl` / `deepseekApiKey`、错误码、DeepSeek 专属协议分支及 `/api/ai/test/deepseek` 兼容路由。
- 保留 `gift-source-v2` 的全部哈希输入、SQLite 进度事务、旧 JSON store 导出；只说明其已非生产状态源。
- 保留 IPC 来源校验、窗口生命周期、输入/loopback/输出设备方向、请求代际与平台校验。
- 临时快照、日志和原生发布输出都在仓库 `tmp/`；不替换用户正在使用的工作程序，不读取用户数据或启动真实模型请求。

## Current behavior and ownership

| 项目 | 当前事实与整改决定 | 实现、消费者与文档 |
| --- | --- | --- |
| F-03、F-04 | 多供应商门面仍用 DeepSeek 名称，API 测试统一回报 DeepSeek；统一内部门面命名并复用现有 provider 解析 | `src/ai/deepseek-client.js` → `model-client.js` / `createModelClient`；`ai-assistant-service.js` 注入名 `modelClient`；`src/server/ai-runtime.js`、`src/ai/chatgpt-client.js`、`test/ai/` 与共用 fixture；`docs/reference/backend/ai.md` |
| F-01 | shared 中的 DOM 适配器依赖 overlay；模块移入既有 overlays，两个消费者继续共用 | `public/js/shared/browser-source-frame.js` → `public/js/overlays/browser-source-frame.js`；Admin `browser-source-preview.js`、overlay `scene-renderer.js`；`docs/reference/frontend/overlays.md` |
| F-06 | registrar 负责桌面外壳通道；文件/工厂统一使用 desktop-shell 名称 | `src/electron/ipc/update-ipc.js` → `desktop-shell-ipc.js` / `registerDesktopShellIpc`；main、IPC 测试和 shutdown fixture；desktop main/preload/update 参考 |
| F-09 | 输入 helper 被输出路径复用，端点方向正确而名称/异常文本不准确 | `AudioDevices.OpenEndpoint(id, DataFlow flow)`；`DescribeInput` 与 `DeviceCapture` 选择 Capture/Render；`PlaybackOutputs`、`PlaybackOutputContext` 显式 Render；native/desktop owner 说明 |
| F-20 | controller 调用带私有惯例前缀的方法 | `HomeService.applyBackgroundUpdate` 与 controller 唯一生产调用；`docs/reference/frontend/playback.md` |
| F-05、F-10、F-12 | 报告允许最低成本的职责注释；不另建模块、不搬状态或合并安全策略 | `remote-gift-cursor-store.js` 标明旧 JSON 与当前 SQLite owner；`gift-export-runtime.js` 说明来源/同步/卡片/导出门面；`local-media-access.js` 说明纯 origin 比较供其他 desktop adapter 使用 |
| F-07、F-15 | owner 文档的初始化归属、符号、链接与入口诊断说明漂移 | `docs/reference/frontend/app.md`、`docs/reference/desktop/main.md`；逐句对照实际 main 与初始化调用，保持业务接线 |

文件移动产生的维护文档链接同步到新路径；历史报告保留原基线事实，失效的 Markdown 源码链接仅更新目标或说明路径迁移，不改写其历史结论。README 与用户指南没有产品操作变化，核对后无误则不编辑。

## Milestones and interfaces

### 1. 模型门面与 provider 回执

- [x] 扩展 `test/ai/ai-provider-adapters.test.js` 的 Kimi 连接断言，增加 auto/custom 与 auto/官方 DeepSeek 的必要场景；先确认旧实现失败。
- [x] 将成功回执改为既有 `describeModelEndpoint(config.deepseekResponsesUrl, config.modelApiProtocol, config.modelProvider).provider`，保持所有其他字段。
- [x] 门面文件/工厂改为 `model-client.js` / `createModelClient`；服务注入和共用 fixture 用 `modelClient`，纯响应解析消费者也从新文件导入。仅更新实际引用，不做全局 DeepSeek 字样替换或新增兼容 re-export。
- [x] 同步当前 AI owner、规格索引及受影响的源码链接；运行 AI 直接相关测试。

验证：`node --test test/ai/*.test.js`，包含供应商适配、会话、取消、交付、日志脱敏及管理 API；使用 Node 自身 glob 或显式文件列表，不访问真实服务。

### 2. Browser-source 运行时归属

- [x] 移动现有文件，不复制实现；相对依赖改为 `./component-style-effects.js` 与 `../shared/` 纯契约。
- [x] Admin 与 scene renderer 从新 overlay 路径导入，保留 configure/dispose 调用与 sandbox/referrer 行为。
- [x] 同步 overlay owner 中的适配器职责；运行已有 canvas browser-source 与 scene browser-source 验证。

验证：`node --experimental-vm-modules --test test/scenes/scene-browser-source.test.js test/admin/canvas-browser-source.test.js`；现有 fixture 提供合成来源和临时会话，验证实际预览、保存和输出，不操作用户应用。

### 3. 桌面、原生端点与播放内部名称

- [x] registrar 改名并更新 main、直接测试和 fixture，公共通道与校验函数逐字保留。
- [x] 原生 helper 用显式 DataFlow，输入/loopback 调用沿用原分支，输出固定 Render；按 flow 区分输入/输出端点不可用提示。
- [x] `applyBackgroundUpdate` 更新定义与唯一生产调用，保留内部状态检查；补三处精确职责注释处理 F-05/F-10/F-12。
- [x] 同步 desktop/playback 参考及当前源码链接。

验证：IPC 来源、资源检查、shutdown、gift diagnostics、来源身份隔离和 playback home 现有测试；C# 在 `tmp/client-naming-remediation-2026-10-28/` 发布工作程序及已有 `NativeChecks`，以已有 NativeChecks 和静音 playback output 检查验证编译及端点路径，不替换 `build/audio-assistant`。真实声卡路由/听感和安装器不属于本次内部命名验收。

### 4. 文档事实、完整性与收尾

- [x] F-07 区分共享加载触发器与各业务初始化 owner；F-15 核对 register 符号、runtime 字段、适配器定义位置、入口失败诊断与启动次序。
- [x] 报告追加逐项处理结果，保留原审查时间与证据；核对 11 项全部有当前证据，9 个记录项未被顺带重构。
- [x] 执行 `npm run check`、`npm run verify:architecture`、`npm run verify:docs`；复查所有移动路径、符号及动态/字符串引用。
- [x] 检查本任务相对工作树快照的差异、`git diff --check` 和 `git status --short`，确认没有生成物、敏感内容或无关改动；完成后归档本计划并更新索引。

## Rollback or failure handling

每批开始前将拟改文件快照保存在本任务 `tmp/`。失败时先定位该批行为或调用链，不弱化断言；需要撤回时只撤销本任务补丁和文件移动，保留此前用户改动。原生输出、浏览器和服务均使用独立临时目录及自有进程，退出时沿现有 fixture 清理。

## Done when

11 项均按上表落实，API 真实 provider 回归通过，移动文件和改名的真实消费者可加载，原生 helper 编译与原有输入/输出检查通过，文档引用与初始化说明一致；相关测试、静态/架构/文档门禁和最终差异检查通过。报告明确记录未执行的真实网络、设备听感和安装包验收，不将其冒充本次证据。

## Progress and evidence

- 2026-10-28：已重新核对工作树、报告、scoped 规则、实际消费者和现有验证入口；用户既有改动保留。开始实施。
- 供应商基线 27 项通过；新增 provider 断言后旧实现失败 3 项（Kimi、auto 第三方和 custom），修复后供应商 30 项及 AI 目录 309 项全部通过。共享目录依赖检查同样先失败再通过。
- 桌面 IPC、关闭、来源身份、播放生命周期 100 项通过；播放前端补充 29 项通过；现有浏览器源编辑/保存/发布/重开与场景配置 9 项通过。
- `npm run check` 检查 1683 个 JS 文件通过；架构门禁 29/29、含收尾归档的文档门禁 10/10 通过。保留已有 module-type/VM Modules 提示。
- 系统 PATH 只提供 .NET 8；使用仓库已有 `tmp/code-audit/dotnet-sdk-10.0.402/dotnet.exe`，未改 `global.json` 或安装系统 SDK。对原生程序和已有 NativeChecks 执行 locked restore、`--no-restore` publish，输出、CLI home 和中间文件均位于本任务 `tmp/client-naming-remediation-2026-10-28/`。
- NativeChecks 的兼容性、恢复、空闲、输入、端点方向与错误提示、模型、音量、DSP 和歌曲生命周期通过；对新编译的隔离程序运行现有 `checkNativePlayback`，9 个 WASAPI/DirectSound/WaveOut 输出选项的静音 PCM 写入及停止通过。ASIO 仅枚举，未做外接硬件或听感验收。
- 已按任务开始时的文件快照复核修改，`git diff --check` 通过；报告记录 11 项结果，owner 文档、当前源码路径和历史链接目标同步，用户指南因操作不变而无需修改。
- 自有原生进程已退出（按本任务可执行路径只读核对为空）。临时 fixture 数据的递归清理被自动审批以 `blocked by policy` 拒绝，目录留在 `tmp/`，没有换工具或方式绕过。该限制不影响实现与验证结果。
