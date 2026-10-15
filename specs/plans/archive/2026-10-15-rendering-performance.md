# 无损渲染性能优化

Status: Completed

日期：2026-10-15。

## Goal

排查默认桌面歌词及相邻常驻渲染路径的无效开销，在保持画面、动效、同步精度和功能能力的前提下减少重复工作。以可重复的操作计数、运行时画面对照和已有回归确认收益，不将局部计数等同整机 CPU 百分比。

## Constraints / Non-goals

- 保留当前工作区的歌词外观、默认值及其他已有修改；不提交、不发布。
- 不降低帧率、画质、阴影、动画、显示行数、同步频率，不修改现有自适应性能策略。
- 不修改 HTTP/WS/IPC、存储、认证、Electron 安全或用户配置。
- 不优化缺乏证据的路径，不引入依赖、通用框架或后台服务。
- QA 使用仓库 `tmp/` 内的隔离数据及合成歌词，不操作用户运行中的桌面程序。

## Current behavior / Ownership

- `public/js/shared/lyric-word-animator.js` 每帧为未开始和已结束的词重新设置 WAAPI 时间、反复调用 play/pause；manual/static 路径重复写相同 clip-path。
- `public/js/lyrics/desktop-lyric-renderer.js` 每帧重写相同倒计时状态；完整设置和时间轴重复送达时重做样式、布局和节点构建。
- `public/js/shared/lyric-word-renderer.js` 只检查 document 可见性，需核对管理页隐藏预览是否继续运行。
- 相邻管理时钟、特效、数据轮询先检查已有按需调度实现，仅对有证据且能独立验证的冗余工作修改。
- 管理页加班机 `admin/overtime-status-view.js` 逐帧计算秒级时钟；复用直播源已有的 `nextClockDelay`，由 `shared/overtime-time-format.js` 与格式化共同拥有显示边界。直播源算法原样迁移，管理页更新不再依赖显示器刷新率。
- 契约 owner：`docs/reference/frontend/overlays.md`；消费者：桌面歌词预览、`/lyrics`、全民 K 歌歌词；测试 owner：`test/lyrics/lyric-word-motion.test.js`、`test/lyrics/desktop-lyric-renderer.test.js`、`test/lyrics/desktop-lyric-publication.test.js` 及已有布局浏览器测试。

## Milestones / Verification

- [x] 保存任务前基线，记录默认连续逐字效果的动画操作和 DOM 写入；隔离 Electron 使用实际歌词 DOM/CSS。
- [x] 在原 owner 中合并未变化的动画/倒计时/设置工作；扩展现有测试验证重复更新、前后跳转、暂停恢复和模式切换。
- [x] 核对隐藏预览与相邻热点；只有不改变可见行为且有恢复验证的优化才落地。
- [x] 运行直接受影响的 Node 测试和歌词布局浏览器测试；Electron 对照画面、动画进度与开销。
- [x] 更新实现契约，核对用户指南无变化；运行 `npm run verify:docs`，按共享渲染修改范围运行架构检查，检查最终 diff、`git diff --check`、`git status --short`。

聚焦命令：`node --experimental-vm-modules --test test/lyrics/lyric-word-motion.test.js test/lyrics/desktop-lyric-renderer.test.js test/lyrics/desktop-lyric-publication.test.js test/lyrics/lyric-performance.test.js test/lyrics/desktop-lyric-layout-browser.test.js`。如新增其他 owner 改动，先补充其直接回归再执行。

加班机验证：`node --experimental-vm-modules --test test/overtime/overtime-status-view.test.js test/overtime/overtime-appearance-order.test.js test/overtime/overtime-quantity-boundary.test.js test/overtime/overtime-overlay.test.js test/overtime/overtime-overlay-runtime.test.js test/overtime/frontend-overtime.test.js test/admin/frontend-admin-runtime.test.js`；说明 owner 为 `docs/reference/frontend/app.md` 与 `docs/reference/frontend/overlays.md`。

## Failure handling / Done when

任一画面或时序差异先定位，不以放宽断言通过。必要时只撤销本任务对应补丁，保留基线用户修改。完成条件为落地项均有回归和开销依据，默认画面与交互不变，相关文档一致，隔离进程已清理；未覆盖机器上的体感不作保证。

## Evidence

- 隔离 Electron 43.2.0 使用实际歌词 HTML/CSS/ESM、80 行合成歌词、默认连续逐字效果。用户数据目录为 `tmp/rendering-performance-20261015/electron-data`，内存会话、随机端口、无主应用单实例锁或真实用户数据；测试实例和 HTTP 服务已关闭。
- 同一 6 秒可见播放窗口，动画时间写入 2741 → 26，play 调用 194 → 26，pause 调用 2728 → 26，歌词 DOM mutation 183 → 1。rAF 回调 1427 → 1442，保留原刷新节奏；两次均未进入低效果档。单次 renderer TaskDuration 1.811 → 1.671 秒仅作观测，不作为整机 CPU 降幅承诺。
- 隐藏后的 1.5 秒窗口，刷新回调 358 → 1（隐藏交接时已排队的回调），TaskDuration 0.084226 → 0.002063 秒；稳定隐藏后不再维持循环。
- 7 组 PNG 字节完全相同：前奏、连续高亮、倒计时、下一句、按字点亮、关闭逐字、开启描边/模糊/缩放/弹性滚动/三行居中。额外运行中隐藏跨句、重新显示、暂停、向后跳转均保持时钟和高亮；20 次相同设置/时间轴更新产生 0 DOM mutation，并保留手动浏览状态。
- 全民 K 歌由 `playback/services/wesing-service.js` 指定整个 `playbackWeSingView` 为可见区域，覆盖歌词之外的时间与进度；不使用单独歌词行的离屏状态暂停这些输出。共享逐字进度缓存有内容替换与后退跳转回归。
- 管理页加班机复用直播源原有显示边界算法，正常秒级显示每秒调度一次，天/年级按对应可见单位调度；状态变化即时刷新，无暂停/隐藏/归零循环，覆盖跨天降档和旧状态拒绝。
- 相邻入口静态核对：性能检测由用户主动触发；粉丝与资源样式面板已有可见性保护；礼物滚动、开播和背景效果已有各自启停；来源采集和状态轮询未因本次优化降频。
- 技术参考及测试索引同步。核对应用内配置指南、交互引导和组件使用指南：本任务无新入口、参数、显示规则或操作步骤，用户指南无须另行修改；同时保留工作区并行歌词配色改动。
- 原始计数、PNG 和交互记录在仓库忽略目录 `tmp/rendering-performance-20261015/`；仅支持该合成场景，未代表用户所反馈机器上的整机 CPU/GPU、OBS/直播姬实播或正式安装包性能。
- 最终合并运行 17 个直接相关测试文件，共 110 项全部通过（歌词、布局、性能策略、全民 K 歌、管理页计时、直播计时及管理生命周期）；日志为上述临时目录的 `regression.log`。`npm run verify:architecture` 27 项通过，8 个修改运行时模块语法检查通过，`npm run verify:docs` 10 项通过，最终差异检查通过。仅运行与本次边界有关的检查，没有运行全库测试或打包。
