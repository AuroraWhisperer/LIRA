# Connected Preview Reuse Implementation Plan

**Status:** Completed

**Goal:** 客户端切换样式或组件并进入预览时，沿用当前已连接画布，保留场景、图层和未保存草稿；页面已关闭时正常打开。

**Architecture:** 沿用现有预览中继与独立页面能力。管理端通过短入口请求当前 attachment 定位组件；网页在原 view 中选择组件并确认，确认成功才省略外部打开。请求无接收者或两秒内未确认时打开原短入口。

**Tech Stack:** Node.js、原生 ESM、现有 node:test / Playwright fixtures。

## Constraints and ownership

- `component-preview-dialog.js` 拥有客户端打开流程；`component-preview-sessions.js` 和路由拥有能力校验、临时定位请求与确认。
- `component-preview-remote.js` / `component-preview-page.js` 转发定位；`component-preview-canvas-view.js` 复用原选中/添加逻辑。
- 契约归属 `docs/reference/backend/api.md`。回归在 `test/transport/component-preview.test.js`、`test/admin/component-preview-links.test.js`。
- 保留 noopener、Electron 外部浏览器策略、Host/Origin、所有保存/发布/attachment 隔离与旧链接。无新依赖、持久化字段、Electron 权限或新服务。
- 不调整样式设计，不替换独立图层的业务语义；保留所有已有工作区修改。不提交。

## Current behavior

`canReuse` 复用会话后仍调用 `focus`，后者无条件 `window.open(..., '_blank')`；Electron 通过 `shell.openExternal` 打开第二个标签页。现有回归只检查会话和短入口稳定，未检查页面复用。

## Milestones

- [x] 增加失败回归：已连接页面下更换样式并重新预览，不再调用外部打开，原 DOM / 场景 / 草稿保留；不同组件和具体实例能在原画布选中。
- [x] 实现管理端 `focus({key}) -> Promise<{focused}>`。仅经短入口验证后的锚定会话持有一条定位请求，绑定当前 attachment。`read` 返回可选 `focus` 并接受 `focusId` 确认；替换、撤销、关闭、超时清理等待。旧 read 响应在无请求时不变。
- [x] 客户端拿到短入口后请求 focus；成功则结束，失败才打开。网页复用 view.focus，收到后立即确认，避免等待后台标签页的下一次轮询定时器。重复点击以现有 focusGeneration 抑制过时打开。
- [x] 更新契约、完成定向验证和最终 diff 检查，归档计划。

核心验收断言：

```js
assert.equal(await desktop.evaluate(() => window.externalPreviewUrl), '');
assert.equal(await page.evaluate(() => window.originalCanvas === document.querySelector('.scene-editor-canvas')), true);
assert.equal(await label.inputValue(), '保留未保存编辑');
```

## Verification

- `node --experimental-vm-modules --test test/transport/component-preview.test.js test/admin/component-preview-links.test.js`
- `node --experimental-vm-modules --test test/admin/component-preview-browser.test.js test/admin/component-preview-remote.test.js test/admin/component-preview-recovery.test.js test/admin/component-preview-drafts-browser.test.js test/transport/component-preview-renewal.test.js`
- `npm run check`、`npm run verify:architecture`、`npm run verify:docs`：语法、模块边界与本地 API 文档门禁。
- 最终检查任务 diff、`git diff --check`、`git status --short`；测试使用合成状态与内存数据库，不操作用户应用。

## Failure handling and done when

超时只清除定位请求，不清除草稿或保存命令；没有响应的原页面后续不能消费过期定位。回滚只撤回本任务所改片段。完成条件为复用、组件定位、关闭后打开、权限隔离与连接回归通过，契约同步，未引入运行数据或无关修改。

## Results and verification limits

- 新回归先失败于“再次调用外部打开”，修复后通过。transport + links 24/24 通过；立即确认优化后 links + remote 8/8 通过。
- browser、recovery、renewal 回归均通过；drafts-browser 首轮有一次保存等待超时，单项复跑通过。后续测试期间并行工作修改了草稿提示文案及其断言，产生一次旧断言失败；本任务未改其文案或断言，工作区更新完成后整文件 5/5 通过。
- 语法检查 1293 个文件通过；架构 19/19、文档 10/10 通过。测试使用合成客户端入口及独立浏览器上下文，没有操作用户运行中的 Electron。
- 额外尝试 `npm run verify:contracts`，因服务端仓库 HEAD `4f287489825c606875bfdfbb46b78c6d08f8e000` 与固定版本 `01fb2b47d5e081f5dd559933991ade4819eb3428` 不符而未通过。检查脚本实际针对远程 LIRA Server fixture，并非本次本地预览中继；本次不改远程契约，验收以本地 transport 与文档路由检查为准，未修改服务端工作区或 lock。
- 保留工作区其他样式、布局与草稿提示的并行修改；本任务仅修改画布 view 尾部的选择逻辑。
