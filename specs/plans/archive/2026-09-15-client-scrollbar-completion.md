# 客户端滚动条完整实施与验收计划

**状态：已完成（2026-09-15）。** 用户要求分阶段完成滚动条报告的全部任务，再进行整体验收。

**Goal:** 完成 `docs/reports/2026-09-15-client-scrollbar-audit.md` 的区域取舍、设计规范、风险防护和验收标准，并逐项记录当前代码与运行证据。

**Architecture:** 保持 Electron 主界面、原生滚动机制和现有无构建 ESM/CSS 架构。布局修复归所属页面，皮肤归共享桌面主题，自动展示及歌词跟随归已有渲染器；不增加服务或依赖。

**Tech Stack:** Electron 43.2.0、Node.js 24+、原生 CSS、Vanilla JavaScript ES modules、node:test、现有 Playwright。

## 约束、当前行为和归属

- 按仓库 `PLANS.md` 执行，在当前任务内分阶段实施，不自动提交、分支或发布。
- 首轮已实现五项重点修复、280–380px 稳定桌面队列、统一 12px 槽位及 6/8px 滑块；当前工作树包含首轮和用户的其他改动，逐文件保留。
- HTTP/WS/IPC、认证授权、存储格式、设置键、Electron 安全和第三方登录页面保持既有边界。OBS 参数保留兼容；改变默认显示策略时记录与测试。
- 不将设计建议解释为无限功能扩展。条件风险必须检查并记录结论，必要时修复；“保留”的区域也必须有证据，不能只检查新代码。
- 非目标：业务功能重构、换主题、增加滚动条设置页、模拟滚动条、外部服务接入。
- 所有测试使用隔离配置和合成数据；不登录、发送消息、写入真实业务记录或修改用户系统偏好。
- 所属路线：`ROUTE-ADMIN`、`ROUTE-PLAYBACK`、`ROUTE-OVERLAYS`、`ROUTE-GAMES`；契约见 `docs/architecture/frontend/pages.md`、`playback.md`、`overlays.md`，以报告的具体区域为实施边界。

## 阶段一：操作页面、辅助页面和滚动边界

**涉及：** `public/css/license.css`、`public/css/admin/responsive.css`、`public/css/overlays/desktop.css`、`public/css/playback/responsive.css`、菜单/抽屉/对话框所属 CSS、报告列出的长文本/表格容器；必要时对应 HTML 与聚焦逻辑。

- [x] 复核四个主工作区、七个点歌标签页、十三个百宝箱面板，在三个报告尺寸和侧栏/播放器状态下测量横向溢出、主滚动层及内容可达性。
- [x] 登录页面使用唯一正文滚动入口，保持标题栏可达；长错误、注册/登录模式、短窗口均验证。实现入口是 `.license-main` 的可用高度及 `overflow-y:auto`，不修改认证流程。
- [x] 页面缩放使有效宽度低于 900px 时，桌面主区依然可滚动且标题栏、播放器不被根滚动带走；浏览器兼容布局与桌面主题分别验证。
- [x] 菜单、抽屉、确认框、引导、通知和局部编辑器以真实打开/关闭和滚轮/键盘输入验证。浮层边缘使用所属滚动区的 `overscroll-behavior:contain`；普通队列继续释放边缘滚轮。
- [x] 合成长用户名、网址、模型名、备注与多列表格，优先在所属区域换行/省略/横滚，不以主区裁剪掩盖控件。
- [x] 对工作台短窗口的三层阅读风险进行实测，减少重复滚动；保留常规高度下独立任务/备忘列表。

**验证：** `node --experimental-vm-modules --test test/frontend-admin-layout.test.js test/frontend-select-menu-overflow.test.js test/license-ui.test.js test/license-password-ui.test.js test/frontend-toast.test.js test/frontend-usage-guide.test.js`；Electron 隔离页的页面与浮层矩阵、键盘首末项和背景滚动位置断言。

## 阶段二：自动歌词与手动浏览

**涉及：** `public/css/lyrics/desktop-lyric.css`、`public/css/overlays/desktop-scrollbars.css`、`public/js/lyrics/desktop-lyric-renderer.js`、`public/css/playback/fullscreen.css`、`public/css/playback/responsive.css`、`public/js/playback/ui/fullscreen.js`、对应歌词 HTML。

- [x] 管理预览、独立窗口和 `/lyrics` 自动跟随时不显示操作性滑块；保留完整歌词与既有逐字/自动跟随效果。
- [x] 复用既有暂停自动跟随状态，手动浏览时提供当前区域滚动提示；状态恢复后隐藏。存在手动定位的全屏歌词提供“返回当前歌词”入口，保证鼠标与键盘均可操作。
- [x] 窄屏全屏歌词仅保留一个主要纵向滚动层，封面/曲名布局适应可用空间，不让封面把歌词或关闭入口挤出窗口。
- [x] 覆盖空歌词、长歌词、更新当前行、手动浏览、恢复跟随、切歌和缩放。

**验证：** `node --experimental-vm-modules --test test/desktop-lyric-renderer.test.js test/desktop-lyric-settings-runtime.test.js test/desktop-lyric-style-ownership.test.js test/frontend-playback.test.js`，补充所属跟随状态回归测试；同版 Electron 中滚轮/键盘/返回按钮及视觉检查。

## 阶段三：OBS 和游戏展示

**涉及：** `public/js/overlays/blindbox.js`、`public/css/overlays/blindbox.css`、`public/pages/overlays/blindbox.html`、`public/js/overlays/games/`、`public/css/overlays/games/`，以及报告中的其他 OBS 页面。

- [x] 盲盒默认不显示滚动条，保留 `noScroll/ns` 显隐参数兼容；超过视口的已选展示内容采用自动展示策略，使尾部不会永久藏在可视范围外。保留已有 top/winners/compact/title 取舍及实际盈亏数据。
- [x] 游戏结果与窄宽度画猜视图按实际展示/直接操作用途处理。积分、正确答案和弹幕更新保持可读，必要条目自动展示；可操作场景保留浏览能力。
- [x] 点歌队列、歌单、弹幕、加班机、礼物特效、开播、时钟、转盘逐一检查无操作轨道；保留自动跟随/轮播/现有更新机制。
- [x] 验证视口变小、长内容、实时更新、空态、低功耗/减少动效设置和生命周期清理。

**验证：** `node --experimental-vm-modules --test test/frontend-blindbox-overlay.test.js test/games-overlay.test.js test/queue-overlay-esm.test.js test/frontend-queue-scrolling.test.js test/overtime-overlay.test.js test/gift-effects-overlay.test.js test/danmaku-overlay.test.js`；实际 Overlay 模块载入隔离浏览器源场景，注入合成快照，检查动态展示与完整内容到达。

## 阶段四：逐项整体验收

下表是整个报告的覆盖索引。阶段验收记录不替代最终运行证据。

| ID | 报告要求 | 验收证据 | 当前状态 |
| --- | --- | --- | --- |
| A1 | 4.1 壳、标题栏、播放器、主区、双队列、七标签 | 三尺寸/播放器三态、空→1→2→20→空高度和入口位置、根层无溢出 | 已验收，见报告 §12 |
| A2 | 4.1 表格、价格预览、编辑器、七项导航 | 长表格横滚局限本区；短预览自然布局；输入可滚动、选择、编辑 | 已验收，见报告 §12 |
| A3 | 4.2 播放主区、发现/搜索、队列浮层、抽屉、选择框 | 长列表、首末项、固定操作区、背景不跟随、关闭后恢复 | 已验收，见报告 §12 |
| A4 | 4.2/4.6 全屏歌词、设置表单、预览、独立歌词 | 自动/手动/恢复、窄屏唯一滚动层、无歌词无滑块 | 已验收，见报告 §12 |
| A5 | 4.3 礼物主页/盲盒统计、历史、分析表、观众菜单 | 主区滚动、必要表格横滚、表头可见、长用户名不撑破 | 已验收，见报告 §12 |
| A6 | 4.4 百宝箱导航和十三面板 | 三尺寸、侧栏两态、正文首尾可达、无意外横条 | 已验收，见报告 §12 |
| A7 | 4.4 编辑列表、AI 菜单、工作台/日程、礼物网格、帮助目录 | 长数据滚动提示与键盘访问、短窗口阅读层级、打开菜单不裁剪 | 已验收，见报告 §12 |
| A8 | 4.5 通用菜单/分类、确认/引导、帮助、Toast、多行输入 | 短内容无条、长内容可达、弹层首尾和操作按钮、背景隔离 | 已验收，见报告 §12 |
| A9 | 4.7 登录/授权、外部登录、礼物审计 | 内部长表单可达、第三方样式未修改、诊断数据 B/D | 已验收，见报告 §12 |
| A10 | 4.7 所有 OBS/游戏展示 | 轨道隐藏、尾部内容有可达展示机制、已有交互保留 | 已验收，见报告 §12 |
| A11 | 第六节统一几何/颜色/命中/焦点/深浅主题 | 实际像素 12/6/8、悬浮/拖动/键盘、原生命中、正文位置不变 | 已验收，见报告 §12 |
| A12 | 第七节全部风险：双轴、最小尺寸、弹层裁剪、继承、滚动链、共享展示 | 对应 A1–A11 的长内容和交互断言；浮层/队列边缘分别验证 | 已验收，见报告 §12 |
| A13 | 第九节缩放、键盘、系统显示边界 | 有效 CSS 宽高、125%/150% 缩放、强制颜色回退、记录系统偏好实际读数和表现 | 已验收，见报告 §12 |
| A14 | 第十节六项既有正确行为 | 现有保护测试及菜单、确认背景隔离运行检查 | 已验收，见报告 §12 |

- [x] 将每项的具体文件、场景、数值/截图/测试证据写回报告；保留历史审查快照，最终结果独立成节。
- [x] 执行所有直接受影响测试，以及 `npm run check`、`npm run verify:docs`、`npm run verify:architecture`。整个任务跨共享 UI 和 Overlay，最终再执行 `npm test`，对失败逐项归因。
- [x] 运行 Impeccable 检测与分阶段有限次数的视觉检查，只修本任务缺陷。
- [x] 最后检查任务 diff、`git diff --check`、`git status --short`，确认没有真实数据、秘密或临时验证产物进入工作树。

## 失败处理与完成条件

单个验证超时先确认原句柄/进程状态，再恢复同一会话；不据超时自动重复启动。修改失败时只回退本任务拥有的具体差异，保留用户和首轮变更，不进行破坏性重置。

完成条件：A1–A14 每一项均有直接证据，全部必要修复和文档完成，适当测试通过且差异审查完成。真实外部环境无法取得时如实记录缺失证据并继续其他阶段，不能把“未验证”标为完成。

## 执行记录

- 2026-09-15：重新读取工作树、报告、规划政策和所属路线；当前仍是首轮修复状态。已建立完整覆盖清单，开始阶段一。


- 2026-09-15 完成记录：四阶段代码任务已实施；阶段一补齐登录/缩放/滚动链/长菜单/短工作台，并修复根溢出与短分析表格零高度；阶段二完成歌词模式和窄窗口；阶段三完成盲盒与游戏离散分页。报告第十二节提供 A1–A14 证据、1900 项通过/4 项跳过的完整测试结果及外部环境验证边界。
- 验收环境限定为隔离 Electron 和合成数据；实际 OBS、第三方登录、系统偏好切换没有冒充端到端通过。固定皮肤的系统自动隐藏取舍按原报告处理。
