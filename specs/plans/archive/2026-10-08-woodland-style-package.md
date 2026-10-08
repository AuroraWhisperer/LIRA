# 林间花信外置样式包实施计划

**Status:** Completed — 外置 ZIP、原生客户端/画布兼容、实际 ASAR 排除及定向验证完成；未重建或发布 NSIS 安装器。

**Goal:** 排除不需要分发的制作文件，将林间花信以 `output/林间花信-全屏礼物感谢样式-1.0.0.zip` 交付；从「更多样式」导入后保留客户端设置、原生播放布局与画布尺寸。

**Architecture:** 沿用 schemaVersion 2 资源样式、现有 inspect/install/list 接口和 component-media 不可变资源。增加受信 `woodland-gift-frame` 预设，继续使用现有礼物队列、DOM/CSS 和播放器；旧静态视频路径读取已安装官方包，兼容既有画布。

**Tech Stack:** Node.js 24、Electron 43、原生 ESM/CSS、现有 yauzl 与确定性 ZIP 写入代码。

## 约束、现状与归属

- 用户要求保留布局和参数，素材不转码：2K/30fps/8 秒视频、1920×1080 逻辑画布、头像 96px、感谢行 38px、最低 26px；启用和触发金额继续由 `giftFrameEnabled` / `giftFrameThresholdRmb` 拥有。
- 当前 `public/**/*` 带入 28.93 MB 视频和 3.19 MB 离线合成输入。`gift-effects.html` 固定引用视频；导入链已支持资源预设，gift-frame 暂无原生样式参数字段。
- 资源合同：`public/js/shared/component-resource-style.js`、`src/server/component-style-library.js`；分发：`package.json`、`scripts/package-guard-nautical.js` 及新增林间花信导出脚本。
- 消费方：`gift-effects-frame.js`、`gift-frame-player.js`、`gift-effects-component.js`、客户端 `gift-frame.js` / `component-style-client.js`、组件目录 `scene-extra-components.js`。
- 兼容媒体由 server 层读取既有组件样式存储，继续通过已校验的 `/component-media/` 提供资源；不新增权限、IPC、存储格式或业务设置。
- 保留所有既有用户修改。不提交、不发布、不修改用户数据；运行证据与构建放入 `tmp/`，交付 ZIP 按用户要求放入 `output/`。
- 不裁剪未核实的生产依赖，不修改其它特效、视频质量或礼物触发规则。

## 实施与验证

- [x] **资源与分发。** 注册 `{ type: 'gift-frame', config: {}, size: [1920, 1080], resources: [WOODLAND_GIFT_VIDEO], sheets: [] }`。从现有航海旗帜导出脚本提取原有 stored ZIP 写入器并复用，生成 `lira.woodland-gift-frame` / `1.0.0` 清单、原始视频、缩略图与使用说明。通过真实导入接口验证版本、资源 SHA-256、单组件分类、重复导入和资源范围读取。
- [x] **播放与兼容。** 原生播放器接收导入的视频地址，保留 DOM、CSS、时间轴和队列。旧静态视频地址仅解析官方已安装预设的媒体地址，GET/HEAD 返回不缓存的重定向；无包返回 404，移出可选库后保留既有画布的媒体。验证旧链接、Range、不同 HTTP 方法及缺少资源的失败语义；路径采用严格相等匹配。
- [x] **客户端与画布。** 保留原触发/模拟设置，修正时长说明为 8 秒；导入卡片直接加入画布，不显示空的参数面板；移除无素材的内置样式卡片。模拟预览无包时提示导入，导入后仍复用既有画布图层。验证 1920×1080 默认尺寸、既有几何信息、保存/重载、原头像与文字位置、修改预览输入及真实事件队列。
- [x] **打包清理。** 排除完整 woodland 素材目录、其外置预览、AGENTS.md、依赖 source maps 及已确认的制作说明/元数据。真实 electron-builder 过滤器和隔离 unpacked 构建检查排除生效，受信渲染代码、共享头像和许可证保留。
- [x] **文档同步。** 更新分发事实源、overlay 资源预设合同、API 旧路径说明与素材包用户指南；客户端手册同步 8 秒、导入步骤与实际 Electron 截图，测试事实源登记新回归。计划归档并更新索引。

## 验证命令与运行检查

- 使用已有 `tmp/release-5.1.3/runtime/node-v24.21.0-win-x64/node.exe` 执行直接受影响的 packaging-scope、component-styles、gift-frame-controller/draft/queue、gift-effects-overlay、canvas-gift-components 测试；扩展真实 Electron 测试覆盖 ZIP 文件选择、导入、原生预览和画布保存。
- `node scripts/package-woodland-gift-frame.js` 生成交付文件。隔离运行 Electron fixture，不启动用户主应用或使用真实资料。
- `node scripts/check-js.js`、`npm run verify:docs`、`npm run verify:architecture`；用本地 Electron 在 `tmp/woodland-package-build/` 构建目录产物（publish never），检查最终 ASAR 文件清单与完整性。
- 最后审阅任务差异、`git diff --check` 和 `git status --short`。不因当前工作区其它并行修改而扩展修复范围。

## 失败处理与完成条件

失败时保留源码素材及既有用户状态，诊断当前失败后重跑受影响检查；仅撤回本任务补丁，不做整仓回滚。旧客户端对未知预设维持提示更新的既有行为。

完成条件：ZIP 已生成，实际导入、客户端设置与画布播放/保存验证通过，安装包排除规则与实际 ASAR 一致，文档同步，任务差异已检查。不得把未跑的安装器或实播验证记为通过。

## 完成证据（2026-10-08）

- 交付 ZIP：28,979,417 字节；SHA-256 `0d8ca13d90b408aa8a5e6d3b5a59b4c0af8a8ad8f29b34abfdfa767058d2dea4`。最终文件与导出函数生成内容逐字节一致。成片未转码，视频 SHA-256 `ac171ccd125ce47e9329834267e6d736e53efd8617465826ee38bde1d99c96d8`。
- 定向首批 25 项（包 API、打包、播放器/草稿与礼物 overlay）及现有 component-styles 19 项通过；画布礼物、组件能力、队列与场景配置的原 22 项并行选择通过。首次画布保存的 6 秒等待超时在加入状态诊断后未再次复现，未据此改动生产保存逻辑，也未执行全仓压力测试。
- 新 Electron 回归通过：当前桌面原生「选择文件」入口、缺包提示、重复导入无副本、默认 20 元及未启用状态、自定义 35 元及启用状态保留；原生视频 2560×1440/8 秒、逻辑画布 1920×1080、头像 96px 与字号 38px；图层调整为 960×540 后保存、再次预览及重载均保持。测试只替代操作系统文件选择结果，其余走真实应用接口。
- 另完成隔离 Electron 和画布截图检查，截图与构建检查结果在 `tmp/woodland-qa/`；客户端手册的旧截图已替换。验证进程和隔离用户目录已清理，无真实用户数据。
- 当前并行导入简化工作将入口改为「选择文件」并使用原生 picker；测试和本 ZIP 说明同步该入口。初版测试使用旧 filechooser 等待而超时，已适配；新增开关断言改为点击可见 label 后通过。
- 使用 Node 24.21.0：1,375 个 JavaScript 语法检查通过；26 项架构检查通过；文档与测试分组 19 项通过；使用手册 15 项通过。首次语法运行因验证期间文件修改被拒绝记录，源码定稿后重跑通过；计划缺少 Status 的文档失败已补正。
- 最终本地 `electron-builder --win --x64 --dir --publish never --config.electronDist=node_modules/electron/dist --config.directories.output=tmp/woodland-package-build` 成功。`app.asar` 为 41,510,908 字节，SHA-256 与完整性清单一致；被排除目录/文件零匹配，播放器、CSS、默认头像与许可证保留。旧安装包中的应用 ASAR 为 74.57 MB；此处是应用归档大小，未测新 NSIS EXE 的压缩大小。
- 任务源码与编辑前快照逐项对照，保留工作区并行修改；`git diff --check` 通过。ZIP 和运行证据位于忽略目录，未提交、打标签或发布。
