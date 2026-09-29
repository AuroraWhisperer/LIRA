# 弹幕姬画布编辑器实施计划

**Status:** Completed

用户已确认实施；固定样式默认左下角。

## Goal

把本地样式预览升级为左侧设置、右侧直播画布的编辑器，支持分辨率预设、自定义画布、各样式独立区域、数值和八方向拖拽缩放，显式应用后与服务器直播网页一致。

## Current behavior / ownership

`public/js/admin/danmaku-overlay-settings.js` 拥有桌面草稿与现有 Device IPC 保存；`public/js/overlays/danmaku-preview.js` 和 `danmaku.js` 拥有本地合成预览。服务端 `src/modules/streamer/overlay-settings.js` 拥有租户配置与单次 SSE 发布，`public/overlay/app.js` 消费展示配置。现有本地页面已由 CSP `sandbox allow-scripts` 隔离，可嵌入而不能访问父页面凭据。静态模块允许跨源读取。

## Compatibility / non-goals

- 不改变账号、租户、token、现有 URL、认证、字体/滚动方向或弹幕接收链路。
- 不要求 OBS；直播姬等支持透明网页来源的软件使用同一展示链接。
- 旧配置 `layout: null` 保持按来源窗口显示；缺少 layout 的旧 PUT 保留已保存画布。首次在编辑器应用才启用画布。旧服务器缺少 layout 字段时禁用画布保存并明确提示。
- 不改点歌板，不新增依赖/进程/框架，不提交、不部署，保留两个仓库的已有修改。

## Contract / proposed changes

新增可空展示字段 `layout`：`{canvas:{width,height},contentScale,regions:{[style]:{x,y,width,height}}}`。画布整数 320～7680；区域整数，最小64，完全位于画布；九种样式均有记录；contentScale 为0.1～8有限数。未知字段、非数值、越界整体拒绝（INVALID_OVERLAY_LAYOUT），不能部分落盘。

默认画布1920×1080；固定样式尺寸分别380×560、560×600、380×540、640×640、520×540、640×560，距左/下40；随机三种铺满。同宽高比改分辨率时区域与contentScale同比变化；换横竖比保持字体大小、收敛区域到边界。移动和缩放区域不拉伸字体。

共享纯模型随现有双仓库浏览器/Node镜像模式发布，用一致性测试防漂移；渲染层用固定逻辑画布、统一缩放与区域容器，复用既有feed随机布局。桌面预览按钮打开原生dialog内的沙箱iframe；只传展示草稿/状态，通过精确frame source和origin检查接收编辑/应用消息。父页面复用现有显式保存函数和generation/revision保护；关闭销毁frame与监听，换账号关闭编辑器。独立预览无保存权限。

## Milestones / verification

- [x] 模型与协议：新增layout模型，接服务端保存/初始SSE和Electron DTO；测试默认左下角、缩放、越界、原子失败、旧写保留、跨租户不广播。更新三份OpenAPI和fixture。
- [x] 编辑器与渲染：预设、自定义、每样式记忆、位置/尺寸、拖动/八柄、居中/铺满/重置、字号和其它现有参数；预览和正式页共用坐标处理。保存失败/旧服务器不丢草稿。
- [x] 验收与文档：运行两仓相关danmaku/overlay测试、契约和模块边界检查；用隔离HTTP及Electron既有测试入口验证拖拽、重新打开、应用和来源尺寸一致。更新REQ-BILI-006/AC-BILI-005、协议、实现参考与ADR（预览编辑边界）。本任务验收通过，现有全局门禁限制见下文。

命令：客户端 `node --experimental-vm-modules --test test/danmaku/danmaku-layout.test.js test/danmaku/danmaku-overlay-ipc.test.js test/danmaku/server-danmaku-settings.test.js test/danmaku/danmaku-local-preview.test.js`；服务端 `node --require ./test/support/test-mode.cjs --test test/overlay-layout.test.js test/overlay-settings-service.test.js test/overlay-settings-routes.test.js test/overlay-protocol-contract.test.js test/overlay-public-sse.test.js test/overlay-static.test.js`。依改动范围运行两仓文档/契约/架构门禁和已有浏览器测试，记录实际结果及任何既有失败。

## Failure / rollback

保存失败保留草稿；不写旧服务器；非法配置整体拒绝。只通过审阅后的定向补丁回退本任务改动，禁止reset/clean或覆盖用户修改。不触碰真实用户数据；测试拥有并关闭独立进程与临时目录。

## Done when

固定默认左下角；数值/拖动双向同步；样式记忆与分辨率规则通过测试；显式应用经原认证通道保存，重开和正式页一致；旧配置/旧PUT仍工作；协议及文档一致。最后审阅任务diff，两仓 `git diff --check`、`git status --short`，无运行数据或秘密；完成后移入archive并更新索引。

## QA inventory / evidence

- 初始1920×1080和固定左下角：真实Electron截图与数值验收。
- 移动、八向缩放、数值输入、方向键/Shift、区域居中：真实鼠标/键盘Electron回归，保存再打开一致。
- 样式独立记忆、同比分辨率缩放、横竖比例切换保留字体：Electron与纯模型检查。
- 非法负数输入、保存失败后重试：草稿保留；Electron回归覆盖。
- 三种随机样式边界、来源等比缩放、透明背景且无编辑框：服务器浏览器回归覆盖。
- 字体、颜色、背景、滚动方向、礼物图原有行为：既有27项浏览器测试通过（含本任务4项画布测试）。
- Client最终44项、Server最终44项、Electron一项完整交互回归通过。最后模型与路由子集19项、画布和礼物浏览器回归5项通过。
- 客户端 `npm run check` 检查1048个文件通过；最后修改的模型、预览和父窗口模块单独语法检查通过。
- 客户端 `npm run verify:docs` 9项、服务端 `npm run docs:check` 41项通过。
- 真实Electron视觉复核覆盖默认固定样式、区域随机和竖屏；画布、工具栏、状态及应用按钮均完整可见，无横向溢出。左侧设置栏按设计独立滚动。
- 任务diff已审阅，两仓 `git diff --check` 通过，`git status --short` 已核对；保留两仓现有修改，未提交、未部署或重启用户应用。实际效果图保存在仓库外的Codex可视化目录。

Electron首轮直接坐标注入发生在dialog稳定前；增加真实区域点击等待可交互后，八方向拖动全部通过。测试不修改产品等待逻辑。独立持久REPL在过长输入序列后超时，已关闭其确切测试进程；正式回归在finally中关闭Electron并清理临时目录。

最终持久REPL的Electron实例已关闭，其数据目录已清理。早期遗留的 `C:/Users/Tom/AppData/Local/Temp/lira-canvas-qa-HpMZsG` 清理命令被自动审批策略拒绝，未换通道重试；只读检查确认没有本任务Electron进程，目录仍保留。

## Remaining repository-wide limitations

- `npm run verify:architecture`：20/22项通过；失败为任务外现有 `public/css/admin/gift-display.css`（633行）和 `test/gifts/frontend-gift-display-settings.test.js`（632行）缺文件规模评审，以及 `public/js/admin/start-animation.js` 的空catch债务。本任务未更改这些文件或放宽门禁。
- `npm run verify:contracts`：固定服务器revision要求 `a28db3a2ccf5f0fec1626a4fe3bd97a7eb402d1b`，当前服务器HEAD是 `6fffbf2fd71f1231de6f7ba48ca44c4b23af030b`，检查因此拒绝；未擅自更新lock或切换服务器仓库。本次新增契约已由两仓定向DTO/服务/路由/协议测试验证，但不宣称固定revision的全局roundtrip通过。
- 客户端和服务器须共同更新后才能保存并显示新布局；远端部署不在本次授权范围。旧服务器只提供预览并禁用应用，旧配置在第一次应用画布前维持原行为。
