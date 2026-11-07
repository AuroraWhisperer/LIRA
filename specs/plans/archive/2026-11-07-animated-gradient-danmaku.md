# Animated Gradient 弹幕接入

Status: Completed

## Goal

按用户选定的 [GhostTypeStudios Animated Gradient 公开演示](https://www.etsy.com/listing/1365125747/animated-gradient-chat-widget)重建固定弹幕，逐段对照布局、颜色和动效；客户端可选择、保存，画布和本机场景使用同一实现。

## Current Behavior / Visual Contract

当前内置样式没有本款。参考原视频 1280×1010、30fps、15 秒，副本与分镜位于忽略的 `tmp/animated-gradient-20261107/`。参考表现为左上错位渐变昵称牌、白色圆角正文、同色细边与下方细横线，普通消息按内容宽度收放；事件为白色双边框紧凑条，渐变事件签从右侧出现。旧行先让位，新消息随后显现；昵称牌及边缘色持续变化。宣传画背景不是弹幕底板。

这是既有弹幕库的局部扩展，视觉方向已由用户钉选；不重新选择产品身份或生成替代设计。B 站没有 Twitch pronouns、follow/raid 事件的对应字段，不编造；现有身份、表情、礼物、上舰和 SC 使用真实内容适配同一视觉语法。

## Ownership / Proposed Changes

- 新增 `public/js/overlays/danmaku-animated-gradient.js`：复用安全文本与表情，组合本款聊天和事件 DOM。
- 新增 `public/css/overlays/danmaku/animated-gradient.css`：拥有字体、渐变、气泡、事件条及分层关键帧；现有 feed 继续拥有测量、移动、中断、到期和销毁。
- 现有 renderer 入口、样式能力表、布局默认、效果目标、客户端样式卡与筛选接线；Node／浏览器镜像遵循现有同步规则。
- 文档：`docs/reference/frontend/overlays.md`、`danmaku-motion.md`、`docs/guides/component-style-parameters.md`、应用内弹幕指南；互动引导只在步骤改变时修改。
- 测试：既有 renderer、style-options、layout、feed-motion、typography 及 component-effects suites。桌面验收用已隔离的 `test/fixtures/danmaku-canvas-editor.cjs`。

## Compatibility / Non-goals

只新增客户端本地样式 `animated-gradient`（渐变气泡）；不变更 HTTP／WS／IPC、账户授权、服务器 renderer、旧样式和用户数据。不新增依赖、进程、启动下载或第二套消息队列；不提交、打包、发布。旧画布仅补缺失的新区域。保留工作区其他任务改动与 `output/`。

## Milestones / Verification

- [x] 从原片测量尺寸、间距、字体特征、颜色周期和消息／事件入场时间，记录可比较分镜。
- [x] 实现完整聊天、礼物、上舰和 SC，接入选择与共用参数；验证安全文字、当前房间身份、实际金额、完整 SC 和旧布局兼容。
- [x] 使用同文案、同尺度与原片逐帧比较，修正具体差异；验收上下滚动、连续到达、减少动态效果、长文／表情和透明底色。
- [x] 隔离 Electron 中选择、修改字体／颜色／透明度、保存与重开，再通过画布保存并核实真实本机场景；缩略图取实际 renderer。
- [x] 完成独立视觉复核、同步文档，关闭自有测试资源；检查 touched diff、`git diff --check`、`git status --short`。

聚焦命令：

```text
node --experimental-vm-modules --test test/danmaku/danmaku-style-options.test.js test/danmaku/danmaku-layout.test.js
node --experimental-vm-modules --test --test-name-pattern="animated gradient|Animated Gradient" test/danmaku/danmaku-overlay-renderer.test.js
node --test --test-name-pattern="animated-gradient|animated gradient" test/danmaku/danmaku-feed-motion.test.js test/danmaku/danmaku-typography-browser.test.js
node --experimental-vm-modules --test test/overlays/component-style-effects.test.js test/scenes/component-style-parameters.test.js
node scripts/sync-danmaku-style-options.cjs --check
npm run verify:docs
```

动画比较看每层形状、出现顺序与时间，不能只看静态截图；不以公开视频推断作者源代码或精确字库。图片／视频只用于研究，不交付到生产目录。

## Verification Evidence

- 原片测量与静态对照：44px 昵称牌、20px 左错位／12px 重叠、19px Montserrat 近似字形、细线及事件双框；聊天与事件标签按分镜校正出现顺序。参考与最终证据位于 `tmp/animated-gradient-20261107/`，包括 `final-comparison.png`、`event-final-timeline.png`、原片与分镜。
- 既有样式参数／布局 24 项、渲染与事件时间到期 2 项、共用效果 12 项通过。动效／窄区域聚焦 3 项在最后 CSS 修改后通过，覆盖持续动画开关、不同高度消息移动中断、320px 区域／40px Georgia 下的完整文字、表情和单行金额。
- 同条件诊断修复了移动曲线首个 Y 控制点超过 1 时，几何重测令部分行采用不同续接速度的交叉问题；仅把本款曲线调整为 `.22,1,.36,1`。移除继承的通用礼物扫光，保留本款独立分层动效。
- 连续播放上下方向各 5 条混合事件与 16 条密集聊天后保留可见 6 条，无重叠、字形变换或残留入场标记。关闭循环、减少动态、透明底与公共描边在实际 renderer 核验。
- 隔离 Electron 通过真实 preload／IPC／本地授权流程选择本款，保存 Georgia 28px、`#23455d`、底色 0%，刷新及完整退出重启均恢复；画布应用后本机场景接收合成聊天、礼物与完整多行 SC，计算字体／颜色／透明度一致。仅使用 `tmp/` 内合成账户，证据为 `desktop-roundtrip.json`、桌面与场景截图。
- 初次独立复核要求修复最大字号窄区域事件标签被挤成竖列的问题；事件签空间不足时改为下一行，金额保持完整同一行，正常宽度继续重叠。对应截图已重拍，复核将唯一修正项评为 resolved，disposition 为 ship；该裁决限定于修正项，不冒称全新全量复核。
- 完整排版文件曾在其他进行中的 `celestial-horizontal` 礼物内容检查失败；本款聚焦排版检查通过。未据此修改其他样式，也未声明工作区全部测试通过。
- 字体公共注册与共享 CDN 包由同日共享字库任务维护，沿用其当前入口；本任务不重复声明或发起下载。互动引导入口／步骤未改变，无需修改 tour。
- 独立文档复核核对 renderer／CSS、能力／布局／feed／效果、字体入口及最终截图，确认技术参考和用户指南一致；没有创建或改写产品级设计文件。
- 镜像与三份相关 JS 语法检查通过。自有 Chromium、HTTP fixture 和隔离 Electron 已关闭，核实进程退出后删除对应合成账户目录；首个验证 REPL 超时后的隔离 Electron 也已按精确路径清理，保留研究及 QA 证据。工作区其他改动与 `output/` 均保留，未提交、打包、发布或开展真实直播验收。
- 后续美化复核发现字号提高后事件姓名／金额仍固定 17px、渐变折返过硬以及浅色渐变上的白字辨识度不足；已改为 17/19 比例跟随正文、`ease-in-out` 折返并加入轻量紫灰文字阴影。票券保留最小内容宽度，金额不会被压出边框；上下方向各 20 条混合消息的当前 CSS 播放均无重叠、字形变换或残留入场标记。追加验证证据位于 `tmp/animated-gradient-polish-20261107/`。

## Rollback / Failure Handling

先确认当前差异，只撤销本任务新增模块和接线，保留其他任务与 staged 内容；不使用 reset 或 blanket checkout。测试仅使用合成消息和 `tmp/` 内隔离账户，关闭自己启动的浏览器、Electron 和 HTTP fixture。

## Done When

用户选定的视觉与动画已完成实际对照并修正可见差异；真实消息语义完整，公共参数保存后进入本地场景；聚焦验证通过、文档同步且差异已检查。明确公开压缩参考和未实播环境的证据边界。
