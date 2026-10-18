# 电音助手 Windows 10 兼容修复

**Status:** Awaiting Verification

## 目标与当前行为

修复 Win10 点击「当前歌曲」开关时被误报系统不支持的问题。修复前
`AudioSession.Start()` 要求 Build 20348，阻止全部正式 Win10 客户端进入采集。
原生工程目标已是 Windows 10 19041；`AppAudioRoute` 已依次尝试两种 Windows
音频策略接口，无需新增路由实现。

微软的[示例说明](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/)
标注 20348，但 [OBS 官方采集代码](https://github.com/obsproject/obs-studio/blob/master/plugins/win-wasapi/plugin-main.cpp)
明确采用 19041，[用户指南](https://obsproject.com/kb/application-audio-capture-guide)
说明支持 Win10 2004 起的应用音频采集。本次采用该实际兼容边界。

## 归属与兼容约束

- 原生 owner：`native/audio-assistant/ProcessCapture.cs` 维护采集版本判断，
  `AudioSession.cs` 在变更设备路由前检查它。
- 消费者：`public/js/admin/audio-assistant-feedback.js` 将版本异常转为中文操作建议。
- 技术说明：`docs/reference/desktop/main.md`；用户说明：
  `public/pages/admin/toolbox/usage-guide-toolbox-work.html`。
- 测试：沿用 `test/desktop/audio-assistant-native/NativeChecks.cs` 与
  `test/admin/audio-assistant-feedback.test.js`。
- 保持 IPC、参数和数据格式、DSP、原声隔离、停止恢复、Win11 路径及本地文件分支。
  不安装驱动，不操作用户正在运行的播放器、设备或安装版，不提交或发布。

## 实施与验证

- [x] 将现有 20348 判断提取到采集 owner，增加版本回归并确认 Win10 用例失败。
  判断接口为 `internal static bool SupportsWindowsVersion(Version version)`；
  会话调用 `ProcessCapture.SupportsWindowsVersion(Environment.OSVersion.Version)`。
- [x] 将版本下限修正为 `new Version(10, 0, 19041)`；覆盖 Win10 19041、19044、
  19045，Win11 22000、26100，以及低于下限的 Win10 和 Win8.1。
  更新原生异常与前端提示，明确 Win10 2004 起可用，本地文件仍可选。
- [x] 同步技术说明与应用内使用文档；其他指南、README 和交互式引导没有该版本限制，无需修改；操作步骤和界面布局不变，截图不受影响。
- [x] `npm run build:audio-assistant`：重新生成忽略目录下的原生资源。
- [x] `npm run test:audio-native`：版本边界、DSP、真实隔离管道与恢复检查通过。
- [x] `node --experimental-vm-modules --test test/admin/audio-assistant-feedback.test.js test/admin/frontend-usage-guide.test.js`：21 项通过。
- [x] `Get-Content -Raw public/js/admin/audio-assistant-feedback.js | node --input-type=module --check`：语法检查通过。
- [x] `npm run verify:docs`：10 项通过。首轮因本计划使用中文状态标签失败，改用仓库要求的 `Status` 标签后通过。
- [ ] Win10 实机验证开启、采集、停止与原声还原；本机仅有 Win11，未执行此项。

收尾审阅本次 diff，执行 `git diff --check` 和 `git status --short`，保留并行任务修改。
不重复运行音频回归来代替缺失的 Win10 实机环境；未构建或发布安装包。

## 完成条件与限制

代码不再拒绝 Win10 2004 起的版本；更早版本仍在路由变更前失败并给出明确建议；
聚焦检查通过，技术/用户说明与实现一致，diff 不包含运行时数据或生成二进制。
本机为 Win11，模拟版本测试不等同于 Win10 实机采集验收；该实机验收和安装包
分发结果需单独记录，不通过反复运行本机测试代替。

## 失败处理

采集启动失败继续使用现有 `Fail` / `Stop` 路径恢复原声。构建或测试失败只修复
本次相关原因；需要撤回时仅反向修改本任务 diff，不重置工作区或操作用户进程。
