# 礼物边框与大航海感谢画布组件

Status: Completed

需求：用户要求将礼物边框和大航海感谢作为两个不同组件加入画布。

## 目标与边界

画布组件库提供两个独立入口、真实效果缩略图、独立位置和尺寸，保存并应用后组合直播源分别播放对应事件。复用原动画、队列和礼物姬启用规则；不改礼物记账、金额门槛、旧 `/gift-effects` 地址或权限模型，不增加依赖、数据库迁移和服务器服务。

## 当前行为与归属

`shared/scene-extra-components.js`、`admin/scene-extra-preview.js` 管理独立画布组件，scene service/store 保存并发布。两个效果目前只在 `overlays/gift-effects.js` 通过既有 overlay WebSocket 播放。`server/runtime-transport.js` 负责已结算礼物的显示事件，管理预览经 `server.js` 广播。契约归属 `docs/reference/frontend/overlays.md` 与 `docs/reference/backend/api.md`，遵守 ADR-0022 的父页授权、无凭据子页和 HTTP 场景投影边界。

## 实施与验证

补充需求：用户要求直接在画布预览，不再提供这两项的独立预览页面入口。礼物边框保留观众、礼物和数量等模拟参数，点击预览后通过现有 canvas 会话的 display 数据传给对应画布组件；模拟参数不写入场景配置、不触发直播事件。礼物姬移除旧嵌入预览与来源地址区，改为打开/选中对应画布组件。短入口沿用 canvas 会话，独立类型不建立新的默认配置会话。

- [x] 注册 `gift-frame` / `guard-thanks` 独立类型、组件库图标/缩略图和示例；复用原页面的组件模式，只从父页接收数据，不建立 WS 或读取管理接口。验证类型一致性、独立参数、预览与几何保存。
- [x] 场景 runtime 维护按账号 scope/epoch 隔离的有界只读事件窗口，复用 `projectWebSocketPayload`。现有实际与手动预览事件同时进入窗口。父场景首次读取只建立基线，随后按序列投递，准备中缓存、交付后不重播；断线/撤销清理。验证投影裁剪、账号切换、容量限制、准备/重新发布和断线。
- [x] 隔离浏览器 fixture 验证两个组件添加、保存、发布、事件分类、重复轮询与刷新不重播、无子页 API/WS。使用已有浏览器 QA 路径产出缩略图与临时截图。更新契约说明并完成 diff 检查。

命令：`node --experimental-vm-modules --test test/scenes/scene-extra-components.test.js test/admin/scene-component-definitions.test.js test/scenes/scene-gift-events.test.js test/scenes/scene-renderer-state.test.js test/scenes/scene-runtime.test.js`；`node --experimental-vm-modules --test test/admin/canvas-gift-components.test.js test/admin/canvas-component-library.test.js`；`npm run verify:quick`；`git diff --check`。

## 兼容与失败处理

保留旧地址同时显示礼物边框、官方特效及大航海感谢的行为。场景能力只由父页持有，子页保持 allow-scripts sandbox。事件窗口不保存历史，不影响业务数据，首读、断线恢复和账号切换不补播历史。保留用户已有 `song-layout.css` 修改。失败只修复/撤回本任务所改行，临时数据放根目录 tmp，不操作真实账号数据或用户运行进程。

## 完成条件

两个组件可独立添加、编辑几何、保存并播放各自事件；原页面兼容；上述针对性测试和相关架构/语法门禁通过；契约同步，diff 无生成临时文件或敏感数据。

## 验证结果

2026-10-03 完成。两个独立组件已接入组件库、画布编辑/发布和事件投递；礼物姬预览按钮直接打开并选中画布组件，重复打开不新增重复图层。礼物边框模拟参数只用于画布预览，旧 `/gift-effects` 路由保留兼容及内部渲染用途。

- 类型定义、事件窗口、场景渲染与 runtime HTTP 测试通过，覆盖 owner/epoch 隔离、事件裁剪去重、容量边界、准备期间缓存及刷新/断线不补播。
- `canvas-gift-components`、`canvas-component-library`、`component-preview-links` 浏览器测试通过，覆盖设置入口、模拟参数更新、独立尺寸/配置保存、缩略图、发布后事件分类及子页无 API/WS/凭据。
- 礼物边框配置、控制器、队列和管理草稿，以及大航海感谢相关测试通过；`component-preview` 传输测试通过。
- 既有 `test/desktop/danmaku-canvas-electron.test.js` 隔离 Electron 回归通过；真实渲染缩略图已目视检查，界面检测无发现。
- `npm run verify:quick` 通过（文档 10 项、JavaScript 语法 1206 个文件、架构 22 项）；`git diff --check` 通过。
- 所有事件验证使用隔离 fixture 的合成事件，未使用真实 Bilibili 账号或进行实播验收。临时截图位于 `tmp/canvas-gift-components/`，本任务浏览器与两个 fixture 服务均已关闭。
