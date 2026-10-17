# 电音助手内置播放倍速与禁用说明

Status: Completed

## Goal And Boundaries

鼠标悬浮置灰控件时说明原因和操作步骤。LIRA 内置播放器被自动或手动选中时允许 0.5–2 倍速，保持音高；停止处理、原声对比、切歌及组件退出恢复正常速度。外部播放器继续实时采集，不增加缓存播放、外部播放器控制或新算法。

## Current Behavior And Ownership

- `native/audio-assistant/AudioSession.cs` 选择采集进程，外部采集 DSP 固定 1×；现有本地文件 Rubber Band 倍速不变。
- `src/electron/audio-assistant.js` 管理原生工作程序；主进程拥有本实例的进程身份。快照新增所选进程 ID 与由主进程判定的 `internalSource`，不通过显示名称猜测。
- `public/js/admin/audio-assistant-controls.js` 拥有完整/快捷控件及串行写入，禁用原因与实际状态一起刷新；增强下拉菜单需同步 title。
- 播放域拥有 `music-player` 速度与换曲生命周期。新增小型电音助手适配器，只订阅已存在的状态，不额外启动工作程序。原有播放器仍拥有音源、播放、进度及队列。
- 歌词发布、服务端归一化及共享时钟传递默认 1 的 `playbackRate`，保证变速后的歌词时钟与歌曲时间一致。

## Compatibility

保留 IPC 命令与参数、持久化 settings、设备路由和恢复守护。新快照字段为兼容扩展，旧字段不重解释。进程身份由 Electron 本实例进程清单判定，renderer 不提供身份。测试只用隔离数据和生成音频；不停止或重启用户应用，不修改真实播放或设备路由。不提交、打包或发布。

## Implementation And Verification

- [x] 完成置灰 hover 文案，并保证增强下拉菜单呈现同一原因；恢复可用后清理过时提示。
- [x] 原生快照报告 `sourceProcessId`，主进程据本实例进程清单生成 `internalSource`；扩展工作程序单测验证同名外部进程不会被认作内部。
- [x] 播放域通过 `HTMLMediaElement.playbackRate` / `preservesPitch` 处理内部倍速；仅当前处理歌曲生效，停止/退出恢复，切歌阻断旧状态重新加速。
- [x] UI 仅对本地文件与内部来源开放速度；补歌词 `playbackRate` 默认、传递、时钟及动画同步，扩展已有歌词测试。
- [x] 同步应用参考、桌面桥字段、歌词契约、播放参考及应用内指南。
- [x] 运行受影响的 Node 测试、原生检查、JS/架构/文档门禁。复用隔离 Electron 夹具，用生成音频验证 0.5/1/1.5/2 倍时间推进、音高、停止/切歌/原声对比和 hover 状态。

## Failure Handling And Done When

不能获得本实例来源身份时继续禁用实时采集倍速，不通过名称放宽。原生退出或用户停止时恢复播放器原速。只逆转本任务改动；测试实例及数据全部位于 `tmp/`。实现、受影响测试、隔离验证和对应文档一致后完成；真实设备声学延迟与正式安装包不作为本次验证结论。

## Completion Evidence

2026-10-17：用户明确外部来源保持实时跟随，不做缓存变速；随后要求内置播放器支持倍速。完成上述实现及指南同步，交互引导和 README 没有相关倍速承诺或操作步骤，因此保持不变。

- 432 项歌词、播放、电音助手、共享 select 与指南回归通过；输出在 `tmp/audio-assistant-disabled-help/focused-tests.log`。新增覆盖本实例进程身份、速度恢复、切歌防止旧状态重入、title 同步与歌词速度。
- `npm run build:audio-assistant`、`npm run test:audio-native`、`npm run verify:quick` 通过；设计检测无发现。原生仍保持本地 DSP 的 440 Hz、精确时长、原声直通、音量、短尾及连续调参语义。
- 隔离 Electron 使用真实 preload、授权管理页与播放器，以及合成的助手 IPC 状态。精确路由检查：授权 `/admin?desktop=1` 和 `/license` 为 200，匿名 `/admin` 为 401。没有接管真实设备路由或用户歌曲。
- 实际 HTMLAudioElement 设置 0.5/1/1.5/2 倍时，测得时间比约 0.476/0.999/1.474/1.994，440 Hz 测试音频谱峰均为 439.45 Hz（FFT 分辨率约 1.46 Hz）；原声对比、停止和实际队列下一首恢复 1×，切歌请求停止完成。歌词 HTTP 响应在原声对比时恢复 playbackRate=1。
- 恢复按钮的 disabled/hover/命中目标和 title 一致，增强来源下拉框同步禁用原因，停止后清除提示；外部来源速度控件维持禁用。界面截图位于 `tmp/audio-assistant-disabled-help/internal-speed.png`。
- 最终桌面检查首次因折叠的播放器控件等待而超时，已关闭自建实例；使用可见标签开关及展开的播放器完成验证。两次自建 Electron 均已退出。当前用户安装版未更新或重启；真实歌曲听感和设备声学延迟不属于本次实测。
- 自动审批以“策略阻止”拒绝删除两个自建实例的数据目录，因此保留 `tmp/audio-assistant-entry-qa/run-ZCrlJ6` 和 `run-CUhkwr`；未改用其他工具重试删除。截图、日志和只读能力探针留在 `tmp/audio-assistant-disabled-help/`。
