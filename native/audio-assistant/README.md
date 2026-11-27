# 电音助手原生核心

同一可执行文件的 `--playback-output` 模式由 `PlaybackOutputContext` 接收有界 PCM，不加载 DSP；`PlaybackOutputs` 拥有 WASAPI / DirectSound / WaveOut 实际设备及已安装 ASIO 驱动的枚举和创建，助手最终输出复用此工厂。两种模式由 Electron 分开持有，避免进程采集捕捉自身处理输出；启动和释放契约见 [播放输出生命周期](../../docs/reference/desktop/main.md#内置播放原生输出)。ASIO 输出与 Windows 录音/回送是不同能力，未提供 ASIO 输入。

从 2026-10-17 已验证的 `tmp/audio-assistant-demo` 迁入 AudioEngine、StemSeparator、RubberBandProcessor、ProcessCapture、AudioDevices、AppAudioRoute、RouteSession 和 SongMonitor。保留分离模型校验、频谱/重叠处理、变速变调延迟补偿、WASAPI 采集及路由恢复守护；没有重写音频算法。

`AudioSession` 接管原 DemoForm 的会话编排，`Program` 在无可见窗口的 STA 消息循环中处理标准输入/输出命令。Electron 管理该工作程序，不启动额外 Node、Python 或网络服务。客户端关闭或控制管道断开时，工作程序从标准输入读到 EOF，释放会话后退出。`stop` 命令结束当前处理，播放器模式下切歌、换播放器也会停止处理，既有路由守护仍负责恢复。播放器已退出时先恢复端点静音，保留应用输出设置的撤销记录，在其下次自然播放时自动收尾；安全延期不要求手动重开播放器，也不显示为当前原声恢复故障，真实失败继续提示。

播放器暂停并释放音频流时，启动命令可以继续等待输出设备。Electron 每等满 45 秒通过同一条管道查询助手状态。助手应答且仍在启动时继续等待，用户可以停止，也可以恢复播放后完成启动。状态查询本身超时则关闭控制管道，由现有守护恢复原声。

`AudioSession` 在首次启用非零强度的人声分离时，由控制线程校验并预热模型。停止后再次启用可复用该模型，新音轨重新建立重采样器并清空模型的频谱和重叠状态。原声、零强度及纯设备输入可直接启动。路由守护对仍被静音的端点每 500 毫秒重试，端点安全后以 0.5、1、2、4、5 秒间隔等待恢复应用路由，最长等待 5 秒，安装维护信号可提前唤醒。

播放中启用分离时，模型准备成功后才应用新强度或退出原声模式。模型读取失败后可继续调整音量、变调，也可重试分离。输出驱动关闭失败时，DSP 仍等待在途读取结束并拒绝后续回调，再由会话复用或释放模型。

快照报告当前选中或正在采集的 `sourceProcessId`，由 Electron 确认是否属于本实例。内置播放器在音源端变速，采集 DSP 始终保持 1×；本地文件继续由现有 Rubber Band 处理倍速。具体内部播放与恢复行为见[播放参考](../../docs/reference/frontend/playback.md#2-播放主流程)。

构建与运行资源见 [构建参考](../../docs/reference/engineering/build.md#电音助手原生资源)。SDK 由仓库根 `global.json` 固定为 .NET 10.0.404，项目目标为 `net10.0-windows10.0.19041.0`；本目录及原生检查项目各自提交 NuGet `packages.lock.json`，构建和检查均先 locked restore、再 `--no-restore` publish。IPC 见 [桌面桥](../../docs/reference/desktop/preload.md#电音助手)，数据位置见 [存储](../../docs/reference/backend/storage.md#电音助手本机数据)。应用版本不从 `tmp` 加载源文件或运行库。

设备输入由 `DeviceCapture` 负责，录音端点与播放端点回送复用现有 WASAPI 共享路径。按实际输入格式转换、映射声道后进入现有处理核心；设备模式默认不做音乐分离、不触碰播放器隔离路由。来源、回送限制和退出行为见[桌面生命周期](../../docs/reference/desktop/main.md#电音助手生命周期)。`DeviceInputChecks` 使用合成 PCM 检查声道、格式转换、旧设置兼容和回送冲突，不录制用户输入。

`AudioDevices.OpenEndpoint(id, flow)` 解析活动端点并校验方向：录音使用 `DataFlow.Capture`，回送与播放输出使用 `DataFlow.Render`；`DescribeInput` 继续封装输入格式读取。方向不符时拒绝端点，错误提示区分请求的输入/输出设备。`DeviceInputChecks` 在存在活动端点时只读检查这两种方向及错误提示，不启动录制。

## 验证

设备采集缓冲按设备的块对齐格式容纳约 500 ms。写满时丢弃放不下的新帧，设备停止通知仍会结束会话。输入和输出电平分别记录两次状态采样之间的最高值，状态文字使用同一窗口的输入峰值。

`NativeChecks` 的半速用例按 WaveOut 的设备块大小读取音频（48 kHz 双声道，每块 2,400 帧）。输入结束后，只要变速器仍有尾音，`DspSource` 就继续填充当前块。只有最后一块可以短读，避免 WaveOut 在尾音之间补入静音。切换原声对比时先播完已经送入变调器的样本，再让新输入只经过音量处理。

ASIO 本地文件首次读到 EOF 后，从最后一个有效输出帧起按驱动回调累计静音帧，末块补齐的静音也计入。驱动报告正输出延迟时，基础余量取报告值与一个缓冲周期中的较大者。未报告正延迟时，基础余量为两个缓冲周期，除下述 Steinberg 内置驱动外还设有 500 ms 下限（一个控制轮询周期，按输出采样率折算）。控制线程在满足余量的首次轮询释放会话，随后即可换歌。空文件在确认 EOF 的首次轮询即可释放。实际输出延迟超过余量时仍可能截去尾音。驱动中断回调时，帧计数也会停住。手动停止直接调用驱动释放，允许丢弃队列中的音频。

Steinberg built-in ASIO Driver 使用 NAudio 2.2.1 的常规缓冲交换回调拉取音频。本地文件自然结束时，为该驱动的 Windows 输出队列额外保留 100 ms，按实际输出帧计数。已登记的驱动尚未探测或暂时返回零个输出时，菜单保留“连接待检查”入口，设备恢复后可重新选择。驱动返回实际声道后，助手先缓存名单，再校验选择。若已保存的声道超出范围，本次打开会失败，刷新后该声道显示为不可用。

首次补齐音频组件时，300 秒内写入新的下载字节会重新计时。版本目录发布成功后，若旧目录仍被占用，已校验的新组件可直接启动，后续准备会清理过期的替换目录。

- `npm run test:audio-native -- --synthetic-streams` 使用合成 PCM、临时 WAV 和 NAudio 的内存回调，检查时钟偏差、尾音、原声切换、峰值和 ASIO 文件结束。驱动关闭、实际听感和设备长时间稳定性需要对应声卡验收。
- `npm run test:audio-native -- --state-frames` 检查完整快照、电平帧和空闲采样。要用原生帧复验桌面桥，可在命令末尾追加输出路径 `tmp/audio-state-frames.json`，将 `LIRA_TEST_AUDIO_STATE_TRACE` 设为该路径后运行 `node --test test/desktop/audio-assistant-state-frames.test.js`。

`test/desktop/audio-assistant-native/NativeChecks.cs` 迁入原样品的 DSP 行为检查，覆盖精确直通、音高/速度/时长、连续调参、短尾及切歌/换播放器检测。测试工程直接编译这里的源码，资源来自已构建的 `build/audio-assistant/vendor`；构建中间产物与输出放入仓库 `tmp/`。原生恢复检查覆盖安全延期、真实失败、守护身份、记录保留、安装维护退出和状态变化。Electron 的隔离验证使用生成的静音 WAV，不录制用户歌曲，也不修改用户播放器或设备路由。
