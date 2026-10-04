# 特效 2 · 缎带礼笺（第二个礼物边框）

Status: In Progress

需求：用户要求再加一个礼物边框样式，不限定从上下左右四边入场，并按金额与其他特效分档。

## Goal

在保留特效 1 · 林间花信（透明 WebM，四边同步入场）的前提下，新增特效 2 · 缎带礼笺：
礼盒从下方一角弹出、两条缎带一笔绕屏、在对角上方系成蝴蝶结并垂下礼签显示感谢文字，
约 5 秒，左右交替入场。两个特效各自有开关与门槛，同一笔 final 礼物只播门槛更高的那个。

## 非目标

- 不改动特效 1 的素材、时长、文字与中央安全区行为。
- 不引入预渲染视频、第三方动画库、构建步骤或新的进程/服务。
- 不做在线主题编辑器、不做运行时远程素材加载。
- 不改礼物记账、统计、冲刺、大航海感谢与官方礼物特效。

## 归属与兼容

- `src/bilibili/gift/frame-config.js` 持有两个特效的参数表与分档选择：`FRAME_EFFECTS` 顺序即并列优先级。
- 事件契约不变：仍是一个 `gift:frame`，`eventId` 仍是 `gift-frame:<giftEventId>`，只有 `themeId` 区分。
- `public/js/overlays/gift-frame-queue.js` 放宽为两个特效身份的白名单；队列语义（1 播放 + 最多 50 等待、按需去重、不按金额插队、不因等待失效）不变。
- `public/js/overlays/gift-frame-player.js` 是新的分发点，`gift-effects.js` 与 `gift-effects-component.js` 共用它。
- 特效 2 的美术与时间线归 `public/js/overlays/gift-frame-ribbon.js` + `public/css/overlays/gift-frame-ribbon.css` 所有。
- 粒子复用 `public/js/shared/guard-thanks-particles.js`，只做向后兼容的两处小改（`burst.origin`、`burst.spread`），不改变现有大航海感谢播放。
- 管理页「礼物边框」页签下变为两张卡片，各自保存与预览；`#giftFramePanel` 仍是无障碍 tabpanel。
- 设置键新增两条，旧键语义与旧废弃键处理不变；不需要数据库迁移。

## 实施

1. **服务端**：`FRAME_EFFECTS` 参数表、`normalizeFrameSettings` 返回每条特效一组、`selectFrameTheme` 按整数分取门槛最高者（相同取 `satin-ribbon`）、`normalizeFrameSettingValue` 覆盖四个键、`buildGiftFrameEvent` 去掉单主题假设；`settings-defaults.js` 与 `settings-contract.js` 的 `FRAME_SETTING_KEYS` 登记新键。
2. **客户端**：队列主题白名单；`gift-frame-player.js` 分发；`gift-effects.js` 支持 `?frameTheme=satin-ribbon` 预览；叠加层新增 `#giftRibbon` 与样式表。
3. **特效 2 播放器**：冻结 5 秒时间线，SVG 现建现拆，`stroke-dasharray` / `stroke-dashoffset` 实现一笔画出与收回，弹入的礼签用 `textContent` 写入；`dispose()` 与正常结束走同一清理出口。
4. **管理页**：两张卡片，各自开关、阈值、状态与模拟预览；预览按卡片带上 `themeId`。
5. **文档**：overlay / api / storage / ws / gift / app 契约、特效规格修订、使用说明与组件来源说明同步。

## 验证

- 单测：`gift-frame-config`（分档矩阵、新键白名单、预览主题）、`gift-frame-queue`（缎带主题接受、未知主题拒绝）、`gift-frame-admin`、`gift-frame-draft`（两张卡片独立保存）、`guard-thanks`（无 `innerHTML`/无 `infinite` 清单）、`scene-gift-events`、`runtime-event-publication`、`overlay-projection`、`engineering/run-tests`。
- 浏览器：`gifts/frontend-gift-frame-ribbon`（文字经 textContent、左右交替、动画有限、结束与中断都清理干净）、`admin/canvas-gift-components`（缎带预览复用同一画布图层）。
- `npm run verify:quick`、`git diff --check`、`git status --short`。
- 运行时：`/gift-effects?preview=1&debug=1&frameTheme=satin-ribbon` 多帧目视，确认中央直播安全区透明、文字不越界、两侧都正确；再在真实管理页各预览两个特效一次。

## 风险

- 已加载旧播放器的 OBS / 直播姬浏览器源会忽略 `satin-ribbon`，需要刷新浏览器源。
- `pathLength` 在 OBS / 直播姬的 Chromium 内核上假定可用，必要时回退 `getTotalLength()`。
- 礼签位于上方角落，会比特效 1 更靠近直播画面内容，需目视确认遮挡范围。
- 组件模式下即使只播缎带也仍会加载特效 1 的视频，这是现状，本次不处理。
