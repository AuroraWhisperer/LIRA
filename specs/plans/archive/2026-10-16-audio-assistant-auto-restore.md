# 电音助手自动恢复 Implementation Plan

Status: Completed

**Goal:** 停用、关闭助手、播放器先退出、切换播放器及每次切歌时自动恢复原声，不再要求重新打开 QQ 音乐后手动恢复。

**Architecture:** 沿用独立样品的 `RouteSession` 路由事务与守护进程；恢复通过 Windows 每应用接口保留原来的三个角色配置和用户后续改动。播放器关闭后由守护助手后台等待其自然启动，不要求立即重开，不阻断其他播放器。歌曲身份通过 Windows 媒体信息及播放器窗口标题识别，换歌调用现有停止恢复入口。

**Tech Stack:** .NET 8、WinForms、Windows 音频路由 / 媒体 API；正式 LIRA 不接入本次样品改动。

## Current Behavior And Constraints

截图来自 `RouteSession.RestoreRecord`：旧恢复仅枚举仍运行的播放器，退出后必须重开，`DemoForm.Start` 又用任何遗留记录阻断所有播放器。守护助手只等主窗口管道，不监测播放器退出；自动模式遇到旧播放器退出会提前 return，跳过来源切换。用户已明确每次切歌恢复原声，暂停 / 继续不等于切歌。

保留 `settings.json` 和旧路由 JSON 格式、三个音频角色、恢复前检查当前值是否仍为本次隔离目标。不得改 Windows 默认设备、其他应用静音、真实歌曲或用户正在运行的播放器；不提交、发布或打包正式 LIRA。临时构建、故障注入和源码快照只放 `tmp/audio-assistant-recovery/`。没有真实播放器现场证据时不得声称全硬件 / 网易云播放已验收。

## Ownership And Milestones

- [x] `RouteSession.cs`：守护同时等待主窗口断线和播放器退出，播放器关闭后转为后台等待，下一次自然启动时自动恢复。`RoutingChecks.cs` 的旧代码已复现要求重开；验证退出、崩溃、部分写入、后续用户改动及不同播放器互不阻断。遗留记录自动重新挂接恢复助手，同一播放器等待旧恢复完成后才能接管。
- [x] `DemoForm.cs` / 歌曲监测模块：自动模式先检查来源更替再处理旧来源退出；手动选择先恢复旧来源；每次歌曲身份改变调用 `Stop()`，暂停 / 同曲不停止。异步监测不可在停止 / 关闭后重启或改错会话。检查所属回归，覆盖换歌、暂停、换源和取消。
- [x] `README.md` 同步恢复行为、歌曲检测条件与技术事实；沿用 `--routing-check` / `--check`，增加真实 Windows 媒体会话的自有夹具验证必要缺口。原启动入口指向已验证构建，保留用户参数；不重启用户正在运行的实例。

## Verification

隔离构建：`dotnet publish AudioAssistant.csproj -c Release -r win-x64 --self-contained true -o ../audio-assistant-recovery/build`。

路由回归：隔离输出 `LiraAudioDemo.exe --routing-check <已有生成 WAV 绝对路径>`，应在测试播放器关闭时自动转入后台恢复，另一个播放器仍可处理；自然重开后不调用手动恢复，三个路由角色仍自动回到原值。窗口停止 / 主程序崩溃与后续用户修改仍通过。

实际 Windows 探针表明：已退出 PID、suspended PID 以及仅设置 AppUserModelID 的进程均被路由接口拒绝；直接修改独立测试播放器的注册表条目也不能刷新系统缓存。实验已通过原 API 恢复测试播放器，未使用这些失败方案，未重启音频服务。最终使用既有守护进程延续恢复职责，用户已获知关闭后等待自然启动的准确语义，不宣称关闭时已清空 Windows 缓存。

歌曲检测新增 Windows SDK 投影是读取系统媒体信息的必要依赖，编译目标改为 `net8.0-windows10.0.19041.0`；仍在现有进程内运行。`--song-check` 使用自有静音 MediaPlayer 发布歌曲信息，真实 WinForms 验证同曲继续、切歌停止、换来源、停止按钮及关闭窗口都恢复三个路由角色。

歌曲 / UI 检查在同一隔离输出执行，只有自有测试播放器及生成音频允许改变播放。直接验收不能通过恢复全系统设置或操作真实歌单完成。文档门禁 `npm run verify:docs`，收尾审查快照差异、`git diff --check`、`git status --short`，保留所有既有用户改动。

## Failure Handling And Done When

源码快照位于 `tmp/audio-assistant-recovery/before/`；故障保留可恢复日志和结果，仅清理本次自有进程。改动只在通过针对性检查后更新使用入口。所有已确认自动恢复场景及相关回归通过，说明与实现一致，未覆盖的真实播放器 / 同名歌曲识别边界明确记录后完成。

## Completion Evidence

2026-10-16 完成独立样品修复，并更新原 `启动样品.cmd` 使用的 `bin/Open/net8.0-windows/`。使用版与隔离验证版 `LiraAudioDemo.dll` SHA-256 均为 `2E89E054EEC0428D47693FD7B385577C6EC8A558F1F2A61BAA7CE66FF2FCED5C`，更新前后用户 settings.json 哈希相同；更新时该目录没有正在运行的实例，也没有待恢复记录。

- `--routing-check` 14 项通过：三个角色、后续用户修改、重复守护互斥、启动握手取消、主窗口崩溃、守护崩溃、部分写入、退出后后台接管、恢复守护重建、不同播放器互不阻断、自然重开自动恢复及长暂停 / 继续。Windows 记录替换曾短暂拒绝访问；改为共享删除读取、原子替换有限重试，并用持有只读句柄 250ms 的场景确定性复现该条件后通过。没有靠重复全套测试掩盖故障。
- `--song-check` 7 项通过：真实 Windows MediaPlayer 发布的媒体信息和真实 WinForms 消费路径验证换歌停止并还原路由；暂停 / 同曲、同名不同歌手、来源精确匹配、实际窗口标题后备、手动换来源、停止按钮及关闭恢复通过。测试播放器静音并使用自生成 WAV。
- 原有 `--check` 的 DSP / 变调 / 进程采集 / 原生控件检查通过；引擎未修改。没有重跑正式 LIRA 全套测试，因为运行边界仅为 tmp 独立样品。
- 样品 README 同步技术事实、用户操作及限制；正式 LIRA 的接口、技术参考和用户指南无需修改，因为未接入此样品。`npm run verify:docs` 10 项通过；源码快照差异与 `git diff --check` 无空白错误，状态比对仅增加本任务计划，保留所有既有修改。
- 最终自有测试进程和恢复守护全部退出，验证目录无待恢复 JSON。完整结果位于 `tmp/audio-assistant-recovery/song-build/{routing-checks.json,song-checks.json,checks/results.json}`，入口更新结果在 `tmp/audio-assistant-recovery/update-use.json`。无提交或正式产品发布。

准确限制：播放器已退出时 Windows 配置仍等待其自然启动后由后台恢复，不声称进程不存在时已完成还原；播放器不提供媒体信息和歌曲窗口标题时会在接管前提示。相同歌曲身份的单曲循环无法识别为新歌。真实 QQ / 网易云歌单、完整硬件组合及直播软件未在本轮操作验收。
