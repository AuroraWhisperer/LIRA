# 电音助手原生核心

同一可执行文件的 `--playback-output` 模式由 `PlaybackOutputContext` 接收有界 PCM，不加载 DSP；`PlaybackOutputs` 拥有 WASAPI / DirectSound / WaveOut 实际设备及已安装 ASIO 驱动的枚举和创建，助手最终输出复用此工厂。两种模式由 Electron 分开持有，避免进程采集捕捉自身处理输出；启动和释放契约见 [播放输出生命周期](../../docs/reference/desktop/main.md#内置播放原生输出)。ASIO 输出与 Windows 录音/回送是不同能力，未提供 ASIO 输入。

从 2026-10-17 已验证的 `tmp/audio-assistant-demo` 迁入 AudioEngine、StemSeparator、RubberBandProcessor、ProcessCapture、AudioDevices、AppAudioRoute、RouteSession 和 SongMonitor。保留分离模型校验、频谱/重叠处理、变速变调延迟补偿、WASAPI 采集及路由恢复守护；没有重写音频算法。

`AudioSession` 接管原 DemoForm 的会话编排，`Program` 在无可见窗口的 STA 消息循环中处理标准输入/输出命令。Electron 管理该工作程序，不启动额外 Node、Python 或网络服务。停止、关闭客户端或控制管道断开均结束当前处理；播放器模式还会在切歌、换播放器时停止，既有路由守护仍负责恢复。播放器已退出时先恢复端点静音，保留应用输出设置的撤销记录，在其下次自然播放时自动收尾；安全延期不要求手动重开播放器，也不显示为当前原声恢复故障，真实失败继续提示。

快照报告当前选中或正在采集的 `sourceProcessId`，由 Electron 确认是否属于本实例。内置播放器在音源端变速，采集 DSP 始终保持 1×；本地文件继续由现有 Rubber Band 处理倍速。具体内部播放与恢复行为见[播放参考](../../docs/reference/frontend/playback.md#2-播放主流程)。

构建与运行资源见 [构建参考](../../docs/reference/engineering/build.md#电音助手原生资源)。SDK 由仓库根 `global.json` 固定为 .NET 10.0.402，项目目标为 `net10.0-windows10.0.19041.0`；本目录及原生检查项目各自提交 NuGet `packages.lock.json`，构建和检查均先 locked restore、再 `--no-restore` publish。IPC 见 [桌面桥](../../docs/reference/desktop/preload.md#电音助手)，数据位置见 [存储](../../docs/reference/backend/storage.md#电音助手本机数据)。应用版本不从 `tmp` 加载源文件或运行库。

设备输入由 `DeviceCapture` 负责，录音端点与播放端点回送复用现有 WASAPI 共享路径。按实际输入格式转换、映射声道后进入现有处理核心；设备模式默认不做音乐分离、不触碰播放器隔离路由。来源、回送限制和退出行为见[桌面生命周期](../../docs/reference/desktop/main.md#电音助手生命周期)。`DeviceInputChecks` 使用合成 PCM 检查声道、格式转换、旧设置兼容和回送冲突，不录制用户输入。

`AudioDevices.OpenEndpoint(id, flow)` 解析活动端点并校验方向：录音使用 `DataFlow.Capture`，回送与播放输出使用 `DataFlow.Render`；`DescribeInput` 继续封装输入格式读取。方向不符时拒绝端点，错误提示区分请求的输入/输出设备。`DeviceInputChecks` 在存在活动端点时只读检查这两种方向及错误提示，不启动录制。

## 验证

`test/desktop/audio-assistant-native/NativeChecks.cs` 迁入原样品的 DSP 行为检查，覆盖精确直通、音高/速度/时长、连续调参、短尾及切歌/换播放器检测。测试工程直接编译这里的源码，资源来自已构建的 `build/audio-assistant/vendor`；构建中间产物与输出放入仓库 `tmp/`。原生恢复检查覆盖安全延期、真实失败、守护身份、记录保留、安装维护退出和状态变化。Electron 的隔离验证使用生成的静音 WAV，不录制用户歌曲，也不修改用户播放器或设备路由。
