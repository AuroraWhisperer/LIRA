# 画布入口与直播源加载稳定性

**Status:** Completed

## Goal

组件预览在同一编辑会话中复用一张画布和一个入口；直播源保持固定地址。修复首次加载等待隐藏 iframe 动画帧导致超时的问题，并让失败提示准确说明未就绪图层和恢复行为。

## Current Behavior

- `component-preview-client.js` 完成配置、CSS、素材加载后仍等待两次 `requestAnimationFrame` 才发送 prepared；直播软件可能暂停隐藏/后台 frame 的动画帧。
- `scene-renderer.js` 在 12 秒内没有收到所有 prepared 时丢弃 staging。首次加载也显示“继续显示上一版本”，没有指出哪个图层未就绪。
- 画布控制器及直播输出 ID/token 已复用，但预览短链接按组件/实例分别分配，缓存的选择也可能在图层删除后失效。

## Ownership And Compatibility

- 组件就绪握手：`public/js/overlays/component-preview-client.js`；原子切换：`scene-renderer.js`。
- 编辑入口选择：`public/js/admin/component-preview-dialog.js`；短入口与鉴权：`src/server/component-preview-sessions.js`。
- 保留同一画布控制器、旧长编辑入口、公开 API 字段、只读直播来源、沙箱、账号/会话撤销、保存事务和持久化格式。
- 编辑权限与直播只读权限仍分开。编辑链接随桌面会话结束失效；直播地址在账号、token 和监听地址不变时稳定。
- 不改 OBS/直播姬设置，不操作真实直播、用户数据或正在运行的客户端，不提交代码。保留工作区既有修改。

## Milestones And Verification

- [x] 复现并修复暂停动画帧时的首次加载。真实 renderer 用合成 clock + queue；暂停子 frame 的 rAF 后仍须完整切换且显示真实投影。保留资源失败、旧版保留和撤销测试。
- [x] 一个画布编辑会话复用同一短 key，更新最近选择；桌面按顺序提交选择，快速点击只能应用最后选择。删除选中实例或切换场景后重新打开同一入口须回到有效画布，不创建意外副本。扩展现有 transport/link 测试。
- [x] 调整首次加载及换版失败文案，说明未就绪图层，保留自动恢复与旧输出；同步场景规格、frontend/backend reference、组件指南和内置帮助。
- [x] 使用已有隔离 fixture 做浏览器源运行检查：暂停帧、正常显示、失败保留、关闭/重开/切换预览。测试命令为 `node --experimental-vm-modules --test --test-concurrency=2 test/transport/component-preview.test.js test/transport/component-preview-renewal.test.js test/admin/component-preview-links.test.js test/admin/component-preview-output.test.js test/scenes/scene-renderer.test.js test/scenes/scene-renderer-state.test.js test/scenes/scene-live-updates.test.js`，并运行受影响的组件协议/素材测试。
- [x] 执行 `npm run verify:docs`、`npm run check`、`npm run verify:architecture` 和最终 diff/status 检查；文档 gate 的无关失败见下方记录。本次不改变持久化与 Electron 主进程，不以全仓业务测试替代针对性验收。

## Failure Handling And Done When

加载失败保留已显示版本及业务更新；首次失败不声称存在旧版。过期或撤销的编辑/直播凭据仍拒绝访问。只回退本任务改动，不重置已有工作。行为、回归测试、文档一致后完成；实际直播姬/OBS 宿主未运行时如实说明，不把模拟环境称为实播验收。

## Evidence

2026-10-10 当前工作区未提交：

- 修改前四个定向回归全部按预期失败：暂停动画帧、首次超时文案、组件共用 key、实例共用 key；修改后四项通过。隔离 Chromium 中也观察到原提示、active=0；修复后同一暂停条件下 active=1、状态隐藏并显示时钟。截图保存在仓库 `tmp/canvas-source-reliability/paused-frames-fixed.png`。
- 第一批 65 项中 64 通过；唯一失败证实场景切换后的 draftKey 变化不应重建入口 key。移除恢复标识对入口身份的影响后，完整 transport 22 项通过；包含 link/output、组件效果、开播协议、使用指南的第二批 52 项全部通过，未修改有效业务断言。
- `node --experimental-vm-modules --test --test-name-pattern='browser canvas keeps sandbox isolation' test/desktop/danmaku-canvas-electron.test.js` 通过：独立数据目录、内存 SQLite、随机端口、真实 preload/IPC，覆盖沙箱和保存。上述无重复计算共 102 个相关测试通过。
- `npm run check`（1426 个 JS 文件）与 `npm run verify:architecture`（26 项）通过。`npm run verify:docs` 9/10 通过，失败为另一任务的 `specs/plans/2026-10-10-communication-remediation.md` 状态格式；本次不修改该任务。相关 Markdown 链接、API 路由与规格索引检查通过。
- 用户指南、内置帮助、规格及 owning reference 已同步；没有入口迁移，交互导览无需修改。没有运行真实直播姬/OBS、操作真实账号或发布安装包；模拟暂停不等于确认用户宿主的全部环境因素。

参考 [OBS Browser Source](https://obsproject.com/kb/browser-source)、[StreamElements 的导入流程](https://docs.streamelements.com/selive/guides/overlays-and-alerts) 和 [MDN 动画帧暂停说明](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)。彗星号官网是动态页面，未取得可核实的编辑器内部契约，不据此推断其权限实现。
