# 流霞实施计划

**Status:** Awaiting Verification
**Budget:** 2026-10-08 10:29:53–10:59:53 UTC；10:49:53 起收敛验证。
**Goal:** 实现 [流霞规格](../danmaku-prismatic.md) 的固定列表样式与最小身份展示投影。

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

## 2026-10-09 大航海感谢与 SC 扩展（实现与定向验证完成）

用户追加两张卡片参考，并提供陪伴榜 DOM。已对照官方 `topListNew` 返回确认 `accompany` 为榜单天数；不使用购买数量、有效期差或本地手动补录替代。

1. 将粉丝档案已有大航海名单读取抽为两仓一致的无状态模块，保留完整分页、房主核验和取消；增加可选 `accompanyDays`。Server 共用既有会员事实的购买识别，并解析上舰通知动作；感谢卡优先用当次通知中明确的陪伴天数，缺失时按绑定主播及观众 UID 查询官方名单。复用结算后的单次通知，不改变账本、事实稳定 ID、私密档案或租户边界。验证名单、fan-facts、overlay-gift、场景白名单。
2. `danmaku-prismatic.js` 拥有三档居中头像／白底名字／渐变感谢卡；按用户追加要求使用珠光香槟金、冰蓝紫晶、玫瑰金和静态高光，并在右下角裁切露出白色粗体结算金额的上半部分。SC 复用 `createSuperChatCard` 的金额、原文与安全 DOM，加入薄荷至粉色渐变、上方名字和右上 CN¥ 金额。两仓同步资源和合成预览。验证三档、未知动作、缺失天数、长名、换行与头像失败；原有主题保留。
3. 可选公开字段仅包含动作与天数，更新 OpenAPI、fixture、客户端校验及 owning 文档／使用指南。定向 Node 测试、既有浏览器运行路径、两仓文档门禁及 `git diff --check`；临时证据位于 Live 的 `tmp/prismatic-cards/` 和 Server 的 `tmp/browser-tests/prismatic-cards/`。不提交或部署。失败时只修复本次改动；保留已有工作区修改。

Done When：参考结构实现，两仓显示一致，新增字段缺失能兼容，相关测试通过，真实 OBS／直播姬未覆盖项明确记录。原计划未完成的真实上游身份验收不在本次冒充完成。

- 客户端 `node --experimental-vm-modules --test`：renderer、local-preview、guard-roster、fan-profiles-guard-roster、scene-cloud-controller 五个文件共 97 项通过。
- Server Node 24.15.0：fan-facts、overlay-gift、room-monitor-overlay 共 50 项通过；bilibili-guard-membership、overlay-message-renderer、overlay-preview 共 21 项通过。系统 Node 24.21.0 不在 Server 支持范围内，改用仓库已有受支持运行时，没有关闭门禁。
- 既有 `overlay-superchat.spec.js` 与新增 `overlay-prismatic.spec.js` 分别通过；隔离数据库、进程和合成事件，未控制正在使用的桌面实例。新用例修正了窄画布夹具的其他区域尺寸和失败头像缓存复用，产品逻辑未因此变更。截图覆盖三档、高光、金额上半部、SC、长昵称／长原文与失败头像。
- 真实陪伴榜接口已验证；没有真实新购／续费 WS 样本或 OBS／直播姬实播验收。本次不更新契约版本锁、提交或部署。
