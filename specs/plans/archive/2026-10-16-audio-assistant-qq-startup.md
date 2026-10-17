# QQ 音乐外置处理启动修复

Status: Completed

## Goal

使 `tmp/audio-assistant-demo/启动样品.cmd` 在用户当前 QQ 音乐和 WH-1000XM6 耳机环境中，实际完成原声隔离、消音处理、输出和停止恢复。按用户最新要求，只处理选中的音乐播放器，浏览器继续正常播放，不能作为启动的干扰条件。不能用自有测试播放器或 Realtek 上的通过结果代替这项验收。

## Current Behavior

2026-10-16 用户再次报告无法开始。旧程序的 `last-channel-check.json` 显示耳机混合输出干扰过高，结果为 `inconclusive`。把预检移到播放器路由之后仍会受浏览器声音影响，不能满足用户明确的进程范围。最终选择取消桌面混合音预检对启动的阻断；保留真实播放器会话通道核验、独立进程采集、失败恢复。检测器保留为手工诊断工具，不把未知硬件直通报告为已经排除。

## Ownership And Boundaries

- `DemoForm.cs` 拥有启动编排、取消和停止恢复；`RouteSession.cs` 拥有每应用路由事务和持久恢复记录；`AudioDevices.cs` 核实真实活动输出端。
- `ChannelProbe.cs` / `ProbeSignal.cs` 仅负责手工诊断；`AudioEngine.cs` / `ProcessCapture.cs` 负责所选进程的实际处理，处理流不读取桌面混合音。
- 样品 `README.md` 同时拥有技术说明和用户指南。正式 LIRA 文档、HTTP/IPC、持久化和 Electron 不受本次样品改动影响。
- 不新增驱动、不重启电脑、不改变 Windows 全局输出、麦克风或其他应用的音量。保留用户当前歌曲和播放进度，不保存真实歌曲音频。
- 保留实际会话通道核验，不把所有声卡内部监听当作已检测；保留试用引擎水印。真实播放器验证作为用户现场验收，确定性回归使用自生成素材。

## Proposed Changes And Verification

- [x] 读取本次截图、当前进程、失败记录和现有启动 / 恢复实现。
- [x] 使用现有路由守护助手短暂切换当前 QQ 音乐，核实它是否真的迁移到 OMEN，并恢复原配置。五次活动会话采样均为 OMEN；结束后回到 WH-1000XM6，三个路由角色还原为空。证据为 `tmp/audio-assistant-diagnosis/qq-route.json`。
- [x] 在 `DemoForm.Start` 中建立可恢复路由并确认播放器实际输出通道，然后直接启动所选进程的处理引擎。浏览器声音不再阻断启动。所有失败、取消继续走现有 `Stop` 恢复路径。

```csharp
route = await RouteSession.Start(app.Pid, isolationId, cancellation.Token);
if (!await AudioDevices.WaitForIsolation(app.Pid, isolationId, cancellation.Token))
  throw new InvalidOperationException("播放器没有切入所选通道。");
// Capture only the selected player; unrelated desktop playback is not a startup gate.
engine = new AudioEngine(null, app.Pid, outputId, strength, semitones);
```

- [x] 现有 `--check` 验证所选进程捕获、消音、变调和控件；`--routing-check` 七项路由及故障恢复检查通过。没有新增重复自动检查；现场八阶段核验补足本次浏览器共存与启动回归。
- [x] 更新样品说明中的启动顺序、技术边界和验收范围；构建到隔离目录，更新原启动入口。两处 `LiraAudioDemo.dll` SHA-256 同为 `8C75EC9FE48192FFA70C23C80F4BCD575EE63CA0D7E15AE33ACD5C1CA4C56263`。
- [x] 真实 WinForms 窗口 QQ → OMEN → 助手 → WH-1000XM6 持续输出，QQ 在耳机的原声会话不再活动。暂停 / 继续、暂停时启动、停止、启动取消及重新启动通过；停止 / 取消后三个路由角色恢复为空，QQ 回到耳机。浏览器八次采样均保持耳机输出、原音量、未静音且有电平。原入口当前保持处理，供用户试听。

现场汇总为 `tmp/audio-assistant-diagnosis/qq-ui-summary.json`，各阶段会话、电平和原生控件状态记录在 `tmp/audio-assistant-diagnosis/qq-ui-verification/`；自动检查在 `tmp/audio-assistant-diagnosis/qq-build/checks/results.json`、`routing-checks.json`。这证明当前 QQ 与耳机路径，不证明网易云现场换设备、直播软件接入、所有声卡内部转发或低配长时间运行。消音听感和水印仍需用户歌曲试听；没有承诺所有环境都已通过。

收尾：`npm run verify:docs` 十项通过；按仓库原配置运行 `git diff --check` 通过，另查 ignored 样品与本轮快照的差异，只有 `DemoForm.cs` 和 `README.md`。`git status --short` 与开始快照比对，保留其他任务改动；QA 故障注入进程均已退出，只保留实际试听窗口及其恢复守护进程。正式 LIRA 的契约、自动检查和用户指南不受独立样品改动影响。

命令：`dotnet publish AudioAssistant.csproj -c Release -r win-x64 --self-contained true -o ../audio-assistant-diagnosis/qq-build`；构建程序的 `--check`、`--routing-check` 使用独立目录和自生成 WAV。现场 UI 自动化记录位于 `tmp/audio-assistant-diagnosis/qq-ui-verification/`，只保存会话、电平和路由值，不保存歌曲音频。旧 `--existing-channel-check` 绑定 OMEN / Realtek 的诊断失败，不能用作当前耳机链路的通过证据；独立手工诊断保留原断言。按实际改动运行相关检查，不扩展到正式 LIRA 全套测试。Markdown 修改后运行 `npm run verify:docs`，最后检查任务差异、`git diff --check` 和 `git status --short`。

## Failure Handling

实际路由验证由现有 stdin 守护助手持有，结束 / 异常关闭 stdin 后恢复此前三种角色的配置，并检查恢复记录清空。仅退出本次启动的验证进程。更新用户正在运行的样品时先正常停止、恢复并关闭样品；不结束 QQ 音乐。失败保留结果，不跳过保护。

## Done When

当前 QQ 音乐和耳机链路实际通过启动、持续处理、停止恢复和重新启动；相关回归通过；原启动入口运行已验证版本；说明与实际一致。未达到真实链路验收前保持进行中。
