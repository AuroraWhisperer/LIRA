# 电音助手原生核心

从 2026-10-17 已验证的 `tmp/audio-assistant-demo` 迁入 AudioEngine、StemSeparator、RubberBandProcessor、ProcessCapture、AudioDevices、AppAudioRoute、RouteSession 和 SongMonitor。保留分离模型校验、频谱/重叠处理、变速变调延迟补偿、WASAPI 采集及路由恢复守护；没有重写音频算法。

`AudioSession` 接管原 DemoForm 的会话编排，`Program` 在无可见窗口的 STA 消息循环中处理标准输入/输出命令。Electron 管理该工作程序，不启动额外 Node、Python 或网络服务。停止、切歌、换播放器、关闭客户端或控制管道断开均结束当前处理；既有路由守护仍负责恢复，播放器已退出时保留恢复记录。

构建与运行资源见 [构建参考](../../docs/reference/engineering/build.md#电音助手原生资源)。IPC 见 [桌面桥](../../docs/reference/desktop/preload.md#电音助手)，数据位置见 [存储](../../docs/reference/backend/storage.md#电音助手本机数据)。应用版本不从 `tmp` 加载源文件或运行库。

## 来源

安装资源中的模型文件统一命名为 `vendor/lira.onnx`，仅改变文件名，不改变模型权重、哈希或推理结果。开发用转换记录 `qq-model.json`、`rubberband.json` 不进入安装资源，避免分发本机路径；第三方许可证与版权声明保留，界面不展示模型来源。

- QQ Split 模型沿用本机 QQMusic2241.17.05.33 的原权重及已验证的 6 帧 ONNX 图。当前 SHA-256：`ECA41B447DF6C0C9BB3B0B419F46EAB485AFEA41BF0A6F25B44F6514EC070E05`。本机资源的 `qq-model.json` 保留转换记录；此模型没有随迁入源码获得再分发授权。
- Rubber Band 3.3.0 为官方源码构建的 Windows x64 R3 Finer 库，SHA-256：`690E57931FC5ED1B982B85969754603928208F8DB429FC99326DE115567B6478`；保留其 GPL-2.0-or-later 声明及商业许可说明。不使用 QQ 私有变调 DLL。
- NAudio、ONNX Runtime 与 EarTrumpet 路由 ABI 参考的原许可声明随本机构建资源保留。模型和原生二进制均不提交 Git；本次构建供本机验证，不是分发授权证明。

## 验证

`test/desktop/audio-assistant-native/NativeChecks.cs` 迁入原样品的 DSP 行为检查，覆盖精确直通、音高/速度/时长、连续调参、短尾及切歌/换播放器检测。测试工程直接编译这里的源码，资源来自已构建的 `build/audio-assistant/vendor`；构建中间产物与输出放入仓库 `tmp/`。Electron 的隔离验证使用生成的静音 WAV，不录制用户歌曲，也不修改用户播放器或设备路由。
