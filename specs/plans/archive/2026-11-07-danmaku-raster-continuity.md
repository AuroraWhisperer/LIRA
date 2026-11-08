# 弹幕绘制连续性修复

Status: Completed

## 目标与范围

修复内置随机弹幕及其他弹幕中动画期间模糊、结束时字形或位置突变的同类问题。以漫画对白截图为入口，覆盖内置样式的正文入场、公共到期渐隐、固定列表与飘窗位移；保留现有造型、参数、速度和用户特效。第三方导入 HTML、远端旧 renderer、打包发布不在本次范围。

## 当前证据与归属

- 漫画正文与通用随机入场直接动画 `opacity`、`translate`、`transform`；共享 feed 的到期渐隐同样直接动画整卡 `opacity`。
- 固定弹幕上轮已将整卡入场改为不继承的注册属性，但仍需审查内部文字层以及飘窗的整卡位移。
- 机制归属 `public/css/overlays/danmaku/motion.css`、`random-entrance.css`、`danmaku-feed.js`、`danmaku-floating.js`；逐款视觉决定留在样式 CSS。沉笺使用自己的现有 RAF 绘制，不复制控制器。
- 契约归属 `docs/reference/frontend/danmaku-motion.md`、`overlays.md`；操作入口与参数不变，核对使用指南而不新增操作说明。

## 约束与方案

沿用当前 CSS 注册属性的绘制时插值方式，避免正文依赖低分辨率合成纹理。只修改实际会影响文字或动画交接的路径；明确模糊正文的入场改为清晰文字渐显。保持位置测量、寿命、撤回、减少动态效果、快照不重播和销毁语义。不得覆盖工作区已有的样式、参数和其他功能修改，不提交或发布。

## 实施与验证

- [x] 清点所有内置样式、入场模式与运行时动画目标，记录实际文字绘制路径及需要修改的层。
- [x] 修复随机样式、公共退场和其余确认存在的文字绘制问题；复用已有机制和测试。
- [x] 在隔离服务的真实 Chromium 播放中核验缩放 iframe、聊天/礼物/上舰/SC、模式、快照与实时追加、淡出及循环交接，保存证据到 `tmp/danmaku-render-audit-20261107/`。
- [x] 执行受影响的 `test/danmaku/` 生命周期/布局/renderer 测试、`test/overlays/component-style-effects.test.js`，修改 JS 的语法检查及 `npm run verify:docs`。不新增普通视觉数值或截图快照测试。
- [x] 同步契约，审查本次差异，执行 `git diff --check` 和 `git status --short`，关闭自建浏览器/服务。

## 完成结果与证据（2026-11-07）

- 清点 42 款内置样式及 38 个模式场景；41 款 CSS 驱动样式完成动画与静态交接对比，沉笺单独验证现有 rAF 路径。直接动画文字的透明度／变换、恒定透明度占位动画和部分重叠装饰，会在缩放画布中改变合成纹理及文字采样。修复沿用注册属性绘制插值；变换终点采用单位变换，避免与 `none` 离散交接。
- 公共随机上浮、内部显字与到期淡出已修正；飘窗以 `left` 推进，独立 `scale` 继续负责适配，保留用户变换。纸笺轻浮、雪狐礼物装饰、共用扫光、星语、星轨和月渡卷轴按实际文字重叠结果修正。星尘去除正文与昵称的入场模糊；沉笺仅玻璃底片使用景深模糊。
- 漫画、小窗、纸笺向上、雪狐向下、通用上浮、星轨横移及沉笺完成密集实播模拟：每 110ms 追加一条，共 12 条，1920×1080 iframe 缩放为 0.53。采样未见大于 40ms 的帧间隔或页面错误，销毁后节点和动画均为 0。采样性能结果只代表本机隔离场景，不等同所有设备或直播软件性能承诺。
- `node --experimental-vm-modules --test --test-concurrency=4` 执行 `test/danmaku/` 下的 `danmaku-feed-motion.test.js`、`danmaku-feed-buffer.test.js`、`danmaku-overlay-fullscreen.test.js`、`danmaku-floating.test.js`、`danmaku-random-position.test.js`、`danmaku-overlay-renderer.test.js` 及 `test/overlays/component-style-effects.test.js`，88/88 通过。最后雪狐／沉笺修正后执行沉笺与组件效果 11/11，通过的不同用例合计 93 项；工作区同时发生沉笺气泡修改后再执行 `danmaku-sinking.test.js`，5/5 通过。没有重复计数或修改其他任务的气泡实现。
- 三个修改的运行时 JS 与两个测试文件通过 `node --check`；`npm run verify:docs` 10/10 通过。已审查基于本轮保存基线的差异，`git diff --check` 通过，`git status --short` 无本任务临时或运行时数据。隔离 Chromium、上下文和预览服务已关闭。
- 技术契约已同步到 `danmaku-motion.md` 与 `overlays.md`；现有功能测试改为检查实际淡出与用户变换组合。操作入口、设置及使用步骤未变，核对后无需修改用户指南。
- 清单、几何／透明度对照、交接图、密集播放结果、视频、测试日志与逐文件基线保存在 `tmp/danmaku-render-audit-20261107/`。像素对照用于本次诊断，不作为永久视觉快照测试；雪狐最后一处差异在全量对照后单独修正复核。
- 本次本地实现及隔离验收完成；未进行真实 B 站直播、OBS／哔哩哔哩直播姬实机验证，未提交、打包或发布。

## 失败处理与完成条件

测试失败先查所属原因并聚焦复测；如绘制修正破坏样式层次、动画交接或用户变换，则修正同一 owner 后再验证。仅按 `tmp/` 中本次基线撤回本次编辑，不使用整体回滚。所有内置样式的路径均已审查，已确认的问题得到修复，运行时证据与聚焦回归通过且无已知未处理的同类路径，方可完成。
