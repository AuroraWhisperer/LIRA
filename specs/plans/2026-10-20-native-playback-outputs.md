# 内置播放器多接口输出实施计划

Status: Awaiting Verification

## 目标

按用户截图提供真正可切换的实际输出接口、设备和声道，界面不使用竞品品牌。以本机 WASAPI / DirectSound / WaveOut 实际枚举和已安装 ASIO 驱动为准，有设备才有相应默认选项；不固定为三组，不以安装驱动代表硬件连接。保留现有播放、暂停、进度、倍速、音量与设备失联保护。此前设备输入工作保留；其“不按接口列设备”的决定由本次明确需求替代。

## 现状与技术依据

内置播放由 HTMLAudioElement 解码和计时，`output-device.js` 用 setSinkId 切设备，不能选择 Windows 输出接口。原生组件已依赖 NAudio 2.2.1，具备三类 IWavePlayer，无需增加运行时依赖。用户截图作为可见行为依据，不推断竞品私有引擎。

- [NAudio 2.2.1 输出类型](https://github.com/naudio/NAudio/blob/v2.2.1/Docs/OutputDeviceTypes.md)
- [Microsoft 旧接口端点身份](https://learn.microsoft.com/en-us/windows/win32/coreaudio/endpoint-id-strings)
- [Microsoft DirectSound 端点 GUID](https://learn.microsoft.com/en-us/windows/win32/coreaudio/pkey-audioendpoint-guid)
- [Microsoft WaveOut 端点映射](https://learn.microsoft.com/en-us/windows/win32/coreaudio/device-roles-for-legacy-windows-multimedia-applications)

## 职责与设计

1. 原生 `PlaybackOutputs.cs` 拥有接口真实枚举、稳定端点 ID 与 IWavePlayer 创建。WaveOut 索引每次通过端点 ID 解析，不持久化易重排的索引；ASIO 仅在显式打开成功后列驱动返回的输出声道对。助手最终输出也复用此工厂，原声隔离仍使用端点 ID。
2. 复用已打包可执行文件的 `--playback-output` 模式接收有限大小 PCM 管道，不加载分离模型。独立于电音助手进程的原因是进程采集必须区分播放器原声与处理后的输出，否则会捕捉自身形成回送；不开放网络服务、不新增依赖。Electron 拥有唯一实例、超时、背压、页面卸载与退出清理。
3. Renderer 仍以原音频元素拥有播放时钟。只在选中原生输出时，Web Audio 工作线程传送 PCM；其本地输出为静音，暂停、跳转、换歌清空已排队声音；失败暂停，不回退到外放。默认兼容输出及旧偏好继续可用。格式自动适配，不宣称原码/独占；ASIO 进程音频不冒充可由 Windows 回送采集。
4. PCM IPC 仅允许已授权主窗口主 frame，限制命令、设备 ID、采样率、包大小及会话标识，不接收文件路径或任意 URL。跨域媒体解码仅在现有音乐 CDN 和授权主 frame 的媒体响应中允许桌面 origin；本地音频仍执行原文件 allowlist。保留隔离、凭据、会话和 local-media 边界。
5. 主进程将自己拥有的播放 worker PID 提供给助手，renderer 不提供可信 PID。助手将其视为内置播放器，沿用进程采集、切歌监测、隔离和恢复。

## 里程碑与验证

- [x] 原生枚举、映射和输出工厂；合成静音逐接口打开/送帧/停止验证，设备缺失不回退。
- [x] 有界 PCM 桥、主窗口 IPC、preload 和退出接线；验证非法来源、非法数据、迟到包、背压与关闭。
- [x] 内置播放器选择、保存、旧偏好、播放操作及助手衔接；沿用并扩展输出 owner 的并发/恢复测试。
- [x] 授权隔离 Electron 实测列表、三接口输出、暂停/跳转/切换及原生退出；不录制用户音频、不操作用户运行的应用。
- [x] 同步播放/桌面/本机设置契约、使用指南；执行聚焦测试、`npm run build:audio-assistant`、`npm run test:audio-native`、`npm run check`、`npm run verify:architecture`、`npm run verify:docs` 和最终 diff/status 检查。

## 兼容与失败处理

保留此前未提交改动、所有授权与播放器 HTTP 契约、旧 playbackOutput:v1。只新增原生设备标识，不按显示名称匹配设备。切换失败暂停或保留已验证旧输出；断开保留选项，不自动开启其他设备。用仓库 tmp 隔离测试；不构建安装包、提交或发布。外接声卡、蓝牙和多通道型号没有实机就记录未验证，不以软件测试推断全兼容。

## 完成条件

下拉选项来自真实接口枚举，选中后确实由对应接口输出；默认与具体设备、保存/恢复、失败与退出均有证据。既有播放和电音助手没有原声重复输出或处理回送，文档一致，硬件限制说明准确。

## 验证证据与待实机事项

原生组件构建通过；原生回归覆盖 DSP、输入映射/格式、同端点不同接口冲突、ASIO 标识、恢复与退出，以及本机 9 个 WASAPI / DirectSound / WaveOut 默认和具体端点的持续送帧。

隔离授权 Electron 中实际列出 13 项（含兼容选项、9 个原生端点选项及本机已安装 ASIO 驱动）。三接口在隐藏的普通桌面窗口连续 8 秒分别推进 8.002 / 8.018 / 8.000 秒，无输出故障；50% 音量的合成音峰值约 0.125，静音为 0，暂停/跳转、保存、重载不自播通过。测试送往硬件的 PCM 均替换成静音，不录制用户声音。截图为 tmp/playback-output-qa/outputs-final.png。

修复了 DirectSound 首次启动未开始读取就接收 PCM 的溢出，以及隐藏窗口渲染降速；最终使用主窗口创建时关闭后台节流和 Electron 支持的 disable-renderer-backgrounding。静默 sink 与临时切换节流未通过时钟检查，没有保留。

本机 Steinberg built-in ASIO Driver 已枚举并完成初始化，但开始播放后未在 3 秒内发起读取回调，显式启动超时；错误后可重选 Windows 输出，不回退到外放。ASIO 声道实际打开、多输出实体声卡、蓝牙/热拔插、硬件回送与听感仍待相应实机；不能以自动化通过宣称全部声卡兼容。远程音乐媒体 CORS 有边界测试，本轮未使用用户账号验证所有 CDN 签名音源。安装包未更新，未提交或发布。

最终相关 Node 回归 70/70、架构门禁 27/27 通过；完整原生回归通过后，最后的原生错误处理调整已重建并再次通过 9 个真实 Windows 输出端点检查。隔离桌面实例均已关闭，未播放时选择设备会完成验证后释放原生输出。实现、技术契约及使用指南已同步。
