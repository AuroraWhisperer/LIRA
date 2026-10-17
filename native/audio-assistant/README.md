# 电音助手原生核心

从 2026-10-17 已验证的 `tmp/audio-assistant-demo` 迁入 AudioEngine、StemSeparator、RubberBandProcessor、ProcessCapture、AudioDevices、AppAudioRoute、RouteSession 和 SongMonitor。保留分离模型校验、频谱/重叠处理、变速变调延迟补偿、WASAPI 采集及路由恢复守护；没有重写音频算法。

`AudioSession` 接管原 DemoForm 的会话编排，`Program` 在无可见窗口的 STA 消息循环中处理标准输入/输出命令。Electron 管理该工作程序，不启动额外 Node、Python 或网络服务。停止、切歌、换播放器、关闭客户端或控制管道断开均结束当前处理；既有路由守护仍负责恢复，播放器已退出时保留恢复记录。

快照报告当前选中或正在采集的 `sourceProcessId`，由 Electron 确认是否属于本实例。内置播放器在音源端变速，采集 DSP 始终保持 1×；本地文件继续由现有 Rubber Band 处理倍速。具体内部播放与恢复行为见[播放参考](../../docs/reference/frontend/playback.md#2-播放主流程)。

构建与运行资源见 [构建参考](../../docs/reference/engineering/build.md#电音助手原生资源)。IPC 见 [桌面桥](../../docs/reference/desktop/preload.md#电音助手)，数据位置见 [存储](../../docs/reference/backend/storage.md#电音助手本机数据)。应用版本不从 `tmp` 加载源文件或运行库。

## 验证

`test/desktop/audio-assistant-native/NativeChecks.cs` 迁入原样品的 DSP 行为检查，覆盖精确直通、音高/速度/时长、连续调参、短尾及切歌/换播放器检测。测试工程直接编译这里的源码，资源来自已构建的 `build/audio-assistant/vendor`；构建中间产物与输出放入仓库 `tmp/`。Electron 的隔离验证使用生成的静音 WAV，不录制用户歌曲，也不修改用户播放器或设备路由。
