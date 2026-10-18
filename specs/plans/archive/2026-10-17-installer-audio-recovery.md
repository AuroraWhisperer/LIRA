# Installer Audio Recovery Implementation Plan

**Status:** Completed

**Goal:** 覆盖安装在替换文件和备份数据前安全排空同一安装目录的电音助手，避免主程序已经退出却提示“LIRA 无法关闭”。

**Architecture:** 沿用 NSIS 的完整路径进程核对与音频守护的持久化恢复记录。安装器向已核实的音频进程发出按 PID 命名的本机会话事件；工作程序正常停止，守护先恢复端点静音，再保留延期播放器恢复记录并退出。普通退出及故障后的后台自动恢复不变。

**Tech Stack:** NSIS / Windows events / C# .NET 8 / Node test runner.

## Current Behavior And Ownership

- 实机两个 `resources/audio-assistant/LiraAudioAssistant.exe --route-guard` 的父进程及目标播放器已经退出。记录表明 `Restoring=true`、`MutedEndpoint=null`、无恢复错误；等待播放器重开使旧卸载器删除资源失败，builder 最终显示通用关闭失败提示。
- 已重新核对路径、进程开始时间、无运行播放器及记录状态后结束这两个旧守护，确认记录 SHA-256 未变化，释放当前安装。没有运行真实安装器作为测试。
- Owner：`build/installer-process.nsh`、`native/audio-assistant/Program.cs`、`RouteSession.cs`。消费者：安装前数据保护与卸载、主进程音频 bridge。契约：`docs/reference/engineering/build.md`、`docs/reference/desktop/main.md`；测试入口：`installer-app-exit.test.js` 与 `audio-assistant-native/NativeChecks.cs` / `scripts/verify-audio-assistant-native.js`。

## Constraints And Non-goals

- 不按进程名批量终止，不修改用户播放器、系统默认输出、IPC、数据格式或普通路由恢复语义。
- 只有核实属于旧/新安装目录的音频进程收到事件；仍占用时中止，不能备份正在变化的数据或继续旧卸载器。
- 旧版不支持退出事件时给出准确说明并停止；不让安装器强杀恢复进程。现有旧版实例的定向修复已单独完成。
- 不提交、发布、重启用户客户端；本地修复包使用独立 `tmp/` 输出，避免覆盖正在运行的安装包。

## Tasks And Verification

- [x] 1. 扩展现有原生 NSIS 夹具：同目录音频进程、所选目录、不同目录/路径前缀、静默退出、旧助手超时、多实例及进程检查失败；原实现复现提前备份和遗漏阻塞，修复后仅通知归属路径，退出前最后一次写入进入备份。
- [x] 2. `Program.Main` 创建 `Local\LiraAudioAssistant-Install-<PID>` 手动重置事件；bridge 定时器复用正常 Close；`RouteSession` 的等待与恢复接收事件，端点未恢复不退出，延期记录留存。合成记录的真实辅助进程测试通过，不访问个人路由或修改音频设备。
- [x] 3. 安装与卸载共用进程检查在主进程排空后处理音频助手；查询/通知/超时失败保持非零并给出专用信息。构建、桌面、测试文档与安装 FAQ 已同步。
- [x] 4. `npm run test:installer` 57 项通过且零跳过；音频控制/IPC/桌面 shutdown/安装静态/打包与指南聚焦测试 84 项通过。`npm run build:audio-assistant`、`npm run test:audio-native`、`npm run verify:quick` 通过；本地 NSIS 构建及最终资源校验通过。
- [x] 5. 审查 diff、`git diff --check`、`git status --short`，归档计划。测试与构建生成物均未进入源码 diff。

## Installed Recovery And Evidence

- 用户确认已取消原安装，实际目录为程序文件已部分删除、原数据和安装前备份均存在。安装恢复是本次故障处理，不用真实数据运行回归测试。
- 只读逐文件 SHA-256 核对：原数据与原备份各 5,470 个文件，零差异。原备份保留为 `D:\Work\live-exe\LIRA.lira-data-backup.before-audio-fix`；仅解除已核实冗余备份的冲突，不删除内容。
- 用 `tmp/installer-audio-recovery/lira-setup-5.5.2.exe` 静默恢复原目录，退出码 0。安装后再次核对 5,470 个数据文件零差异；`LIRA.exe`、`resources/app.asar`、`resources/audio-assistant/LiraAudioAssistant.dll` 均与校验通过的修复包展开内容一致，新卸载器已安装。
- 没有未完成恢复标记，也没有本次测试辅助进程或安装目录进程残留；未启动用户客户端。未提交或发布；没有复验真实播放器听感或启动客户端的账号连接。

## Failure Handling And Done When

失败保留原安装数据及恢复记录；不绕过路径查询、静音恢复或数据冲突。只撤回本任务修改，不清理其他运行实例或临时目录。完成条件为上述回归通过、安装器确实包含修复、文档一致、最终 diff 不含运行数据/二进制；实际安装恢复结果已由退出码、文件一致性和数据校验确认。
