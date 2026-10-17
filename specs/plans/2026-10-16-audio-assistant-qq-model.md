# 电音助手复用本机 QQ 模型

Status: Paused

2026-10-17 用户已确认 QQ《咏春》“没问题了”、网易云“外放目前感觉正常”；真实网易云切歌自动恢复也已通过。6 帧批量模型已更新原入口，15 组原模型 PCM 对照、20 秒静音、实际采集、17 项路由及 8 项歌曲生命周期检查通过。用户选择“耳机稍后再测”，剩余耳机验收暂停，保留当前使用版和用户参数。交接见 `tmp/audio-assistant-qq/resume-notes.md`。

## Goal And Scope

用户明确要求 tmp 独立样品使用本机 QQ 音乐的声伴分离模型；现有 StemgenRT 对《咏春》伴奏中的鼓点和乐器损伤明显。验收关注正确分离及伴奏保留，延续每次切歌恢复、外放 / 耳机隔离和异常恢复。此次是本机样品验证，不接入正式 LIRA 或发布 QQ 组件。

## Current Behavior And Ownership

`tmp/audio-assistant-demo/StemSeparator.cs` 拥有流式模型和采样率桥接；`AudioEngine.cs` 中的 `DspSource` 拥有消音强度、原声对比和变调。接入前使用的 StemgenRT 模型及参考回归保留作对照，当前运行 QQ 模型。用户安装的 QQ 客户端 OpenVino/Split.xml、Split.bin 为可读的 IR v11，输入为复数频谱、循环状态和 BandNorm 系数，不能把 PCM 直接塞入模型。运行库字符串也有服务器分支，当前歌曲在 QQ 内置伴唱中的实际分支尚未确认。

## Proposed Changes And Compatibility

先在 `tmp/audio-assistant-qq/` 验证本机模型的接口、预处理及输出定义。优先转换到现有 ONNX Runtime，避免为日常样品增加 Python 进程；转换结果必须与 OpenVINO 参考推理一致。若可行，仅扩展当前模型所有者，保留采集、设备路由、歌曲监测、参数含义和现有启动入口。临时依赖只装在隔离验证目录，不修改 QQ 安装或其内部设置。保留用户当前正在试听的版本，完成验证再正常关闭更新。

## Milestones And Verification

- [x] 验证模型可独立加载；确认频带划分、归一化、频谱 / PCM 转换、采样率、状态续接和输出语义。记录证据与仍未确认的参数。
- [x] 用生成音及现有自有语音 / 伴奏夹具比较原模型与复用模型；零输入、有限值、时长、对齐和状态重置通过，测量处理速度及缓冲需求。
- [x] 在所属 `StemSeparator` 接入通过验证的模型，复用现有 DSP 链及必要检查，不改动正式 LIRA。
- [x] 同步样品 README 的算法、来源、适用范围和验证记录；用户确认 QQ《咏春》及网易云外放听感，真实网易云切歌后恢复原输出。
- [ ] 新模型在 WH-1000XM6 的实际输出与恢复验收；用户要求稍后再测，耳机当前未连接。
- [x] 审查与任务前快照的差异，执行受影响的检查、`git diff --check`、`git status --short` 和 `npm run verify:docs`，更新原入口。

## 2026-10-17 Evidence

模型、程序集与设置校验见 `tmp/audio-assistant-qq/deployment-1017.json`。转换模型 SHA-256 为 `EE04E9AE281045B0CAB04D920B77EC6E30BCB9D00E06C180E903413E4EC6A3DD`，原权重不变。15 组 PCM 参考误差最大约 6.19e-7；37.5 秒生成音消音耗时 11.60 秒，+3 半音 19.61 秒，极限 ±12 半音约 34 秒，低配或高负载余量未证明。20 秒零输入耗时约 10.92 秒，输出为零。原先的 `_controlfp_s` 尝试无有效改善，已移除，未将其描述为修复。

本轮 `--check`、`--separator-check`、`--routing-check`、`--song-check` 与完整 6 模式 `--benchmark` 通过。文档门禁 10 项通过。外放 `--output-check` 失败时 Edge 正在播放，混合输出无法归因；不放宽检测阈值，不据此宣称漏音或已隔离。设备和路由已恢复，后续真实播放器外放验收如下。QQ 客户端可能使用服务端分离，本机模型不保证所有曲目与其内置伴唱完全一致。

随后用户实际试听《咏春》并确认“没问题了”：`tmp/audio-assistant-output/qq-six-live.json` 确认 QQ 在 OMEN 活动且端点静音、原 Realtek 会话不活动、助手在 Realtek 输出，窗口显示“原声已隔离”。QQ 停止处理后的路由还原见 `qq-six-restored.json`。

网易云 3.1.4.203507 的真实播放及处理记录见 `tmp/audio-assistant-output/netease-started.json`；用户确认“外放目前感觉正常”。`netease-before-song-change.json` 与 `netease-after-song-change.json` 证明点击下一首后，助手自动停止、三个路由角色回到默认、OMEN 解除本次静音，网易云原声回到 Realtek。用户随后重新开始处理，助手输出正常，记录见 `speaker-accepted.json`。保留用户对强度、调性、音量的后续修改，不用部署时的设置覆盖它们。

09:49 只检测到 Realtek 与 OMEN，WH-1000XM6 离线。用户明确选择耳机稍后再测；新模型耳机效果和明确设备选择仍未验收，不用昨天旧模型或生成音的通过结果替代。

## Failure Handling And Done When

不能确认输入输出定义、转换不一致或吞吐不足时继续在验证目录定位，不把猜测接入用户正在使用的链路。保留原可用二进制、设置与恢复日志；不得破坏性回滚或关闭真实音乐播放器。完成需有正确推理及音频验收证据，不能把“文件复制成功”或“推理有输出”当成效果一致。
