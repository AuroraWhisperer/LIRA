# 线框星事弹幕实施计划

状态：Completed（本款已完成；工作区其他改动的门禁限制见 Verification 记录）

## Goal

按用户选定的「线框星事」公开视频复现布局与分层入场，加入客户端固定弹幕库，并验证桌面保存与本机场景输出。

## Current Behavior

参考：兔宝的神奇口袋，[BV1Uw8v6XENM](https://www.bilibili.com/video/BV1Uw8v6XENM/)，2026-08-24。已下载公开演示到忽略的 `tmp/wireframe-20261106/`，按 30fps 原片检查 18–43 秒清晰展示段；生产资源不包含该视频、作者头像或背景。

- 普通弹幕：宋体正文，Times 风格拉丁文，约 0.8em 昵称；左侧约 1.9em 圆头像，正文框与头像间约 0.425em。
- 普通与舰长短句宽度随内容变化，背景和横线向右渐隐；提督双线矩形与细刻度，总督较厚双框和对角四芒星。
- 礼物与 SC：通栏半透明黑底、头像与昵称/金额同列、分隔线，下行为礼物或完整留言；金额不与数量重复结算。
- 上舰：居中头像、三道左右横线、罗马档位、昵称、舰徽及「已入列」；约 1 秒依次展开。
- 聊天入场约 0.65 秒，先头像/圈线，再框与底色，最后昵称和正文；文字保持最终字号和排版。

## Ownership

- `public/js/overlays/danmaku-wireframe.js` 负责本款 DOM，复用安全文本/表情解析与共用舰徽；不另建连接、队列或计时器。
- `public/css/overlays/danmaku/wireframe.css` 负责几何和分层动效；共享 feed 保留位置、插入、中断及清理所有权。
- 样式注册、客户端卡片、布局与样式参数能力沿现有 owner 接入；Node 样式契约由既有同步脚本生成。
- 文档 owner：`docs/reference/frontend/overlays.md`、`danmaku-motion.md`、`docs/guides/component-style-parameters.md`。
- 测试：既有 renderer、style-options、layout、feed-motion suites；桌面使用 `test/fixtures/danmaku-canvas-editor.cjs`。

## Compatibility Constraints / Non-goals

只新增客户端本地样式 `wireframe`，不更改服务器渲染、HTTP/WS/IPC、持久数据格式、授权、Electron 生命周期或用户数据。旧布局缺少新区域时补默认并保留原区域。现有其他样式、用户修改、`output/` 和其他任务计划保留。无新增依赖、启动下载、打包、提交或发布。

## Milestones

- [x] 核对原片布局、角色档位与动画顺序，记录对应时间段和比例。
- [x] 新增 renderer/CSS 并接入选择卡、默认布局、公共参数与真实预览缩略图。
- [x] 验证普通/舰长/提督/总督、礼物、开通/续费、SC、表情及非本房间身份；现有 suites 覆盖安全语义和布局兼容。
- [x] 隔离 Electron 中检查实际客户端；同一 renderer 的持久浏览器中逐帧对照实际入场、连续密集消息、两个滚动方向、长文/表情及减少动态效果；修正昵称字体/颜色、头像间距、礼物宽度和上舰姓名比例。
- [x] 桌面选择→保存→重开→画布/本地场景输出，核实真实保存样式及参数，完成文档与 diff 检查。

## Verification

`node --test test/danmaku/danmaku-style-options.test.js test/danmaku/danmaku-layout.test.js test/danmaku/danmaku-overlay-renderer.test.js test/danmaku/danmaku-feed-motion.test.js`；按实际文件需要使用项目既有 Node VM 参数。预期新增样式通过现有行为覆盖、身份仅依据本房间字段、真实金额/留言完整且无注入，旧布局不丢失。

UI QA 清单：固定样式卡可找到、选择即时预览、字体/字号/颜色/底色透明度可保存、重开持久化、本地场景输出为同款；截图对照头像/框/昵称/正文的相对尺度和各层时序。异常分支使用缺失头像/缺失金额及密集长文，禁止真实账号数据。检查 CSS 动画有限、旧节点不重播、减少动态效果静态完整。脚本及截图均放 `tmp/wireframe-20261106/`。

文档修改后运行 `npm run verify:docs`；最终检查 touched diff、`git diff --check`、`git status --short`。不以静态截图或测试通过宣称与公开视频逐像素相同。

### 2026-11-06 验证结果

- `node --experimental-vm-modules --test test/danmaku/danmaku-style-options.test.js test/danmaku/danmaku-layout.test.js test/danmaku/danmaku-overlay-renderer.test.js`：32/32 通过。
- `node --test --test-name-pattern=wireframe test/danmaku/danmaku-feed-motion.test.js`：1/1 通过，检查移动中断、旧节点保留及入场不重播。
- `node --experimental-vm-modules --test test/overlays/component-style-effects.test.js test/scenes/component-style-parameters.test.js`：8/9 通过，包含所有内置样式效果应用/恢复；唯一失败为另一任务的 Glass 仅加入 Node 能力表、浏览器镜像尚未同步，wireframe 两端均为 frame。
- 四份接线/新模块 `node --check` 与 `node scripts/sync-danmaku-style-options.cjs --check` 通过；Impeccable mechanical detector 对新 CSS/renderer 输出 `[]`。
- 隔离真实 Electron：选择 wireframe，保存 26px，重开恢复；画布改为 28px 并「保存并应用」，发布版本为 1；正常本地 `/scene` 返回 200，内嵌 `/danmaku` 实际 `data-style=wireframe`、字号 28px，桌面再次重开恢复 28px。临时授权 fixture 的十分钟会话过期后重开了本任务实例完成验收，没有改变生产授权流程。
- 真实 CSS 动画在 0/180/360/630ms 与上舰 0/200/450/700/1000ms 采样，文字自身 transform 始终 none，头像/描框/名字/正文顺序可见。上下两方向各连续追加 8 条，终态保留可见 4 条且无重叠；减少动态效果时正文 opacity=1、动画数为 0。默认头像缺失、金额缺失、长文与表情另经 renderer/实际播放核对。
- 12 项实际排版测量覆盖聊天/礼物/SC ×18/48px ×1/0.63 倍缩放，所选 Georgia 字体和字号均正确；全样式 typography suite 一次执行停在其他任务的 `dark-moon: missing gift content`，未改写该款断言或源码。
- 独立只读视觉复核结论 ship，比较了原片清晰段、最终聊天/小尺寸预览及两套动效序列；未发现本范围内实质差异。压缩原片不能证明原作者字库或逐像素相等。
- 技术参考、动效说明、参数指南及应用内指南同步；互动引导原入口/步骤没有改变，无需修改。没有新增服务器镜像或真实平台请求。
- `npm run verify:docs` 首次 9/10：唯一失败为另一任务 `2026-11-06-danmaku-stardust.md` 的状态标签未被门禁识别；全部文档链接通过。本计划没有因此改写其他任务文件。最终命令结果如有变化在归档摘要中记录。
- 最终差异检查无空白错误；原片/分镜、播放与桌面证据保留于忽略的 `tmp/wireframe-20261106/`。本任务浏览器、Electron、HTTP 夹具已关闭，三个合成用户目录已删除。未使用真实账号数据，未提交、打包、发布或进行 OBS/哔哩哔哩直播姬实播。

### 2026-11-07 视觉与模块配合复核

- 保留默认白色细线、宋体／Times 正文、身份层级和分层节奏；公开参考与默认截图对照后没有需要改动的证据。公共字体、正文色、装饰描边与文字描边能更新已有节点并正确恢复，没有新增控制器、连接、请求或计时器。
- 修复底色透明度在入场中被图层动画覆盖的问题：用户透明度改写背景颜色 alpha，动画继续拥有图层 opacity。修复 320px 区域、48px 正文及长昵称下礼物／SC 金额溢出和正文缩进过大的问题，正文仍保留用户所选字号；默认 480px 区域、24px 正文的金额保持 21.12px。
- 既有 feed-motion 与 typography suites 新增对应行为回归；`node --test --test-name-pattern=wireframe test/danmaku/danmaku-feed-motion.test.js test/danmaku/danmaku-typography-browser.test.js` 为 3/3，通过实际像素 alpha 与窄区排版检查。renderer 聚焦运行 1/1 通过，保留安全表情、真实身份／金额与完整可撤下 SC 的覆盖。
- 全 typography 文件执行一次，wireframe 与 Glass 通过；现有跨样式用例停在其他任务的 `sea-breeze: missing gift content`，没有改写其他样式或断言。
- 实际播放上下两方向各追加 5 条混合消息与 16 条密集消息，终态各保留 8 条、无重叠，正文 transform 为 none；减少动态效果时完整静态显示。额外动画帧确认入场标记与已完成动画均释放。
- 隔离真实 Electron 保存 Georgia、28px、正文色 `#f0ccae`、底色不透明度 0，重开恢复；画布预览与「保存并应用」后的本机场景均返回 200，实际渲染使用所选样式与参数。证据保留在忽略的 `tmp/wireframe-review-20261107/`，不保存原始能力地址。
- 独立只读视觉复核结论 ship，无实质问题。浅底上的白色线条仍受原款设计对比度限制，可使用现有颜色／描边参数；没有自动换色或更改原款设计。
- 技术参考、动效说明、参数指南与应用内指南已同步；原入口与操作步骤不变，互动引导无需修改。
- `npm run verify:docs` 10/10 通过；Impeccable detector 对本次 CSS 输出 `[]`。本任务浏览器、Electron 与 HTTP 夹具已关闭，合成用户目录已核实路径并删除；证据留在 `tmp/`，无运行数据进入源码。

## Rollback Or Failure Handling

只撤销本任务新增文件与插入行，先核对共享文件的当前 diff，保留其他任务编辑和 staging；不使用 reset、checkout 或批量删除。测试实例仅使用独立临时数据并由本任务关闭。

## Done When

样式可在客户端选择并保存，重开和本地场景正确使用；原片中的主要几何、角色区分和入场顺序均经对照确认；聚焦测试与文档门禁通过，说明未覆盖的实际直播软件条件，最终 diff 不含参考视频、运行数据或秘密。
