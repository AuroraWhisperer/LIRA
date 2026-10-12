# 固定弹幕样式动效实施计划

Status: Completed

## Goal and scope

客户端 11 款内置固定弹幕拥有符合自身气质的入场与滑动，密集消息仍清晰易读。月渡花汀保持现状。随机、飘窗、服务器独立实现不在本轮范围；不改消息结构、持久化字段、公开接口、素材、配色或排版。

## Current behavior and ownership

固定列表统一采用 `420 + distance` 毫秒、760 毫秒上限和 `[0.3, 0.1, 0.2, 1]` 曲线，CSS 停用整条消息的入场。现有 motion 测试覆盖月渡花汀的双向、缩放、打断、文字像素和销毁。

- `public/css/overlays/danmaku/<style>.css`：本款入场关键帧与移动参数。
- `public/js/overlays/danmaku-feed.js`：位置、测量、同批同步、打断续接、淘汰和清理；保留已有 `top` 移动以保护文字栅格效果。
- `motion.css`：公共接入、边缘遮罩、减少动态效果与旧消费者兼容动画。
- `docs/reference/frontend/danmaku-motion.md`：唯一的逐款设计、维护规则与可复用提示词。从根 AGENTS、文档导航和 overlays 参考链接；检查使用指南及交互式引导是否受影响。
- 消息渲染核心及其来源锁不变。保留工作区已有未提交修改，不提交、发布或操作真实数据。

## Milestones and QA inventory

- [x] 核对 11 款既有造型，保存月渡花汀与公共代码基线，完成逐款动效表和提示词。基线月渡花汀 5 项通过。雪狐已有完整内部编排，复用它，只提供本款移动参数。
- [x] 样式 CSS 拥有本款移动参数，10 款声明新的整条入场，雪狐复用内部编排；feed 读取参数，缺省公式不变。仅新增整条入场使用 live 标记，快照不重播它；完成及减少动态效果时清理标记。
- [x] motion suite 27 项通过，包含 11 款双向移动、打断、不同高度、缩放、快照、正常完成、减少动态效果与销毁；月渡花汀原 5 项含文字像素检查通过。
- [x] 11 款均检查常速、密集、入场中间帧、稳定帧、上下方向和明暗背景，覆盖短长正文、表情、礼物及 SC。新增动作未缩放字形、未让旧行瞬移或穿过；密集输入后全部收稳，无积压播放。白色/浅色素材在浅底的原有对比限制已在 owner 文档说明，不声称适配所有直播背景。
- [x] 文档与规则已同步；其他受影响检查 29 项通过，文档 gate 10 项通过，语法检查通过。最终 diff/status 与测试服务清理见收尾记录。

## Verification

- `node --test test/danmaku/danmaku-feed-motion.test.js`
- `node --experimental-vm-modules --test test/danmaku/danmaku-feed-buffer.test.js test/danmaku/danmaku-overlay-renderer.test.js test/danmaku/danmaku-style-ownership.test.js test/danmaku/danmaku-snapshot-stability.test.js test/danmaku/danmaku-overlay-fullscreen.test.js`
- `node --experimental-vm-modules --test test/engineering/esm-module-boundaries.test.js`
- `Get-Content public/js/overlays/danmaku-feed.js -Raw | node --input-type=module --check`
- `npm run verify:docs`；`git diff --check`；触及差异与 `git status --short`。
- 隔离播放复用 `test/helpers/component-preview-server.js` 和项目 Playwright，导航前确认具体 URL 的 200 响应。证据存于 `tmp/fixed-danmaku-motion/`。月渡花汀 CSS 哈希不变，原专项通过。

## Failure handling and done when

公共参数缺失时沿用已验证默认。回归在 owning 层修复，不删有效断言；只撤回本任务差异，不覆盖原有修改。

完成要求：11 款有明确且已观看的动效；月渡花汀有保持不变的证据；公共机制未复制到各款；规则和提示词可指导维护；行为、视觉、文档均有实际证据。隔离浏览器检查不声称覆盖真实直播软件或生产服务器部署。

## Evidence and decisions

- 动效设计与维护提示词：[固定弹幕动效](../../../docs/reference/frontend/danmaku-motion.md)，由根 AGENTS 和技术文档导航引用。使用指南、README 操作和交互式引导没有新增入口、参数或操作步骤，因此未扩写产品说明。
- 先运行原 5 项月渡花汀检查，再用新增 bubble 用例确认旧代码没有独立入场。实现后 27 项全部通过；消息/快照/随机布局/CSS ownership/ESM 检查 29 项通过，文档检查 10 项通过，共 66 项。
- 新测试需等待字体与首轮布局稳定，并排除星语既有无限星光。航海气泡的小数宽度通过整数 offsetWidth 测量会有约 0.2 CSS 像素取整差；基线与新代码分别复现 `[0.203125, 0.1875, 0.1875]`。新增灵活宽度用例允许半个布局像素，不改月渡花汀原像素断言，不为该既有取整改写布局算法。
- 本地真实 `/danmaku?preview=1&style=…` 路由全部返回 200；逐款通过真实控件重播、向下再向上。隔离 feed 另外使用同一 CSS/JS 播放常速和每 160ms 一条的密集输入，记录中间帧、最终态及动态对照。
- 单页常速/密集采样的 rAF 间隔 P95 约 16.7–16.8ms，密集到达停止后全部收稳。该采样只描述本机隔离 Chromium，不作为真实 OBS/直播姬、不同 GPU 或生产源的帧率承诺。
- 月渡花汀 CSS 的 SHA-256 与本任务开始时完全一致；原移动常量、曲线和独立装饰未修改。雪狐原内部动效得到保留，仅新增本款移动参数。
- Impeccable detector 只报告青墨笺原有 3px 身份色边线；它属于已有视觉设计，未因通用警告删除。
- 临时复核页面、初始文件快照、逐款图片、播放指标和动态视频均在仓库 `tmp/fixed-danmaku-motion/`，不进入产品或版本控制。初始临时页面存在 `window.feed` 与同名 DOM 的初始化冲突，已在播放检查前纠正；最终对照页无脚本错误。

收尾：触及差异、`git diff --check` 与 `git status --short` 已核对，未加入生成物、秘密或运行数据，保留原有工作区修改。最终动态对照逐款播放 6 条合成消息，11 款均覆盖且无脚本错误；已关闭全部自有浏览器上下文和两个隔离服务，删除冗余录屏，仅保留最终回放与验收证据。未提交、打包或部署。
