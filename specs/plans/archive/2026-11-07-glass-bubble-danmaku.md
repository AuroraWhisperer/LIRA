# 随机玻璃气泡实施与对照计划

状态：Complete

## Goal

按用户选定的 [pabo 随机玻璃气泡](https://booth.pm/ja/items/9081874)及[作者演示](https://www.youtube.com/watch?v=f_qGJE_PTpU)重建客户端区域随机样式 `glass-bubble`，迭代对齐材质、颜色、字号、横向展开、逐字显示与 SC 扫光；可在桌面选择、保存，并从本机场景输出。

## Current Behavior / Ownership

现有 `glass` 是另一款固定通知卡，不能替代本款。`danmaku-message-renderer.js` 分派到各样式适配器，`danmaku-feed.js` 与 `danmaku-random-position.js` 拥有放置、避让、存活和清理。字体、字号、底色、停留及退场沿用公共参数与本机外观存储。模块与文档边界依据 `ROUTE-OVERLAYS` 及 `docs/reference/frontend/overlays.md`。

## Direction contract

- THESIS：复现原片中漂在画面上的玻璃对话气泡，不改成现有固定 Glass 通知卡。
- OWN-WORLD：银白玻璃、压在左上缘的小昵称牌、顶部高光、圆角与居中尾尖；SC 蓝／青／绿／黄／橙／洋红／红七档，上舰绿、礼物黄绿。默认 M PLUS Rounded 1c 粗圆字体，中文缺字回退本机中文字体。
- STORY：观众消息在区域内随机出现并避让已显示内容，展开后逐字可读，随后原地渐退；真实礼物和 SC 保留金额及完整内容。
- FIRST VIEWPORT：默认透明 1920×1080 区域；正文 27px、居中，姓名 21px；消息随文本宽度伸展，最大宽度约区域的 36%。生产画面不含原片光斑背景、宣传标题或原作者人物素材。
- FORM：用户已选定原站样式，按原片编码实现；不进行另选风格或生成替代设计。
- FINISH：原片与实际渲染逐段对照、独立视觉复核、桌面保存／本地输出、相关测试和文档同步均完成，才判定完成。

## Scope / Compatibility

新增样式独立 renderer 与 CSS，复用安全文本／表情与已有随机布局。只新增本款注册、区域缺省和能力表；不更改现有样式、公共 HTTP／WS／IPC、授权、持久化结构或服务器旧源。原站另售的管理程序（置顶、拖动、搜索、GIF 上传）不属于选中弹幕样式的复刻范围；保留 LIRA 的现有参数和操作方式。没有新依赖、私有下载任务、提交、打包或发布。所有研究视频与 QA 资料位于 `tmp/glass-bubble-20261107/`。

## Proposed Changes

- 新建 `public/js/overlays/danmaku-glass-bubble.js` 与 `public/css/overlays/danmaku/glass-bubble.css`，完成安全消息组合、金额档位、逐字片段与分层入场。
- 在 `danmaku-message-renderer.js`、`danmaku.css`、共享样式能力／布局、客户端选择卡及效果目标中接入；由既有同步脚本生成 Node 镜像。
- 字体保留原字形与 OFL；并行共享字体任务已将 M PLUS Rounded 1c 纳入现有字体库／CDN 交付，沿用本地 URL 与族名，本款不另建下载。缩略图由真实本地 renderer 生成。
- 既有 renderer、布局兼容及浏览器 suites 仅补具体信息丢失、输入安全、清理风险的覆盖；普通装饰不建截图快照测试。
- 技术文档 owner：`docs/reference/frontend/overlays.md`；参数及用户指引：`docs/guides/component-style-parameters.md`、应用内弹幕指南。入口步骤不变时不改互动引导。

## Milestones / Verification

- [x] 获取作者 1920×1080、30fps、34s 原片及七档配色图，确定默认结构和范围。
- [x] 实现样式并接入现有模块；核对字体、单行／换行、SC 七档、礼物与上舰真实内容。
- [x] 用实际播放对照展开、逐字和扫光；检查长文／表情、密集到达、退场清理及减少动态效果。
- [x] 隔离 Electron 选择→保存→重开→画布→本机场景，核实所选参数及同款输出。
- [x] 同步文档、完成视觉复核与最终 diff 检查。

命令：`node --experimental-vm-modules --test test/danmaku/danmaku-overlay-renderer.test.js test/danmaku/danmaku-style-options.test.js test/danmaku/danmaku-layout.test.js`；按实现影响定向运行 `danmaku-feed-motion.test.js`、`danmaku-typography-browser.test.js` 及公共效果 suite，不自动跑全库。执行已有同步脚本的 `--check`、相关 `node --check`、`npm run verify:docs`、Impeccable detector、`git diff --check` 和 `git status --short`。

QA 清单：桌面卡片／参数／保存恢复；普通、SC、礼物和开通／续费样式；字体与背景透明度在动画期间有效；七档颜色；长中英混排、组合 emoji 与 B 站表情保持安全完整；密集随机消息无重叠、旧消息不重播；SC 删除、到期及销毁释放；减少动态效果直接显示全文。视觉证据为默认终态、同文原片对照、展开／逐字序列与实际播放录制。

## Rollback / Done When

仅逆转本任务新增文件和插入行，修改共享文件前重读当前位置并保留并行任务编辑与暂存。关闭本任务启动的浏览器、HTTP 和隔离 Electron，核实临时路径后只清理合成 profile。完成条件为上述可观察行为与保真对照均有直接证据，聚焦检查通过或已明确说明范围外失败，文档与最终差异一致。


## Acceptance / Evidence

- 原片为作者34秒、1920×1080、30fps演示；同文长气泡宽度约原片416／本地415px，短句228／226px。采用27px正文、21px昵称，玻璃高光、连续尾尖及七档SC色已逐帧对照。记录保留于 `tmp/glass-bubble-20261107/`，包括原片、入场序列、深浅底色、七档、密集及窄区截图和 `actual-playback.webm`。
- 实际播放核实首版420ms底板展开、昵称延后280ms、正文延后600ms后逐字显现、SC扫光；后续美化将其收敛为380ms底板、140ms昵称、300ms正文和950ms柔和扫光，并为普通长文设置420ms总逐字预算，确保最短停留也在退场前显示全文。文字无缩放。14条密集消息无交叠，组合emoji和本地表情完整；背景0透明填色、减少动态效果全文直显、事件正常到期归零及共享效果恢复均通过。
- 隔离Electron真实preload／IPC选择保存后重开，Georgia／32px／#c7e8ff／40%背景／9秒停留均恢复；独立画布保存并应用，本机场景收到聊天、真实结算礼物与完整SC，SC撤回只移除该条。另测18／48px、100%／75%缩放，三类消息12组字形尺寸均符合选择。合成profile和本任务浏览器、HTTP、Electron已关闭清理，用户应用未重启。
- 86项定向Node／动效检查通过，公共效果6项通过；新renderer、分派、feed、effects语法及参数镜像检查通过，detector一次输出 `[]`，缩略图已嵌入实际合成renderer来源。现有全样式排版用例停在其他海风样式的missing gift content；本款用直接运行测量补证，不修其他任务。
- 独立视觉复核为 **ship**，范围为提供的截图及CSS动画实现；复核者未播放录制，不声称逐像素一致。独立文档复核通过；技术参考、参数指南和应用内说明已同步。互动引导入口及步骤未改变，无需修改。原有三种随机及通用礼物扫光的笼统旧文保留在既有范围，本款专节明确独立编排。
- `verify:docs`首轮9／10，唯一失败为并行Celestial计划的活动状态；相对链接等检查通过，归档后结果以最后运行记录为准。最终diff已检查，不包含临时资料、凭据或用户数据。

## 后续美化复核（2026-11-07）

在同一 renderer 上完成一次针对形状、配色、亮背景可读性和动效衔接的 polish：烟灰玻璃填色由透明度控件驱动，彩边改为低饱和方向性高光，昵称牌使用深色材质，尾尖改为柔和弧形，SC 扫光缩短并降低亮度；正文和上舰文案统一继承所选正文色。纯白底、深色底、复杂彩色底、透明填色、减少动态、七档 SC、15 条密集消息、长昵称／中英混排／组合 emoji／表情以及自定义字体和颜色均重新截图检查。新增 `test/danmaku/danmaku-feed-motion.test.js` 用例验证最短 2 秒停留与最长 1 秒退场下长弹幕在开始淡出前完整显示；本款动效与渲染定向检查通过，detector 输出 `[]`，`npm run verify:docs` 10／10 通过。实际播放录制和缩略图已更新到 `tmp/glass-bubble-polish-20261107/` 与 `public/img/overlays/danmaku-previews/glass-bubble.png`。

美化版独立完整视觉复核为 **ship**，限定于本款截图、有效入场序列及源码；首次动画序列因裁剪遗漏气泡被判为 recapture，已按实际随机位置的完整帧和逐帧测量坐标重新采集，最终序列为 `final-chat-entry-timeline.jpg`、`final-sc-entry-timeline.jpg`。文档复核确认技术参考、参数与应用内指南同步，并修正了历史限制中的亮背景旧描述。正文 27px 粗体在纯白底代表性位置测得约 3.97–5.15 对比度，不据此承诺任意透明度、文字颜色或直播底色。入口、持久化和互动引导步骤未变，本轮未重复桌面保存测试，也未实播或构建安装包。

## Limits

不声明压缩演示采样可达到逐像素／原源码一致；中文按系统字体回退，透明填色或复杂背景仍可按需使用共享文字描边。旧内核不支持CSS shape时回退圆角框。没有实播、安装包重建、提交或发布；共享字体的远程交付由并行字体任务负责。
