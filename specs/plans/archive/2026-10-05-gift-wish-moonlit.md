# 月渡花汀礼物心愿装饰

状态：Completed · 2026-10-05。

## Goal / Architecture

新增与月渡花汀开播动画配套的礼物心愿样式：蓝白靛青、银色与少量金色花枝，左侧圆形礼物位、右侧礼物名和已收/目标数量，动态进度条。用户已确认接入现有礼物心愿。沿用原生 ES modules、共享卡片与现有数据投影，不增加依赖或服务。

## Current Behavior / Ownership

- `src/bilibili/gift/wish-service.js` 验证并投影 `displayStyle`，现有存储字段无需迁移。
- `public/js/shared/gift-wish-card.js` 和共享 CSS 同时供管理编辑器、画布预览和浏览器源使用。
- `public/pages/admin/toolbox/gift-wishes.html` 拥有心愿样式选择；场景组件枚举沿用现有定义入口。
- 现有 overlay 收到更新时重建卡片；本次仅对新样式保留同一心愿的进度节点，使数量更新能连续推进。原有样式行为保持。
- 契约见 `docs/reference/backend/api.md` 与 `docs/reference/frontend/overlays.md`；验证入口为礼物心愿服务、前端和场景组件测试。

## Constraints / Non-goals

- 新增 `moonlit` 枚举；保留 card/text/circle、原配置默认值、礼物身份、计数和创建时间。
- 不改礼物结算、身份匹配、存储结构、网络/认证边界或开播动画。
- 无人物头像、无新增真实数据；左侧使用心愿对应的礼物图片。
- 尊重工作区既有未提交改动；不提交、建分支。临时素材、预览和 QA 放入 `tmp/gift-wish-moonlit/`。

## Milestones / Verification

- [x] 新样式美术与共享渲染：实际进度控制填充长度，流光/端点亮光/花瓣保持独立动画；零值、达成、超额、长名称和减少动态效果正确显示。
- [x] 编辑器、服务、画布贯通：选择保存并重新读取 `moonlit`；切换样式不清零；真实数据刷新不重复卡片、请求或动画注册。
- [x] 运行 `node --experimental-vm-modules --test test/gifts/gift-wishes.test.js test/gifts/gift-wish-routes.test.js test/gifts/frontend-gift-wishes.test.js test/scenes/scene-extra-components.test.js test/admin/scene-component-definitions.test.js`；54 项通过。另运行 `node --experimental-vm-modules --test --test-name-pattern 'moonlit wishes save' test/admin/canvas-gift-components.test.js`，1 项通过。
- [x] 更新直接契约、完成记录与索引，审阅最终任务 diff、`git diff --check`、`git status --short`。

## Failure Handling / Done When

只修复本次新增样式和直接接入点；素材不合格时修正该素材，不以静图代替进度动画。失败不覆盖用户配置或数据，不使用破坏性回滚。完成条件为可选择、可保存、预览与浏览器源共用正确计数，实际动画验收通过，并提供可查看的动态预览。

## Completion Evidence（v1 · 历史记录）

以下为第一版实现与当时验收；视觉结果后经用户反馈修订，以文末最新修订记录为准。

- 新原画 `public/img/shared/gift-wish-moonlit.webp` 为 1440×360 透明 WebP，348,766 bytes。使用 LiraHub GPT Image 2.5 Flare 生成，保留圆框比例、延长横向笔触；原提示词与素材来源保存在旁侧 JSON。画布缩略图来自真实共享 renderer，附来源说明。素材扫描 2 张、0 缺失。
- 共享卡片入口按 `moonlit` 分派；`gift-wish-moonlit.js` 拥有 DOM 与更新，专属 CSS 拥有装饰和动效。浏览器源及场景输出按心愿 ID 复用新样式节点；其他三种样式继续原有呈现。
- 55 项针对性测试通过，覆盖服务保存/读取/切换、编辑器重开、进度节点保留、无重复请求/卡片、超额与无障碍值、减少动态效果，以及画布添加/保存到实际场景沙箱显示与推送刷新。
- 隔离 Playwright 检查 720px 预览及 416px 默认条目：透明边缘、深浅底色和开播背景、实际推进中间值、流光时间连续、暂停/继续、0/50 与 60/50、长名称截断均正确，控制台无异常。证据在 `tmp/gift-wish-moonlit/qa/functional.json` 及对应截图。
- Impeccable finish reviewer 对上述两尺寸与实现给出 `ship`，无实质问题。机械检查仅提示 `transition: width`；保留这一短时进度更新以避免缩放端点与花瓣，持续动画使用 transform/opacity。
- 自包含交付：`tmp/gift-wish-moonlit/月渡花汀-礼物心愿动态预览.html`、`月渡花汀-礼物心愿效果.png`。独立预览共享生产 renderer，含示例收礼、滑条、暂停、重置及底色切换。内置浏览器拒绝 `file:` 协议，未绕过该限制；交付本地 HTML 供用户自行打开。
- 未控制用户运行中的 Electron、OBS 或哔哩哔哩直播姬，未实播；浏览器和测试服务已清理。没有提交或创建分支，保留工作区既有及并行改动。

## Revision Evidence（v2 · 2026-10-05）

- 按用户截图反馈修正三项外观：立体花束改为贴环二维小花；延长深墨底并收进数量与进度条；增加零进度也保留的固定起点花结。沿用既有主题色与共享渲染，数据和计数行为未变；当前展示规则见[前端页面](../../../docs/reference/frontend/pages.md)。
- 生产底图更新为 1440×320、211,736 bytes 的透明 WebP，卡片比例 4.5:1；新增 `public/img/shared/gift-wish-moonlit-start.svg`。画布缩略图同步从生产 renderer 重生成，选择器只调整本样式边界。两张栅格素材来源扫描均通过，0 缺失。
- 复跑 `node --experimental-vm-modules --test --test-name-pattern moonlit test/gifts/frontend-gift-wishes.test.js`，2 项通过；选择器 `node --check` 通过。独立 HTML 预览已内联新版原画与 SVG，脚本语法检查通过。
- 隔离运行生产 renderer、CSS 与素材，检查 416px 和 720px。证据位于 `tmp/gift-wish-moonlit/qa/revision-v2/`：`light-720.png`、`light-416.png`、`zero-dark-416.png`、`full-garden-720.png`、`long-name-416.png`。`functional.json` 记录 20→25 时保留同一节点，填充经过约 47.3% 后到达 50%；零值填充为 0、端点隐藏、固定花结保留；60/50 封顶 100%；暂停保持动画时间，减少动态效果停用过渡与装饰动画，控制台错误为 0。
- `contrast.json` 按实际 Chromium 数字字形内部像素采样，白底下已收数最低对比度 9.47:1、目标数 7.24:1，数字下方底图最低 alpha 为 253。新版 finish reviewer 对三项反馈给出 `ship`，无实质 P0–P2 问题；检测器仍仅提示有意保留的短时 width 过渡，持续效果使用 transform/opacity。
- 原交付路径 `tmp/gift-wish-moonlit/月渡花汀-礼物心愿动态预览.html` 与 `月渡花汀-礼物心愿效果.png` 已更新。隔离浏览器上下文、Chromium 和测试服务已清理；未连接真实 B 站收礼，未在 OBS 或哔哩哔哩直播姬实播。

## Revision Evidence（v3 · 2026-10-05）

- 用户指出圆圈仍大、花饰太少：圆环直径约从 294px 收到 235px（缩小约 20%），礼物图标大小与中心不变；小花、花苞和叶枝沿整圈连续分布。新花环以 264×264 合成在原 1440×320 底图中，原水墨与数字背景从 x=312 起逐像素相同。本轮没有修改生产 CSS、JS 或数据行为。
- 更新底图（240,370 bytes）、组件缩略图、来源信息与原动态预览。检查 416px、720px 和深底零进度；收礼 20→25 保留同一节点，填充经过约 46.8% 后到 50%，零进度为 0 且隐藏移动端点，控制台无错误。证据见 `tmp/gift-wish-moonlit/qa/revision-v3/`；本轮仅素材调整，采用实际渲染验证，未重复运行代码测试。
- 新一轮独立素材复核结论为 `ship`，限于圆框比例与整圈花饰两项反馈；没有要求进一步修正。两张栅格素材来源扫描 0 缺失；隔离浏览器与测试服务已关闭，未实播。

## Revision Evidence（v4 · 2026-10-05）

- 用户强调装饰必须符合开播动画的古风。对照实际成片、白山茶花枝和银蓝折扇，圆框改为层叠山茶、墨蓝枝叶、如意云纹、贴边绢带与山水纹饰；进度起点改为银蓝小折扇和云纹。保留 v3 的紧凑圆框、整圈装饰、礼物图标尺寸及既有计数和动效。
- 底图保持 1440×320，更新为 260,810 bytes；同步 SVG、组件缩略图、来源记录与动态预览。x=312 以右的水墨与数字背景逐像素未变；SVG XML 有效，两张栅格来源扫描 0 缺失。
- 本轮仅修改素材，采用生产共享 renderer 的隔离验证，未重复代码测试。416px / 720px 浅底、开播背景与深底零进度截图在 `tmp/gift-wish-moonlit/qa/revision-v4/`；收礼 20→25 保留节点，填充从约 46.8% 过渡至 50%，五项动画运行；零值无移动端点且保留折扇，控制台无错误。
- 独立复核将原开播封面与四张实际截图对照，结论为 `ship`，限于本次装饰调整；416px 下细小山水和叶脉作为纹理呈现。隔离浏览器与测试服务已关闭，未实播。
