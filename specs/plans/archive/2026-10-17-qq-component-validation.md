# QQ 原组件与 LIRA 适配验证 Implementation Plan

Status: Completed

**Goal:** 验证本机 QQ 变调组件的真实输出，以及它能否在保持 LIRA 主程序和分离推理为 x64 的前提下接入现有音频链。

**Architecture:** 验证程序放入 `tmp/audio-assistant-qq/component-validation-1017/`。x86 原生辅助程序只加载本机 QQ DLL 并处理生成 PCM；x64 检查宿主沿用当前 LIRA 的 DSP 接口和测试，在标准输入/输出上传递音频。此次首先提供适配证据，不替换正在使用的构建或修改用户播放器。

**Tech Stack:** Windows、MSVC x86、C#/.NET 8 x64、QQMusic2241.17.05.33 `qmcpcom.dll`、现有 NAudio / ONNX Runtime。

## Global Constraints

- 用户已选择“验证原组件，主要是和我的 lira 项目要适配”，接受原组件验证使用 x86 辅助进程；不是把 QQ DLL 改成 x64。
- 原生核心已有未提交修改；冻结副本用于本次检查，保留所有用户修改、设置及路由恢复记录。
- 不操作真实 QQ / 网易云，不录制用户歌曲，不改变声卡路由、系统音量或静音状态。
- 不提交、发布或更新安装包。临时程序和产物全部位于仓库 `tmp/`。
- 直接加载 QQ DLL、调用 QQ 封装接口、重现 QQ 界面实际处理链是不同证据等级，报告分别说明。

## Current Behavior And Ownership

`native/audio-assistant/RubberBandProcessor.cs` 当前加载自行编译的 `rubberband-x64.dll`；分离模型仍来自 QQ。`AudioEngine.cs` 的 `DspSource` 只消费 `Tempo`、`PitchSemiTones`、`PutSamples`、`ReceiveSamples`、`Flush`、`Dispose`。`AudioSession` 和 Electron 管理播放与恢复，不应因验证改变其对外协议。

本机 QQ DLL 的 PE Machine 为 `0x14c`，导出 `rubber_band_*` 封装和 `rubberband_*` C API。已观察到封装以 `0x20000001` 创建 Rubber Band R3，升降调参数限制为 ±12；当前 LIRA 选项为 `0x34010001`，不能声称配置完全一致。截图界面是否调用该封装尚未验证。

## Tasks And Verification

### 1. 验证原 DLL 的独立调用

Files: `tmp/audio-assistant-qq/component-validation-1017/qq-component.cpp`、`build-helper.cmd`。

- [x] 用原生 x86 程序加载安装目录的 `qmcpcom.dll`，记录文件哈希、实际加载路径和依赖。
- [x] 以生成的 48 kHz 双声道正弦测试封装的初始化、±12 / 0 / +3 半音、输出帧数、有限值、尾部和销毁。
- [x] 单独验证 DLL 导出的 C API 支持 0.5 / 1 / 2 倍及组合变调，不把该结果描述为已识别 QQ 界面的倍速分支。

已确认待验证接口：

```cpp
void* rubber_band_create_inst(int sampleRate, int channels);
void rubber_band_set_pitch_parameters(void* state, float semitones);
int rubber_band_processf_in(void* state, const float* samples, int sampleCount, int* available);
int rubber_band_processf_out(void* state, float* samples, int capacity, int* written);
void rubber_band_destroy_inst(void** state);
```

签名依据安装文件的导出与调用反汇编；运行检查必须进一步验证，失败不得接入产品。

### 2. 验证 x64 LIRA 音频链适配

Files: 同目录 `frozen/`、`bridge/RubberBandProcessor.cs`、`checks/`。

- [x] 冻结当前 native 核心和已存在的 NativeChecks，不修改检查阈值。
- [x] 用 x86 辅助程序处理 PCM，x64 适配器保持现有六个成员接口；仅首次实际使用效果时启动，Dispose 关闭管道并等待退出。
- [x] 对现有精确直通、8 组音高/速度/时长、连续调参、4 组短尾执行回归；明确报告原封装的行为差异。
- [x] 检查重复启动/停止、宿主管道关闭、辅助进程异常的传播与退出，不产生遗留进程。

接口保持：

```csharp
public double Tempo { set; }
public int PitchSemiTones { set; }
public void PutSamples(ReadOnlySpan<float> samples, int frames);
public int ReceiveSamples(Span<float> destination, int frames);
public void Flush();
public void Dispose();
```

### 3. 测量并报告采用条件

Files: 同目录 `results/`、`result.md`；本计划与索引收尾。

- [x] 同一生成音、同一 x64 核心，对照现有 x64 库与 QQ 原 DLL 辅助程序，测吞吐、每块耗时、首次输出和内存/依赖大小。
- [x] 用真实 LIRA 原生宿主的 stdin/stdout 协议运行隔离文件输入，输出静音；验证 start/stop/close 和辅助进程释放。
- [x] 报告已证实与未证实的边界、适配代价及是否具备替换条件。同步验证说明，运行文档门禁、diff 检查与状态审查。

### 4. 对照既有优化及其原因

用户补充要求核对「评估原生通道和音乐来源」对话（`01a14895-2443-7ee2-aaef-cbbeae1da21d`）。

- [x] 核对该对话中的优化、验证记录以及当前正式源码，区分已采用的修改、未采用的候选和纯检查。
- [x] 判断每项开销属于分离模型、音频采集、来源/设备扫描或变调组件，避免把原有成本归因于此次换组件。
- [x] 在包含现有优化的 LIRA 核心上运行 QQ 原组件回归与同条件对比，报告哪些优化继续有用及本次引入的额外开销。

## Failure Handling And Done When

仅终止本任务创建且路径核验属于验证目录的进程。二进制接口不符、崩溃、长度漂移或实时余量不足时保留诊断，不替换 LIRA；没有用通用上游版本冒充 QQ 原组件的回退。完成指本轮原组件及适配实验有可复核结论，产品替换和真实音乐听感不在未经验证的结论中。

## 完成证据与限制

[完整报告](../../../tmp/audio-assistant-qq/component-validation-1017/result.md) 包含原 DLL 路径和哈希、未修改的 NativeChecks、10 项实际宿主生命周期结果、2 倍速时长复测、30 秒自有进程实时采集，以及各 3 轮对照数据。QQ 辅助程序方案合计 CPU 在已测变调场景下降约 11–27%；合计私有内存增加约 13–18 MiB，首块读取增加约 27–49 ms，不能声称各项指标都更好。

原封装的 EOF 差异通过 C API 结束补偿解决；帧数使用原 C# 中点取偶规则，原有回归阈值不变。链接对话的设备、分离及采集优化仍在当前正式核心中，本轮保留它们；未将未采用的静音跳算或频谱候选当作已交付功能。

正式源码 13 文件与开始时摘要相同，没有替换运行构建、用户播放器或正式设置；没有验证 QQ 界面完整私有链、真实歌曲听感、其他版本/设备或安装包。正式接口及使用说明未改变，相关文档无需修改。本轮同步验证资料与计划索引，控制层 5 项回归通过。

本轮清理约 877.46 MiB 重复测试构建的命令被自动审批以 `blocked by policy` 拒绝，未执行、未绕过；资料保留。这是未完成的清理限制，不是音频检查失败，也不代表正式采用或打包已完成。
