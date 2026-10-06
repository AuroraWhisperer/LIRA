# 月底冲刺画布与许愿入口整合

Status: Completed

## Goal

将月底冲刺收进礼物许愿页，两个入口均打开已有画布；冲刺文字作为独立实例可添加、保存并持续显示当前冲刺进度。

## Non-goals

不合并金额冲刺与礼物数量许愿的结算，不迁移目标设置，不新增外观设置或运行依赖。

## Current Behavior

`gifts/sprint-overlay.js` 与 `gifts/wishes.js` 直接打开各自的 `?preview=1` 页面；冲刺尚未注册画布组件。原测试明确断言这两个旧入口。

## Ownership and Compatibility

- 管理入口由 `toolbox/gift.html`、`toolbox/gift-wishes.html` 与 `gifts/` 模块拥有。
- 复用 `SCENE_EXTRA_COMPONENTS`、`scene-extra-preview`、`scene-extra-client`、`scene-extra-display` 和既有投影白名单。
- 冲刺目标与进度仍来自已有 `giftSprint`；场景只持有独立空外观配置，不保存示例或业务状态。
- 保留 `/gift-sprint`、`/gift-wishes` 和现有鉴权、消息协议、模板版本；新增类型沿用现有类型注册机制。
- 工作区存在大量既有修改，仅修改本任务相关行。

## Milestones

- [x] 入口：删除冲刺顶层标签，将内容放进许愿页顶部原生折叠区；两个按钮使用 `openComponentPreview({ id })`。验证现有礼物姬交互测试。
- [x] 组件：注册 `gift-sprint`（600 × 80），归入许愿分类；沿用服务端投影与父页消息，正式来源不开启子页 WebSocket。验证组件契约、模板、来源、进度更新与清空。
- [x] 文档与检查：更新直接相关说明，检查新增组件缩略图及界面，完成针对性门禁与差异检查。

## Verification

- `node --experimental-vm-modules --test test/gifts/frontend-gift-assistant.test.js test/scenes/scene-extra-components.test.js test/admin/scene-component-definitions.test.js test/server/runtime-event-publication.test.js`
- `node --experimental-vm-modules --test test/admin/canvas-gift-components.test.js test/admin/canvas-component-library.test.js test/admin/component-preview-links.test.js`
- `npm run verify:docs`、`npm run check`、`npm run verify:architecture`（新增持久化场景类型及后端投影接入）。
- 运行设计检测；最终检查任务增量、`git diff --check`、`git status --short`。

## Failure Handling

出错时按任务前快照核对，仅撤回本次修改，不重置既有工作。测试使用内存数据库和合成来源，不启动或操作用户现有桌面进程。

## Done When

许愿与冲刺入口打开并选中对应画布实例，冲刺可从许愿分类添加；保存后真实进度更新、未设目标和断线清空通过测试，旧地址兼容，相关文档与最终差异检查完成。

## Completion Evidence

- 礼物姬入口、旧投屏地址、组件定义、配置验证、模板、数据投影和通知测试通过。
- 画布组件库、礼物组件保存/发布、短链接复用测试通过。新冲刺用例验证真实目标、达标、重置、无目标、断线清空与恢复；子 renderer 无 API/WS 请求。
- 原礼物许愿测试、管理页面组合和手册检查通过；场景模型与礼物面板组合测试通过。
- `frontend-gifts-panel` 初次因服务器 checkout 非锁定版本失败；使用 `tmp/gift-sprint-canvas/server-contract` 的 detached `01fb2b4` 和 `LIRA_SERVER_ROOT` 补跑，4 项通过，随后清理临时检出。
- 文档、JS 语法、架构门禁通过；设计检测结果为空。截图检查发现选中标签遮挡短行文字，复用既有外置标签定位修复，后续截图和位置断言通过。
- UI 证据来自隔离浏览器夹具与真实画布/来源通路，未启动用户 Electron 或连接真实直播间。
- 测试截图与任务前快照保留在仓库 `tmp/gift-sprint-canvas/`，不进入提交。
