# 电音助手外放隔离 Implementation Plan

Status: Paused

2026-10-17 用户已确认通过 QQ 音乐和网易云播放器的真实外放试听，网易云实际切歌自动恢复通过。用户选择“耳机稍后再测”，剩余耳机验收暂停；使用版和用户当前参数保留。交接见 `tmp/audio-assistant-qq/resume-notes.md`。

**Goal:** QQ / 网易云通过现有独立声卡或虚拟通道采集后，耳机和外放只收到处理后的音乐；停止、切歌、关闭、崩溃及换播放器仍恢复原声和临时更改的通道状态。

**Architecture:** 延续 tmp 独立样品的 `AudioDevices`、`AudioEngine` 和 `RouteSession`。进程采集位于端点主静音之前，暂时静音隔离端点关闭它向实体输出的直通；最终输出端点保持独立。原路由守护和恢复日志拥有此临时状态，不增加驱动或常驻服务。

**Tech Stack:** .NET 8 / WinForms、NAudio WASAPI、Windows 每应用音频路由。

## Evidence And Scope

初始复现时只有 Realtek 外放与 OMEN 虚拟端点在线。OMEN 到 Realtek 的自生成编码探针确认直通，原声振幅约 0.0100，外放同码下界约 0.0175。暂时静音 OMEN 后进程采集仍约 0.0100；当时背景 QQ 音乐使外放测量不确定，不能单凭该次测量宣布隔离完成。后续生成音及真实播放器证据保存在 `tmp/audio-assistant-output/`，见下方验收记录。

所有改动仅在 `tmp/audio-assistant-demo/`，文档所有者是其 README；正式 LIRA 的接口、架构和指南未接入样品。保留设置、三个路由角色、后续用户更改、已退出播放器下次自然启动恢复及每次切歌恢复。只临时操作所选独立通道，不修改 Windows 默认设备、最终输出静音、其他应用音量或歌曲列表。不提交、不发布正式 LIRA。

## Milestones And Verification

- [x] 复现外放直通，验证端点静音与进程采集相互独立；记录实际设备和播放器路由，不保存用户歌曲录音。
- [x] `RouteSession.cs`：在 Windows 变更前保存隔离端点静音原值；启动、停止、取消、异常和遗留记录恢复共用原守护。防止共享通道被不同守护重复接管，关闭播放器时立即还原端点，路由可独立延期。旧记录仍兼容。
- [x] `DemoForm.cs` / `AudioDevices.cs`：开始前确认最终输出与独立原声通道分开；处理期间隔离被破坏时停止并准确说明。保留自动切歌和换源恢复，刷新实际设备选择，避免脱机耳机留下不明确状态。
- [x] 扩展所属路由 / 声卡检查：生成音频证明原声未从通道泄漏而采集非零、变调和消音输出生效；覆盖正常/故障恢复、通道初始静音、用户手动解除静音、孤儿记录、退出延期及不同播放器互不阻断。只用自有夹具注入故障。
- [x] 实际 QQ、网易云外放处理验收；QQ 停止后的原路由已恢复，网易云实际切歌自动停止并恢复原声，用户确认两播放器外放听感。
- [ ] 连接现有耳机后验证新模型的处理与恢复，并验证系统默认输出和明确设备选择。用户要求稍后再测；硬件未在线不能以合成测试代替验收。
- [x] 同步样品 README，更新原使用入口并保留设置；审查源码快照差异、`git diff --check`、`git status --short`，执行 `npm run verify:docs`。本任务不需要正式 LIRA 全套测试。

## 2026-10-17 实际播放器验收

QQ《咏春》运行时，OMEN 端点静音、QQ 的 Realtek 原声会话不活动，助手在 Realtek 输出；用户确认“没问题了”。现场与恢复快照为 `tmp/audio-assistant-output/qq-six-live.json`、`qq-six-restored.json`。

网易云主音频进程实际迁移到 OMEN，助手在 Realtek 输出，用户确认“外放目前感觉正常”。点击下一首后，窗口显示“歌曲已切换”及“播放器输出已还原”；三个路由角色恢复默认，OMEN 解除临时静音，网易云在 Realtek 活动。证据为同目录的 `netease-started.json`、`netease-before-song-change.json`、`netease-after-song-change.json`。其客户端未提供系统媒体信息，本次使用现有窗口标题后备识别，不需要新增实现。

09:49 耳机仍未连接，最新状态为 `speaker-followup.json`。用户选择耳机稍后再测，当前未完成项仅为本轮新模型的实际耳机输出、设备选择及恢复；不修改用户的播放状态、系统音量或助手参数。

## Failure Handling And Completion

基线源码在 `tmp/audio-assistant-output/before/`，构建和测试均在 `tmp/audio-assistant-output/`。保留持久化恢复记录；只结束本任务启动的测试进程，不结束或重启真实音乐播放器。更新运行中的助手使用正常关闭恢复后替换已验证构建。每项已确认要求需具备当前代码、针对性测试及对应实际设备证据；不能仅因恢复测试通过而宣布外放或耳机已正常。
