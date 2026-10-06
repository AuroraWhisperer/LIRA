# 月渡花汀弹幕姬

Status: Complete — 2026-10-05

## Goal

增加与银蓝月白开播动画配套的固定弹幕样式 `moonlit`：普通观众灰色，舰长霁蓝、提督藕紫、总督胭脂红；普通弹幕先显示中性矩形，再染入身份色与笔刷边缘。按用户最终参考，上任卡采用中央头像、两侧斜向错落题字、下方姓名带及三只鸟；普通礼物与 SC 共用精细银蓝花枝卷轴，保留头像、昵称、实际金额与完整内容。桌面预览与服务器浏览器源同步。

## Ownership and Current Behavior

- 客户端 `public/js/overlays/danmaku-message-renderer.js`、`danmaku-superchat-renderer.js` 负责安全 DOM；`danmaku-moonlit.js` 只组合主题装饰；`danmaku-feed.js` 继续负责列表、缩放、布局和清理。
- `public/css/overlays/danmaku/moonlit.css` 拥有主题排版与动画；Server 对应 `public/overlay/styles/moonlit.css` 与 `public/overlay/danmaku-moonlit.js`，仅素材 URL 前缀不同。
- 客户端/Server 的 style-options、layout 是镜像契约；桌面样式选择与服务器公开 overlay 共用相同主题。
- Server `src/lib/bilibili-danmaku.js::toOverlayGift` 沿用 RoomMonitor 的 final 礼物入口，投影受信头像与已购买等级。`giftGuardLevel` 来自规范化 `guard-N` 礼物 ID，或 guard 类型的确切礼物名；不依据送礼人的当前身份。
- Desktop `scene-cloud-controller.js` 的白名单校验并保留可选 `avatarUrl`、`giftGuardLevel`。现行展示说明见[前端叠加层](../../../docs/reference/frontend/overlays.md)；服务器规范为 `docs/requirements/moonlit-overlay.md`，字段见 `docs/protocol/public-overlay-api.md`。

## Compatibility and Non-goals

不改鉴权、结算、租户隔离、重连、事件数量或已有样式。不改变设置键、端点或事件类型。旧九样式 layout 只补默认 moonlit 区域，保留其他坐标与参数；其他缺失/未知键仍拒绝。新增 gift 字段可选，旧生产者沿用头像回退及普通礼物卷轴。保留两仓既有修改，不创建新的全局设计系统、运行时依赖或服务。本任务不含提交或部署。

## Implemented Changes

- 弹幕先保留中性矩形 500ms，再用 1600ms 从左向右染入身份色和笔刷边缘。头像旁复用项目现有 B 站三档大航海徽章。
- 上任卡的头像居中，左侧为斜向错落的两字称谓，右侧为同样错落的“上任”，姓名带在下。山水、月轮、背景与头像先以 1450ms 从上到下显现；1500ms 时开始，以 1550ms 从左到右显现题字、姓名及恰好三只鸟。
- 礼物与 SC 共用月白纸面、银蓝花枝、雕纹边框、滚轴与丝带的插画卷轴。头像、昵称和已结算金额独立渲染；礼物显示礼物名与数量，SC 在相同位置显示完整原文并保留空白、换行，不设正文固定高度。卷轴以 1600ms 从右向左展开；800ms 时开始，以 1600ms 从左向右显现上层花饰。SC 采用该主题配色，其余样式维持原价格色规则。
- 继续使用安全 DOM、头像/表情回退和原 feed 的完整卡片缩放；减少动态效果时直接显示完整内容。拥有大航海身份的观众送普通礼物不会触发上任卡。
- 合成预览先播放普通礼物，再播放舰长感谢，其余样例沿用随机无放回播放和清理机制。两仓同步素材、来源说明与由真实渲染器生成的缩略图；精确提示词和来源在素材 `provenance.json` 及九份 WebP sidecar 中维护。

## Milestones

- [x] 展示：独立主题模块、CSS 与透明插画已完成；安全头像/表情、实际金额与全文保留通过针对性测试。
- [x] 集成：样式选择、示例、缩略图、两仓枚举与旧布局兼容、头像/购买等级投影及相关规范已同步。
- [x] 验证：三档购买、普通舰长送礼、旧布局、长昵称/SC、回退、减少动态效果与入场时间完成验证；最终浏览器完整图和中间帧通过独立复核。
- [x] 收尾：文档门禁通过，两仓 diff 与状态已审阅；本任务测试进程和浏览器已关闭。

## Verification

- Live 的直接验证入口：`node --experimental-vm-modules --test test/danmaku/danmaku-moonlit.test.js test/danmaku/danmaku-layout.test.js test/danmaku/danmaku-style-options.test.js test/danmaku/danmaku-overlay-renderer.test.js test/danmaku/danmaku-superchat-renderer.test.js test/danmaku/danmaku-local-preview.test.js test/danmaku/danmaku-style-ownership.test.js`，以及受影响的 `test/scenes/scene-cloud-controller.test.js`。
- Server 验证涵盖 overlay layout/settings/gift/protocol、RoomMonitor 场次投影及完整 `e2e/overlay-moonlit.spec.js`。使用项目现有 preview server fixture 和 Playwright；不使用真实账号数据或重启用户应用。
- 最终文档门禁为 Server `npm run docs:check`；收尾检查为两仓 touched diff、`git diff --check` 与 `git status --short`。具体成功记录与证明边界见下文。

## Failure Handling and Done When

只撤销本任务新增文件或精确修改段，不使用整体回滚。普通弹幕、三档上任与礼物/SC 可从正式渲染链和本地合成预览显示，旧布局保留，相关验证通过、资料同步并完成 diff 审查后归档。线上生效另需部署；本次浏览器验证不等同于 OBS 或哔哩哔哩直播姬实播验收。

## Verification Record

### 第一轮记录（历史）

- 第一轮卷轴效果图为 `tmp/danmaku-moonlit/overview-final.png`、动效为 `moonlit-motion.gif`。当时 Live 受影响 72 项测试通过，新增预览后该完整测试文件 9 项再次通过；Server 相关 52 项 Node 测试通过，包括 USER_TOAST_MSG 三档购买、头像、重复抑制与租户隔离；当时浏览器文件为 3 项通过，文档门禁为 45 项通过，两仓 diff 检查通过。
- 当时独立 finish reviewer 要求 `recapture`：并行修改将 Live 卷轴替换为双横带/无框花笺，已验截图与代码不一致，且正式 feed 截图需待位置过渡结束。历史代码分别保存在 `tmp/danmaku-moonlit/validated-version/` 与 `concurrent-version/`。
- 后续用户明确要求修正卷轴精细度、题字位置、真实徽章及过快动画，最终行为已在本计划上文记录。此前“取消卷轴、轻淡入”和等待二选一的交接状态已被这一明确要求取代，不再是待确认条件；第一轮视觉材料不作为最终版本证据。

### 最终修订（2026-10-05）

- 最终装饰模块与 CSS 修改后，Live 直接相关 JavaScript 检查 26 项、Server 24 项通过。此前 Live 72 项、Server 52 项中未受本轮外观修订影响的后端/协议验证继续有效；没有把这些历史成功记录记作最新版本全量重跑。
- 修正最终卡片宽度后，完整 `e2e/overlay-moonlit.spec.js` 4 项通过：矩形停留和染色中间帧、三档上任及三鸟、普通礼物与完整 SC 的共用卷轴和相反展开方向、减少动态效果与表情回退。正式 feed 三档卡片无重叠；340×420 窄区域长 SC 完整收进区域。证据在 Server `tmp/browser-tests/16124/artifacts/`。
- 最终视觉材料为 Live `tmp/danmaku-moonlit/overview-v2-final.png`、`motion-contact-v2.png` 与 `moonlit-motion-v2.gif`。新一轮独立 finish reviewer 对照用户参考与正式 feed 的 640×900、窄区域截图，完成五项设计契约检查，结论为 `ship`，无实质修正项。
- `tmp/danmaku-moonlit/design-detection-v2.json` 为 `[]`；九张栅格素材来源扫描 0 缺失。两仓装饰模块、CSS（规范化素材前缀后）、九张栅格及来源 sidecar、缩略图一致。素材和来源说明沿用既有叠加层系统，没有新增 `DESIGN.md` 或 `.impeccable/design.json`。
- 最终 Server `npm run docs:check` 45/45 通过，两仓 `git diff --check` 通过；源码 diff 已审阅，既有无关修改保留。测试浏览器和预览服务已关闭，没有提交、部署或实播。
