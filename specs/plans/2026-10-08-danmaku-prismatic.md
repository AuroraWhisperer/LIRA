# 柔彩气泡实施计划

**Status:** Awaiting Verification
**Budget:** 2026-10-08 10:29:53–10:59:53 UTC；10:49:53 起收敛验证。
**Goal:** 实现 [柔彩气泡规格](../danmaku-prismatic.md) 的固定列表样式与最小身份展示投影。

## Ownership 与实施边界

- 共享消息 renderer 与新增 `danmaku-prismatic.js` / `prismatic.css` 负责视觉；保留 feed、画布、图片解析与礼物结算所有权。客户端和 Server 浏览器资源同步。
- Server `bilibili-danmaku.js` 与 room-monitor 负责可信房间归属；公开协议增加可选 `honorLevel`、`roomGuardLevel`、`roomMedal`，不改变旧 `guardLevel` 语义。
- Electron `scene-cloud-controller.js` 白名单校验新展示字段；现有 style-options/layout/settings/preview 负责样式选择与保存。
- 不部署、提交或更改认证、租户边界、持久化格式及旧样式。保留已有工作区变更。

## Milestones

- [x] 身份数据：当前房间牌过滤、荣耀与房间大航海分离、有效颜色投影；验证 parser/protocol/cloud-controller 的正确值、缺失值与非法值。
- [x] 样式接入：固定样式注册、设置、预览与正式来源；验证 style-options/layout 既有回归。
- [x] 视觉：官方勋章、头像与身份栏、稳定逐条混色、透明大表情、礼物胶囊、经典 SC；验证 renderer 与隔离浏览器样例。
- [x] 交付：同步 owning contracts、记录实际检查及未完成真实直播验收，审阅 diff，运行两仓 `git diff --check` 与 `git status --short`。

## Verification

客户端使用 `node --test test/danmaku/danmaku-message-renderer.test.js`，样式与场景测试由对应 owner 运行；Server 使用 `node --require ./test/support/test-mode.cjs --test` 加受影响 parser/protocol/renderer 文件。文档执行 `npm run verify:docs` / `npm run docs:check`。浏览器验证使用隔离静态样例，不控制用户运行中的桌面实例。

## Compatibility 与失败处理

新字段均可选；未知身份不伪造，其他房间牌不冒充本房间牌。仅采用合法十六进制颜色和官方资源映射，文本仍由安全 DOM API 创建。旧样式继续原有投影。遇到期限或真实上游证据缺口，保留可审阅工作并准确记录未验收项；不回滚用户修改，不将合成样例当作实播证据。

## Done When

规格的实现与受影响回归完成，真实数据/桌面/OBS/直播姬未验收项明确列出；只有所有要求的验收证据齐全才标记完整完成。

## 交付证据与剩余验收

实现与定向检查结果见[规格实施记录](../danmaku-prismatic.md#2026-10-08-实施与验证记录)。两端同组浏览器样例已对照，长昵称连续排版、礼物满宽居中已按追加要求调整。未完成真实上游报文及 OBS/直播姬实播验收；客户端契约版本锁与本地 Server HEAD 不同。此计划保留 Awaiting Verification，不把这些缺口标为完成。未提交或部署。
