# 基础 UI 审查复核与修复

状态：Completed（2026-10-04）。对应审查：[shared-ui-audit](../../../docs/reports/2026-10-04-shared-ui-audit.md)。

## Goal

核实报告中的十项问题，修复编辑值丢失、颜色继承和已确认的键盘/组件接入缺陷；按真实影响收敛职责边界。

## Non-goals

不重写组件库，不修改礼物计算、服务端接口、持久化键或 Electron 权限。不实施报告中未证明必要的动效、通知分类、导航生命周期及同义命名重构。不提交代码。

## Current Behavior

歌单板由 FormsService 和 display.js 共同写 DOM，自动保存延迟读取 DOM，旧快照可覆盖新编辑。点歌板已有 component-config-controller 草稿机制。空串颜色被原生 color input 规范成黑色。其余问题分属入口注册、事件冒泡、隐藏状态、焦点样式和控件语义。

## Ownership

- `public/js/admin/song-board-settings.js` 接管歌单板表单，复用 `component-config-controller.js` 和 `component-settings-sync.js`，display 保留展示入口及 URL 编排。
- `forms.js` 保留通用回填与点歌子标签；不再回填歌单板业务字段。`queue-theme-view.js` / `queue-theme-config.js` 保留点歌板 owner。
- 颜色继承由这两个表单适配原有空串协议；共享颜色 CSS 不承担业务语义。
- `confirmation-dialog.js` 消费弹窗键盘事件；toolbox-navigation 和 gifts/blindbox 各自维护折叠后的可交互状态。
- 契约：`docs/reference/frontend/app.md`；页面/调用路由：`docs/architecture/engineering/ai-workflow.md` 的 ROUTE-ADMIN。

## Compatibility Constraints

保留歌单板 180ms 自动保存和显式保存、点歌板显式草稿保存；沿用现有 `/api/settings`，颜色仍用空串表示继承，不保存 UI 专用字段。预设/重置是明确用户编辑。保持现有主题、页面 URL 和未提交修改。

## Milestones

- [x] 设置正确性：统一歌单板配对定义、首屏回填、即时捕获草稿、顺序保存及失败保留；明确两表单的继承/自定义颜色。验证连续编辑、旧快照、保存中编辑、失败重试、零值和首次独立主题。
- [x] 组合交互：补 `/c` 帮助注册；确认框拦截 Escape；分组收起保持可见 Tab 入口；盲盒折叠同步 inert。验证真实模块和既有 fixture。
- [x] 焦点/语义：主按钮内环采用前景 token；桌面歌词标签正确关联；点歌子标签状态、面板关系与方向键完整。验证 Electron 隔离 host。
- [x] 更新事实文档及复核结论，审查本次差异，归档完成计划。

## Verification

直接受影响的 node:test：新增歌单板行为测试，现有 component-config-controller、frontend-queue、toolbox-sidebar-routing、component-preview-browser、contextual-help、ui-surface、frontend-admin-runtime、client-theme-palettes 和页面组合检查。用既有隔离 Electron host 批量核实桌面交互、真实 CSS 和可访问名称；不用真实用户数据。

完成时执行 `npm run check`、`npm run verify:architecture`、`npm run verify:docs`（本次涉及状态 owner 和文档），`git diff --check`、`git status --short`。机械 UI 检测只扫描本次目标。具体执行结果在完成时记录。

## Rollback Or Failure Handling

保存失败保留草稿和错误反馈，后续编辑或显式保存可重试。实现问题只回退本次拥有的局部差异，不覆盖现有用户改动。测试使用仓库 tmp 和内存夹具，清理本轮进程。

## Done When

每条采纳结论有源码或运行证据，成立的问题得到修复；聚焦验证通过，边界/保存契约文档一致；最终差异不包含运行数据或敏感信息。

## 实施发现与验证结果

- 复用 controller 时复现了保存期间改回旧值仍被推送覆盖的情况，添加提交字段代次保护和回归用例。已有画布发布行为检查通过。
- 确认框 Escape 修复后，Electron 进一步确认礼物清空按钮因提前禁用而不能接回焦点。禁用时机移到用户确认之后，取消无需请求清空接口。
- `node --experimental-vm-modules --test test/admin/component-config-controller.test.js test/admin/toolbox-sidebar-routing.test.js test/admin/frontend-admin-runtime.test.js test/songs/frontend-queue.test.js`：43 项通过。
- `node --experimental-vm-modules --test test/admin/toolbox-sidebar.test.js test/admin/toolbox-sidebar-preferences.test.js test/admin/client-theme-palettes.test.js test/admin/admin-page-composition.test.js test/admin/contextual-help.test.js test/ui/ui-surface.test.js test/admin/component-preview-contracts.test.js test/ui/frontend-select-menu-lifecycle.test.js test/ui/frontend-parameter-range.test.js`：42 项通过。
- `node --experimental-vm-modules --test test/admin/component-preview-browser.test.js`：5 项通过。
- `node --experimental-vm-modules --test test/admin/song-board-settings.test.js`：3 项通过。
- `node --experimental-vm-modules --test test/admin/shared-ui-interactions.test.js`：1 项通过。
- `node --experimental-vm-modules --test test/admin/canvas-publication.test.js test/admin/component-config-controller.test.js test/engineering/module-boundaries.test.js test/engineering/esm-module-boundaries.test.js`：36 项通过（与前述 controller 检查重叠）。
- `npm run check` 通过。Impeccable 对本次 UI 目标检测输出 `[]`。
- Electron 43.2.0 隔离 host：实际键盘/鼠标验证、ARIA snapshot、三套实心色板 computed style；证据在仓库 `tmp/shared-ui-fixes/`。未使用真实用户数据，未做实体读屏器或原生选色弹窗验收。
- 全仓 `verify:architecture` 的文件大小门禁有既存限制：未由本轮改动的 `public/css/admin/toolbox/fan-profiles.css` 为 648 行，登记上限 647；其余架构边界检查通过。保留该用户改动，不放宽基线。本轮 display.js 已移除的空 catch 对应额度也已移除。
- 最后 `verify:architecture` 为 21 通过、1 项上述既存失败；`verify:docs` 为 10 通过；`git diff --check` 通过。最终差异与状态已检查。
- 本轮 Electron 实例已关闭。临时配置目录 `tmp/shared-ui-fixes/electron-7J7ANW` 的删除被自动审批以 `blocked by policy` 拒绝，保留目录且未绕过限制重试；其余 QA 证据留在 tmp。
