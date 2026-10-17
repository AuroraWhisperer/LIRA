# 电音助手音量范围扩展

Status: Completed

## Goal / Compatibility

输出音量由 0–100% 扩展至 0–200%，默认仍为 70%，原有保存值含义不变。100% 为单位增益，200% 为两倍振幅；保留既有输出幅度钳位，不添加压缩器、驱动或新依赖。仅修改客户端，原 tmp 样品保持原状。

## Ownership / Changes

`public/js/admin/audio-assistant-controls.js` 扩展滑块和数字框，并复用问号说明增益和失真；`src/electron/ipc/audio-assistant-ipc.js` 校验新上限；`native/audio-assistant/AssistantSettings.cs`、`AudioSession.cs` 同步读取/写入范围，继续使用既有 `OutputVolume`。不改变命令形状、权限边界或 DSP 算法。

## Verification

- [x] IPC 允许 200、拒绝负数和 201；原生协议验证 200 的保存与重载。
- [x] 现有 NativeChecks 验证 0/100/200% 数值输出以及放大后的幅度钳位；未打开声卡。
- [x] 原生组件重建成功，`npm run test:audio-native` 全部通过；`node --experimental-vm-modules --test test/desktop/audio-assistant-ipc.test.js test/admin/audio-assistant-controls.test.js` 4 项通过；三个受影响 JS 文件语法检查通过。
- [x] 存储参考、问号说明与应用内指南同步，文档门禁通过；diff 和工作区状态已审阅，空白检查通过。

只扩展既有控件元数据和数值边界，未改布局，未另建 UI 自动化。原生合成数值检查覆盖实际增益与保存；真实播放器听感和安装包不在本次验收范围。旧临时数据清理的策略拒绝保持有效，未尝试绕过。

## Failure Handling / Done When

构建失败不替换用户实例；不重启用户客户端或改动其音量。功能、边界测试、文档及资源构建完成即结束，不构建安装包。临时测试状态仍使用既有 repo tmp 隔离目录。
