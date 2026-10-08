# 画布大航海感谢拆分

Status: Completed

## Goal / Current Behavior

画布添加窗显示辉光、经典两张独立卡片，添加、保存、重开后保持各自风格。当前只登记 default 卡片，style 只是临时预览参数，真实事件会在每个感谢图层混播。

## Ownership / Changes

- shared/scene-extra-components.js 定义两款内置预设及可持久化的 style；既有通用配置缺省为 follow，沿用事件风格。
- admin/scene-extra-preview.js 将风格移至图层外观；gift-guard-thanks.js 的预览入口选择或新建对应风格图层，复用已有 selectedItemId 通道。
- overlays/gift-effects-component.js 让指定原生风格只接收对应实时事件，示例按图层风格展示；资源/媒体样式保持已有事件行为。
- 使用真实渲染生成两款缩略图，更新相关前端契约。

## Constraints / Non-goals

不更改 HTTP/WS/IPC、业务开关、事件结构、数据库 schema、动画设计或用户现有数据。保留缺少 style 的旧画布及显式文字覆盖；保持本机样式库仅一处。不修改本任务之外已有工作区改动，不提交、不打包、不发布。

## Verification / Milestones

- [x] scene-extra-components + gift-guard-thanks-admin 17/17；scene-component-definitions + scene-gift-events 7/7。覆盖旧配置、两款预设、非法 style、双风格事件去重。
- [x] canvas-gift-components 的 gift settings open 用例通过：分别预览、保存、重复打开复用对应图层、实时事件隔离。
- [x] 隔离 Electron fixture 验证两张卡片图片正确、分别添加与保存、重开保留两个 style；截图 tmp/canvas-guard-styles/picker-electron.png。真实渲染截图生成两张 640×400 WebP；未连接真实账号。
- [x] npm run check（1322 文件）、npm run verify:architecture（23/23）通过；impeccable detect 无发现。归档后 npm run verify:docs 8/10：其他任务的 2026-10-07-scene-preset-actions.md 状态与索引不一致，以及新加 POST /api/scenes/delete 尚未登记 API 文档；均不属于本次修改。
- [x] 检查本次源代码和测试差异、git diff --check、git status --short；保留其他任务同时写入的变更。

## Verification Limits

原 guard-nautical-player 用例在套装列表旧文案等待超时，与此次原生样式拆分无关。tmp/canvas-guard-styles/guard-nautical-runtime.test.cjs 复用原用例，仅去掉该文案等待（保留套装分类断言及完整导入、播放、去重、重置检查），1/1 通过。未修改套装实现或原用例。

隔离 Electron 进程已关闭。删除 tmp/canvas-guard-styles/electron-MXYN62 被自动审批以 blocked by policy 拒绝；保留该测试 profile，不尝试其他删除方式。未提交、打包、安装或发布。

## Failure Handling / Done When

失败时保留场景草稿，复用原验证与错误反馈。仅反向修改本任务差异；不覆盖用户文件。两张卡片及独立图层验证通过、旧场景兼容且契约一致后归档。
