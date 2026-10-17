# 电音助手客户端移植

Status: Completed

## Goal

将成熟试听样品接入客户端：百宝箱提供音乐来源、设备、完整参数和恢复操作；顶部与可拖动贴边入口共用精简面板，仅展示当前歌曲开关、声伴比例、变速和升降调。两处即时同步，开启助手必须显示一种入口，关闭助手停止处理并恢复原声。

## Current Behavior / Ownership

- `tmp/audio-assistant-demo/` 为当前成熟 C#/.NET 8 实现。复用其 AudioEngine、StemSeparator、RubberBandProcessor、ProcessCapture、AudioDevices、AppAudioRoute、RouteSession、SongMonitor；不改分离权重、延迟补偿或路由恢复事务。
- `public/js/admin/audio-assistant.js` 已拥有入口偏好、拖动、贴边和 popover；保留其 localStorage 键与交互。
- `src/electron/` 拥有受限 IPC、原生子进程生命周期和本机数据位置。复用 `createMainWindowIpcRegistrar`；不新增网络服务。
- `public/js/admin/audio-assistant-controls.js` 消费统一桌面状态并同步两处控件，服务状态以原生会话为准。
- 文档归属：desktop/preload、desktop/main、frontend/app、frontend/pages、engineering/build；用户指引：usage-guide-toolbox-work 与 interactive-tour-config。

## Non-goals / Compatibility

不改变音乐平台登录、曲库、播放队列、公共 HTTP/WS 或系统默认声卡；不安装虚拟声卡，不发布安装包。保留已有未提交修改。实时外部采集仍固定 1 倍速，本地文件支持 0.5–2 倍；切歌/换播放器停止并恢复，不自动开启下一首。界面沿用客户端主题、开关、range 和问号组件。

## Proposed Changes

1. `native/audio-assistant/` 迁入成熟核心与来源说明；新增无可见窗口的标准输入/输出控制宿主，配置与恢复记录位于客户端数据目录，资源位于独立构建目录。原生处理需要 WASAPI、ONNX 与 Rubber Band；保留原生辅助进程是复用成熟实现及隔离音频故障的必要边界，不添加 Node/Python 服务。
2. `scripts/build-audio-assistant.js` 使用已有 dotnet SDK 构建自带 .NET 的工作程序，复用本机样品 vendor；输出 `build/audio-assistant/`，不提交二进制、模型或个人设置。Electron 使用自带 Node；资源清单显式收集构建输出，缺失时给出可操作错误。
3. `src/electron/audio-assistant.js` 与 `ipc/audio-assistant-ipc.js` 管理惰性启动、固定命令、参数校验、状态通知、退出关闭。文件选择复用桌面原生对话框，renderer 不获得任意进程/命令执行能力。
4. 保留入口 owner，新增完整双栏设置、精简共享控件、帮助说明与统一错误状态。任何一处调参即更新另一处；忙碌和自动停止由权威状态回写。

## Milestones / Verification

- [x] `npm run build:audio-assistant` 与 `npm run test:audio-native` 通过。8 组频率/时长/精确直通、连续变速变调、4 组短尾及合成歌曲/播放器变化检测通过；真实隐藏进程 UTF-8、错误后恢复、参数持久化、异常配置归一化及 EOF 退出通过。
- [x] Electron 通信与生命周期：受信主窗口、坏参数、本地文件授权、并发启动、故障重试和退出检查通过；既有 shutdown harness 增加音频 owner 排空用例。
- [x] 界面接入：参数异步写入队列、入口偏好、导航和页面唯一性回归通过。成功后的错误清除与变速百分比单位已按界面复核意见修正；复核结果 ship。
- [x] 隔离 Electron：真实 preload/IPC/原生宿主、独立 data/profile/临时端口；导航前授权路由 200、匿名 401。两入口互斥、拖动贴边、双向同步、文件处理、错误恢复、关闭主开关、原声对比及重载通过；1000×720 快捷面板仍在窗口内。使用自有静音 WAV，输出音量为 0；没有更改用户播放器路由。截图及记录位于 `tmp/audio-assistant-client-qa/`，自有 Electron 和音频进程已退出。
- [x] 同步技术参考与使用指南，语法 1608 文件、架构 27 项、文档 10 项通过；打包范围测试通过，未构建安装包。审阅任务 diff、空白检查与工作区状态，模型/运行库只在忽略的构建目录。

## Verification Evidence / Limits

最终组合命令：`node --experimental-vm-modules --test test/admin/audio-assistant.test.js test/admin/audio-assistant-controls.test.js test/admin/admin-page-composition.test.js test/admin/toolbox-sidebar.test.js test/admin/frontend-usage-guide.test.js test/desktop/audio-assistant.test.js test/desktop/audio-assistant-ipc.test.js test/desktop/electron-main-modules.test.js test/desktop/electron-shutdown.test.js test/engineering/packaging-scope.test.js`。105 项中 104 通过，唯一失败为既有 `screen-color-picker` 主进程依赖未在 shutdown harness 建模；音频新增依赖已建模，音频退出等待用例通过。保留同期取色器修改，不声称该组合全绿。

没有操作用户真实播放器或复验各硬件听感；切歌/换播放器由迁入核心的合成检测用例覆盖，已有成熟路由算法仅改变本机恢复目录，未重写。原生文件选择器复用现有授权模块；隔离 UI 中用自有文件替代系统对话框，不声称该对话框实机复验。自包含原生构建无需另装 Node、Python 或 .NET；构建时仍需 SDK 和已有 vendor。客户端资源已准备，未重启用户实例、提交或发布安装包。

测试、桌面桥/生命周期、存储、构建、前端归属及应用内指南已同步。现有交互导览没有电音助手专属步骤，因此无需增加导览；沿用客户端主题和问号组件，没有新增全局设计体系。原样品及其设置保持原状。

自有测试进程已退出；最后清理隔离 profile / data / 协议测试目录的命令被自动安全策略拒绝（工具返回 `blocked by policy`），未换方式重试。临时数据保留于仓库 `tmp/`；截图和验证记录也保留。

## Failure Handling / Done When

停止或崩溃时由已迁入的路由守护恢复播放器；保留待恢复记录，不删除或覆盖用户数据。仅修改本任务内容，不执行 reset/checkout 或提交。功能、聚焦验证和文档一致后完成；实际歌曲听感与未覆盖硬件限制如实记录。QQ 模型及 Rubber Band 的既有来源/许可说明保留；本任务只准备本机使用，不声称具有第三方模型再分发授权。
