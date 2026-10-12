# 画布关闭后快速重开 Implementation Plan

**Status:** Completed

**Goal:** 未保存关闭画布后，再次从客户端打开时立即进入正常加载，不等待已经关闭的网页响应；保留草稿。

**Architecture:** 延续客户端控制器持有草稿、HTTP 中继持有页面 attachment 的归属。网页离开只释放当前 attachment，不关闭会话或保存配置。

**Tech Stack:** Node.js 24、原生 ES modules、现有 Playwright/Electron 测试夹具。

## Current Behavior And Ownership

- `public/js/admin/component-preview-page.js` 的 pagehide 调用连接 detach，但 `component-preview-remote.js` 仅停止本地轮询。
- `src/server/component-preview-sessions.js` 因而保留旧 attachment；再次 focus 必须等待 2000ms 超时。首次打开没有 attachment，不等待。
- `component-preview-dialog.js` 继续复用会话和短链接；无需更改默认浏览器或创建新的窗口系统。
- 合同归属：`docs/reference/backend/api.md`、`docs/reference/frontend/app.md`。用户步骤见 `docs/guides/component-sources.md`，本次不改变步骤。

## Compatibility And Non-goals

保留未保存草稿、已接受命令、确认序号、短链接及显式 close/revoke 行为。页面释放必须验证既有 Bearer 与当前 attachment，迟到旧页面不能释放新页面。保持管理鉴权、Origin、租约、媒体能力和持久化格式。保留工作区已有修改，不提交、发布或操作真实用户数据。

## Milestones And Verification

- [x] 在 `test/admin/component-preview-links.test.js` 既有重开案例中测量关闭后的 focus 耗时，要求低于 1000ms，并验证重新加载仍保留未保存内容；先运行并确认旧代码因固定等待失败。
  - `node --test --test-name-pattern='reopening and style changes' test/admin/component-preview-links.test.js`
- [x] 新增兼容的 `detach` 中继操作，网页使用带原能力与 attachment 的 keepalive 请求释放页面；保留会话与待确认命令。
  - 服务端在当前 attachment 校验后执行 `session.focusRequest?.finish(false); session.detached = true; return {};`，重开不再等待旧页面。
  - 保留最后的 attachmentId 作为接管比较基线，避免“新页读取 → 旧页离开 → 新页接管”的竞态误报 409；已释放页面不能恢复自身 attachment 或继续操作媒体。
  - 网页停止自身连接后执行 `requestOnce({ action: 'detach' }, true)`，只在已经接管页面时发送。
  - 在 `test/transport/component-preview.test.js` 现有附件隔离测试加入迟到 detach，在所属层补充释放后立即 focus、命令保留和重新接管验证。
- [x] 运行直接受影响的传输、连接、重开、草稿恢复测试；复用隔离 Electron 夹具测量首次与未保存关闭后的重新打开，检查没有额外图层或意外保存。已有样式选择器错误见下方限制。
  - `node --experimental-vm-modules --test test/transport/component-preview.test.js test/transport/component-preview-renewal.test.js test/admin/component-preview-remote.test.js test/admin/component-preview-links.test.js test/admin/component-preview-recovery.test.js test/admin/component-preview-drafts-browser.test.js`
  - 隔离 Electron 测量只用 `tmp/` 数据目录和合成账号，退出时关闭测试进程并清理目录。
- [x] 同步 API 与前端合同，复核用户指南仍准确；有关源文件语法检查通过。文档检查 9/10 通过，既有航海气泡计划状态不符合活动计划要求；最终差异检查作为归档后的收尾门禁。

## Failure Handling And Done When

只撤销本任务拥有的修改，不重置其他工作。请求失败保留现有 focus 超时回退；不以自动保存或清空草稿换取速度。完成条件：关闭后不再等待失效 attachment，重开草稿可编辑，其他页面接管及已接受命令不受影响，定向验证通过并记录性能证据与实际限制。

## Evidence And Limitations

- 修复前，既有浏览器重开案例测得 2012ms，新增低于 1000ms 的断言失败；修复后同一案例为 10ms，保留同一短链接、会话、未保存内容和未发布状态。
- 104 项相关检查中 101 项通过：传输/远程控制器 28 项；重开/重试/续期/浏览器草稿 19 项中 16 项；草稿恢复/合同/文本素材 30 项；开播设置/素材权限 27 项。没有运行全量套件。
- 浏览器草稿套件的 3 项失败均来自既有 `component-preview-picker.js:274` 读取缺失的样式标题节点。工作区的航海气泡按钮未提供选择器要求的 `.danmaku-style-name`；使用 `git show HEAD:public/js/admin/component-preview-remote.js` 的旧连接模块亦在首次打开添加组件时复现，早于任何 detach。保留该独立样式修改，本任务不修复。
- 隔离 Electron 使用真实 preload、管理请求鉴权与内存场景库；由已有组件预览入口添加弹幕后调整宽度为 777，连续未保存关闭并重开 5 次，再刷新，尺寸保持、图层数为 1、保存按钮可用、publishedVersion 为 0，无新增错误。
- 后三次从真实 DOM 点击到画布就绪分别为 367、393、351ms；Playwright 对隐藏 Electron 窗口的输入动作本身另有约 1 秒调度开销，因此不把从自动化调用开始的总时间当作应用打开延迟。静态截图检查恢复状态及参数面板；证据位于 `tmp/canvas-reopen-qa/`。
- 测试浏览器、Electron 进程和专用临时 profile 均已清理。未更改默认浏览器、正在运行的客户端或安装包；未提交、打包、发布。用户操作及指南步骤未改变。
- `npm run verify:docs` 的 API 路由及当前/历史链接等 9 项通过；唯一失败为已有 `specs/plans/2026-10-11-danmaku-harbor.md` 的活动计划状态。保留该其他任务文档。
- 正常关闭释放页面后不再有固定等待；操作系统强制终止浏览器等未送达 detach 的情况仍保留原两秒回退，实际浏览器启动、页面和素材加载耗时不承诺为零。
