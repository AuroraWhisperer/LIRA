# 固定位置弹幕滚动方向 Implementation Plan

**Status:** Completed

**Archived:** 2026-09-28；实现与本任务验收完成，以下记录不代表已发布或部署。

**Goal:** 六种固定位置弹幕可按样式选择从下向上或从上向下，新弹幕分别在底部或顶部出现。

**Architecture:** 扩展现有 `styleOptions` 的 `scrollDirection: 'up' | 'down'`。客户端草稿、认证桥、服务器保存及 SSE 沿用现有通道；通过共享样式参数和 CSS 改变视觉顺序，消息数组继续按时间排序并移除最旧消息。

**Tech Stack:** 原生 JavaScript、CSS、Node test、现有 Playwright overlay 测试。

## 边界与当前行为

- 当前消息从底部出现，服务器 feed 已有位置变化动画和超出画布时移除最旧消息的逻辑。
- `Live/public/js/shared/danmaku-style-options.js`、`Live/src/shared/danmaku-style-options.js` 和服务器 browser/Node 对应文件共同定义参数白名单。
- 桌面管理面板只维护草稿；正式 OBS `/overlay` 由 `lira-server/public/overlay/` 渲染。预览由 `Live/public/js/overlays/` 渲染。
- 省略新字段默认 `up`；只允许六种固定样式设置，三种随机样式保持原布局。恢复默认使用现有空样式对象语义。
- 不改变数组顺序、消息保留数、租户隔离、认证、数据库 schema、接口路径、画猜 feed 或全屏随机行为。保留两仓库已有未提交修改；不提交或部署。

## 实施与验证

- [x] 参数与契约：四份 `*-style-options.js` 接受固定样式的 `up/down`，缺省为 `up`；补充双方参数测试、服务保存/广播测试、三个 OpenAPI 的 `OverlayStyleOptions`、fixture、需求及验收。
- [x] 桌面操作与预览：现有 `danmaku-overlay-settings.js` 和 `danmaku.html` 添加“滚动方向”；测试切换样式保留草稿、保存与预览携带参数、随机样式隐藏字段、恢复默认。
- [x] 渲染：两端 `base.css` 使用 `column-reverse` 使最新消息在顶部；垂直入场动画随方向反转。服务器方向变化时通过既有 feed 重建重置动画位置。扩展现有浏览器测试验证六种样式的顺序、旧消息下移、溢出淘汰、实时切换和随机样式。
- [x] 审查：更新客户端 overlay 参考；运行受影响测试、相关契约/文档/模块门禁，检查两端任务 diff、`git diff --check` 与 `git status --short`。仓库级既有门禁问题见下方限制。

## 命令与验收

- 客户端：`node --experimental-vm-modules --test test/danmaku/danmaku-style-options.test.js test/danmaku/server-danmaku-settings.test.js test/danmaku/danmaku-local-preview.test.js test/danmaku/danmaku-overlay-ipc.test.js test/danmaku/frontend-admin-danmaku.test.js test/danmaku/danmaku-style-ownership.test.js`。
- 服务器：`node --require ./test/support/test-mode.cjs --test test/overlay-style-options.test.js test/overlay-settings-service.test.js test/overlay-settings-routes.test.js test/overlay-protocol-contract.test.js`。
- 浏览器：复用 `e2e/overlay-style-options.spec.js` 和隔离浏览器测试配置；模拟 SSE 和合成消息，不接触真实用户数据或外部直播间。
- 完成条件：参数经两端校验保存；预览与正式渲染方向一致；默认保持原行为；六种固定样式正确保留最新消息；相关检查通过或明确记录限制。

## 回退与失败处理

只撤销本任务新增字段、控件、CSS 和测试/文档行；不使用 reset/checkout 或批量删除。未部署前无持久用户数据变化。新客户端提交给未升级服务器时沿用现有失败反馈并保留草稿。

## 验证记录

- 先运行新增参数回归，确认旧实现因缺少默认方向而失败，再接入实现。
- 客户端所列六组测试：35/35 通过。服务器所列四组测试：23/23 通过；随后新增 OpenAPI 方向校验，与文档治理及架构治理一起 36/36 通过。
- `npx --no-install playwright test e2e/overlay-style-options.spec.js e2e/overlay-motion.spec.js`：64/64 通过，包含六种固定样式方向、溢出、实时反转、恢复默认、随机样式与既有动画回归。
- 14 个修改的 JavaScript 文件通过 `node --check`；客户端与服务器参数定义一致。两仓库 `git diff --check` 通过，已审查任务范围内差异。
- 客户端文档治理通过。客户端模块大小门禁 17/18 通过；唯一失败来自既有的 `public/css/admin/gift-display.css`（633 行）和 `test/gifts/frontend-gift-display-settings.test.js`（632 行）未登记文件级审查，本任务未修改这两个文件。
- 浏览器测试使用现有隔离测试服务器、合成事件和临时存储，进程随测试结束。自动审批拒绝清理测试临时目录（只返回 blocked by policy），未尝试绕过；临时产物保留在系统 Temp，未进入仓库。
- 未打包、提交或部署；正式使用需客户端和服务器同时包含此扩展。
