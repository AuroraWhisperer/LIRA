# Horizontal Charm 与公共透视参数

Status: Completed

需求：将 Horizontal Charm 加入「横向滚动」第二项，按原作者演示实现，并让其他样式也能使用侧视。

## 目标与边界

在本地客户端、独立预览、画布和正式场景中提供同一款透明横栏：彩色昵称签、白色气泡、消息内表情、礼物／大航海／SC 提醒。以 [原作](https://www.etsy.com/listing/1656260287/horizontal-charm-chat-widget) 的公开视频为视觉依据，重写 DOM/CSS，不引入 Twitch 服务或运行时依赖。保留现有保存、鉴权、服务器事件与其他样式的默认行为；不提交、分支、打包或部署。

## 现状与归属

- `danmaku-style-options.js` 定义显示分类与参数；`danmaku-layout.js` 定义初始横栏区域，两者均保留本地 Node 镜像。
- `danmaku-message-renderer.js` 分派样式，`danmaku-feed.js` 已拥有横向让位、密集追加续接、撤回与清理。新款只拥有结构和装饰，不另建队列。
- 公共 `component-style-parameters.js` 已有 X/Y/Z 旋转与倾斜，`component-effect-filters.js` 同时拥有绘制变换与布局边界。扩展现有组的透视距离，不再另建一套透视参数。旧配置缺失距离时仍为 1000px。
- 样式目录由 `public/pages/admin/live-components/danmaku.html` 与 `admin/danmaku-style-catalog.js` 拥有。共享参数面板由 `component-style-parameter-view.js` 生成。
- 技术合同：`docs/reference/frontend/overlays.md`、`danmaku-motion.md`；用户指南：`docs/guides/component-style-parameters.md` 与应用内弹幕指南。引导入口本身不变。

## 实施与验证

- [x] 新款注册、结构、样式、默认区域和缩略图；复用安全文本／表情渲染与横向 feed。对照原片核实比例、留白、分层入场、空闲静止和事件提醒。长 SC 保留完整内容，避免源片的长句直接截断。
- [x] 复用公共 transform 的 `perspective`（400–4000px，默认 1000px）与正面／左侧／右侧快捷操作。调查时并发 Astral 任务已在同一公共 owner 实现这些字段和控件，本任务不重复实现。旧参数与零旋转保持原样；验证新款的入场、已有移动、恢复默认与跨样式独立保存。
- [x] 聚焦测试：`node --test test/danmaku/danmaku-message-renderer.test.js test/danmaku/danmaku-appearance.test.js test/danmaku/danmaku-layout.test.js test/danmaku/danmaku-style-options.test.js test/scenes/component-style-parameters.test.js`；受影响浏览器测试：feed-motion、component-style-effects 与 typography。
- [x] 隔离 Electron 完整路径：第四类第二项 → 参数和左右侧视 → 保存 → 重开 → 画布／正式本机场景输出；合成聊天、表情、礼物、上舰及 SC，并验证撤回／清空。检查密集抵达和窄横栏，不使用真实观众数据或用户正在运行的应用。
- [x] 更新拥有者文档，运行 `npm run verify:docs`、相应镜像检查；按共享变换的影响运行架构检查。最后检查本任务差异、`git diff --check`、`git status --short`，保留其他任务的并发改动。

## 失败处理与完成条件

仅根据 `tmp/horizontal-charm-20261108/before/` 和实际 diff 撤销本任务的编辑，不重置工作区。参考帧、QA 记录和临时工具仅放 `tmp/`。当新样式、公共透视、保存及场景输出均有直接证据，相关测试和文档同步完成，且最终差异复核通过时结束。公开原片可证明视觉行为，不能据此声称获得原作者源码或做到所有像素逐帧相同。

## 验收证据

- Node 五个拥有者测试文件 84/84；前期字体与公共外观浏览器测试 11/11；最终完整 feed-motion 47/47；架构门禁 30/30。早期布局可选区域与并发样式控件清单未同步的失败均已解决，最终 Node 组合重跑通过。13 文件语法与选项镜像检查通过；文档门禁在修正本计划状态标签后 10/10。
- 密集横向追加暴露卡片宽度取整比值引起的约半像素跳位；改用 feed 坐标缩放与消息 zoom 后，完整移动用例通过。最终原生缩略图还移除了公共礼物伪元素残留。
- 隔离 Electron 重启保留 Charm、间距 40、最大宽度 520、透视 1400 和向左侧倾；实测向右及正面预设，正面将全部角度恢复为 0 并保留透视距离。真实本机场景已发布并收到合成聊天、礼物、续舰、SC，撤回与停播清空通过，页面错误为空。
- 270 字 SC 保留全文，在 120px 区域内由公共 feed 缩放至约 0.408；需要大字号时应加高图层。640px 窄横栏、长昵称、行内合成表情、减少动态效果与空闲静止均检查；减少动态时运行中动画为 0。
- 截图和日志位于 `tmp/horizontal-charm-20261108/`。一次 Impeccable 检测返回 `[]`。独立完整视觉复核要求提高昵称白字对比度；仅压深昵称签底色后，五种身份实测为 4.70／4.66／4.73／4.58／4.77，后续 verdict 将该项评为 resolved／ship。没有扩大为全站或其他样式设计审计。
- 独立文档复核确认现有系统的窄扩展、四份拥有者文档与实现一致，无本任务遗漏；README 和导览入口不变，未重复增加指引。另款在当前分类中的位置随本次排序变化，已移除其当前指南中失效的「第二款」说法。
- 最终差异与状态已检查，未提交或暂存，未引入运行数据或秘密。自有 Chromium、隔离 Electron、预览服务均关闭，合成 profile 与 QA 留在 `tmp/`。未实播、打包或发布；不声明逐像素一致。过长 SC 在紧凑区域中会缩小，是既有公共适高合同的可读性限制。
