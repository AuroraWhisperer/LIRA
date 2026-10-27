# Audit Native Runtime And NuGet Lock Remediation Implementation Plan

Status: Completed

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 处理 F-05/F-08，将音频助手及原生检查迁移到受支持的 .NET 10 LTS，并让 SDK、NuGet 传递图和 locked restore 可在仓库中复核。

**Architecture:** 保持现有 WinExe/WinForms、win-x64 self-contained 输出、NAudio/ONNX/RubberBand 边界和 Electron 进程协议。根 `global.json` 固定官方当前 .NET 10 SDK；两个项目启用 NuGet lock file，构建/原生验证先 locked restore 再 `--no-restore` publish，输出仍隔离到既有 build/tmp 目录。

**Tech Stack:** .NET 10.0.402 SDK、`net10.0-windows10.0.19041.0`、NuGet packages.lock.json、NAudio 2.2.1、Microsoft.ML.OnnxRuntime 1.26.0、现有 Node native checks。

## Global Constraints

- 不改变音频算法、设备路由、进程 IPC、模型/vendor 资源校验或 Electron 原生生命周期合同。
- 不读取真实用户音频、设备配置或数据库；原生验证使用合成 PCM、静音 WAV 和隔离状态。
- 缺少 .NET 10 SDK 时只能使用官方安装器放入仓库 `tmp/` 的独立目录，不能假装 .NET 8 构建证明 .NET 10 通过；不修改全局 SDK。
- 下载文件放在新的空目录，脚本与下载物分离；不提交生成的 obj/bin、模型、DLL 或安装包，不发布。

## Ownership And Current Behavior

- 项目：`native/audio-assistant/AudioAssistant.csproj`、`test/desktop/audio-assistant-native/NativeChecks.csproj`。
- 构建入口：`scripts/build-audio-assistant.js`、`scripts/verify-audio-assistant-native.js`；原生 owner 说明：`native/audio-assistant/README.md`。
- 当前基线：net8.0；无 global.json/packages.lock.json；两个脚本直接 publish 并允许隐式 restore。本机仅安装 .NET 8.0.319 SDK，官方 metadata 当前 .NET 10 SDK 为 10.0.402、EOL 2028-11-14。
- 技术参考：`docs/reference/engineering/build.md`；现有原生输出 `build/audio-assistant/` 不被 Git 跟踪，覆盖前须确认其生成物属性并保留用户资源。

## Proposed Changes And Tasks

### Task 1: 固定 SDK、TFM 与 NuGet 锁

**Files:**
- Create: `global.json`
- Modify: `native/audio-assistant/AudioAssistant.csproj`
- Modify: `test/desktop/audio-assistant-native/NativeChecks.csproj`
- Create: `native/audio-assistant/packages.lock.json`
- Create: `test/desktop/audio-assistant-native/packages.lock.json`

- [x] 写入 `global.json`，`sdk.version` 为 `10.0.402`，`rollForward` 为 `disable`，`allowPrerelease` 为 `false`；两个 TFM 只替换为 `net10.0-windows10.0.19041.0`，保留 Windows 版本和其它编译属性。
- [x] 两个项目加入 `<RestorePackagesWithLockFile>true</RestorePackagesWithLockFile>`。使用独立 .NET 10 SDK 对各项目执行 `dotnet restore <project> -r win-x64 --use-lock-file`，中间路径指向 `tmp/`，生成并审查两个 packages.lock.json；直接包版本不因迁移擅自升级。
- [x] 对生成锁文件重新执行相同 restore 的 `--locked-mode`，确认无锁文件变更和 NuGet 错误；如果包不支持 net10，记录具体包/错误并停在兼容性处理，不改成未验证的替代品。

### Task 2: 让两个构建入口执行 locked restore

**Files:**
- Modify: `scripts/build-audio-assistant.js`
- Modify: `scripts/verify-audio-assistant-native.js`
- Test: 现有 `test/desktop/audio-assistant-native/NativeChecks.cs`

- [x] 在两个脚本各自 publish 前加入 `dotnet restore <same-project> -r win-x64 --locked-mode`，传入与 publish 相同的 `BaseIntermediateOutputPath`/`BaseOutputPath`；restore 非零立即退出。publish 增加 `--no-restore`，保持输出、vendor 复制和错误传播不变。
- [x] 用独立 SDK 运行 `npm run build:audio-assistant -- <已校验合成 vendor目录>`，再运行 `npm run test:audio-native`；先检查输出路径和 vendor 文件，避免覆盖任何非生成用户文件。确认 net10 self-contained EXE、合成 DSP/歌曲检测、UTF-8 管道、设置恢复、EOF 和播放输出检查实际通过。
- [x] 若本机缺少官方 SDK 或 vendor 前置，保留明确 Blocked/Awaiting Verification 状态；不能用旧 `build/audio-assistant` 的 net8 binary 或只跑 JS mock 代替原生验收。

### Task 3: 文档与最终复核

- [x] 更新 `docs/reference/engineering/build.md` 和 `native/audio-assistant/README.md` 的 .NET 10 SDK/TFM、锁文件及 restore/publish 顺序；说明终端用户仍使用 self-contained 工作程序、无需安装 .NET。用户指南操作步骤不变，无需新增截图或指南。
- [x] 运行 `node scripts/check-js.js`、`npm run verify:docs`、`git diff --check` 和 `git status --short --untracked-files=all`；检查 global/lock 文件只含可公开包元数据，无本机路径、凭据、obj/bin 或生成资源。

## Completion Evidence

2026-10-25 完成 F-05/F-08。两个项目由隔离的官方 .NET 10.0.402 SDK 完成重复 locked restore，锁文件哈希不变；`npm run test:audio-native` 的 Windows 兼容、安装退出、idle、设备输入、ONNX 推理、音量、DSP/歌曲生命周期、UTF-8/持久化/EOF 与播放输出检查通过。`npm run dist:win:local` 成功，安装产物中的音频助手 runtimeconfig 为 net10.0/10.0.13。真实 ASIO 连接及外设听感仍属既有实机验收，不在本计划中冒充完成；未发布、部署或修改全局 SDK。

## Verification / Rollback / Done When

关键证据是 locked restore 的重复一致性、net10 原生构建和现有 `test:audio-native`，不是仅修改 XML。完整打包还需在依赖工作包完成后验证 extraResources 中的新 EXE；真实声卡、ASIO、外接设备仍按既有计划单列，不由本任务冒充验收。

回滚只反向编辑本计划拥有的 TFM/SDK/锁文件和脚本步骤，不删除用户已有 build 输出；需要恢复生成物时重新运行对应构建。完成条件：两个项目 net10 + locked restore 可复现，原生 focused 检查通过或有明确环境阻塞，文档和 diff 与实际结果一致。
