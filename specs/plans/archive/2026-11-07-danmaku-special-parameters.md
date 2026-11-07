# 新增弹幕样式专属参数

Status: Completed

## Goal

为渐变气泡、玻璃气泡、天穹横栏、玻璃通知、暗月、线框星事、郁香海风（固定与随机）增加与各款造型对应的独立参数。默认保留已有外观；桌面、画布与独立预览共用控件，沿用当前账号本机逐样式保存与恢复。

## Architecture And Ownership

- `public/js/shared/danmaku-style-options.js` 拥有字段、范围、默认值与校验；使用现有同步脚本生成 `src/shared/danmaku-style-options.js`。
- `public/js/shared/danmaku-parameter-controls.js` 拥有统一控件；在既有高级参数中分组。
- `public/js/overlays/danmaku-style-application.js` 将参数交给对应样式的 CSS 变量及 body dataset；各款 CSS/renderer 拥有造型与动效。
- 本机外观草稿、保存、场景输出沿用现有路径，不增加服务器样式镜像、订阅或存储层。
- 技术参考为 `docs/reference/frontend/overlays.md`、动效约定为 `docs/reference/frontend/danmaku-motion.md`；使用说明为 `docs/guides/component-style-parameters.md` 及应用内弹幕指南。

## Global Constraints And Compatibility

保持现有 HTTP/WS/IPC、字体资源、身份及实际金额语义、账号隔离和同款共享范围；保留所有任务前工作区修改。字体、字号、布局、公共光影及持续动画开关继续使用原控件。样式切换不丢失其他样式参数，恢复只作用于当前款。视觉调整直接更新现有消息，不清空重播；入场节奏只影响新消息。系统减少动态效果优先，长文显字须在退场前完成。不提交、分支、部署或重启用户应用。

## Parameter Contract

| 分组 | 字段与默认值 | 范围 / 选项 |
| --- | --- | --- |
| 渐变与昵称牌 | `gradientPalette=original`、`gradientCycleSeconds=10`、`gradientUnderline=show` | original/sunset/ocean/lavender；6–24 秒；show/hide |
| 玻璃与显字 | `glassBubbleReveal=typing`、`glassBubbleTypingSpeed=26`、`glassBubbleSweep=on`、`glassBubbleHighlight=100` | typing/instant；10–60 ms/字（长文自动加速）；on/off；0–100% |
| 星云与星标 | `celestialNebulaOpacity=30`、`celestialStarDensity=normal`、`celestialStarShape=identity`、`celestialSeparator=show` | 0–100%；off/sparse/normal/dense；identity/sparkle/star；show/hide |
| 玻璃通知 | `glassTime=show`、`glassGlintIntensity=100`、`glassDensity=comfortable` | show/hide；0–100%；comfortable/compact |
| 月环与星芒 | `darkMoonPalette=original`、`darkMoonRingSize=100`、`darkMoonSparks=show` | original/moonlight/ice；70–140%；show/hide |
| 圈线与描框 | `wireframeFadeLength=100`、`wireframeOrbit=show`、`wireframeEntrance=traced`、`wireframeEntranceMs=700` | 0–100%；show/hide；traced/none；350–1400 ms |
| 海风倒影 | `seaBreezeReflectionOpacity=28`、`seaBreezeReflectionLength=130`、`seaBreezeReflectionGap=-9` | 0–60%；0–200% 正文字号；-20–30 px |

## Parallel Deliverables

- [x] A：渐变气泡与天穹横栏的 CSS/renderer；检查默认一致、配色与循环、星云星点及星标切换。
- [x] B：玻璃气泡与玻璃通知的 CSS/renderer；检查长文显字、即时全文、扫光、高光、时间与密度。
- [x] C：暗月、线框星事与两版海风的 CSS/renderer；检查身份不变、原生线框效果与倒影空间。
- [x] 主任务：统一字段、控件分组、应用入口、Node 镜像、相关测试及文档；完成合并审查。

各子任务只编辑各自主题文件；主任务独占共享文件与共有测试，避免并行覆盖。修改前将任务涉及文件保存到仓库 `tmp/danmaku-special-parameters/baseline/`，用于区分既有修改。

## Verification

- 扩展现有 `test/danmaku/danmaku-style-options.test.js` 中的参数隔离/保存行为，复用现有 helper；显字可读性在拥有该逻辑的 renderer 用例中检查，不为装饰颜色和曲线添加快照。
- 运行直接相关 Node/VM 测试：样式选项、外观、消息 renderer、编辑状态、本机预览与场景投影；确切命令与结果随实施记录。
- 复用现有隔离 Electron fixture 与 Playwright 持久会话，验证桌面修改/保存后本机场景输出；使用合成消息，不访问用户数据。检查八个样式的特色控件、恢复、切换、已有消息稳定、长文和减少动态效果。
- 修改 Markdown 后运行 `npm run verify:docs`；检查受影响 JS 语法、样式生成镜像和机械设计检查。
- 最后审查本次相对 baseline 的 diff、`git diff --check` 与 `git status --short`，不将其他任务的差异归入本次。

## Failure Handling

失败时保留草稿和已有外观；先定位所属主题或参数 owner，再运行相关检查。回退仅逆向撤销本任务相对 baseline 的改动，不使用 reset/checkout 或广泛清理。隔离 QA 只关闭本任务创建的实例和临时资源。

## Done When

所有表列参数真实影响对应画面、默认兼容、逐样式保存与恢复有效；桌面控件和本机场景集成通过；直接相关测试、文档检查与最终 diff 审查完成。真实上游或直播软件实播未执行时明确说明，不以合成事件替代其证据。

## Execution Evidence

- 三个并行实现任务完成；二次只读集成审查发现并修复渐变身份彩边覆盖和暗月正文颜色覆盖，删除未使用的根变量写入。
- 复用预览测试时发现既有 VM 夹具缺少舞台查询，补齐对应节点后 12 项预览行为通过；生产页面不增加无意义的空节点防御。
- 八个定向测试文件合计 150 项通过：样式选项、本机外观、消息 renderer、独立预览、feed/SC、面板编辑、字号适配和动效。玻璃长文用例已改为最长 60ms 显字间隔，仍在最早退场前完整可读。日志：仓库 `tmp/danmaku-special-parameters/focused-tests.log`。
- 共享外观/场景合同/样式选项 29 项通过；Node 选项生成镜像检查通过。
- 通过现有隔离 Electron fixture 在真实桌面控件调整八个 style ID 的全部 24 个字段（海风两款合计 27 次调整），本机保存读回一致；画布添加八个组件、发布后输出配置携带各款参数。真实 scene 页面八个子画面分别收到参数，合成聊天、礼物和完整 SC 及金额已显示，页面错误为零。未连接用户实例或真实 B 站事件。
- 各主题的隔离 Chromium 核对通过：星点 0/12/30/60、主题循环与显隐、旧消息不重播、倒影最大空间与关闭收回、头像与身份保留。最终原生 Electron 参数区视觉检查通过；完整关闭并重新启动隔离宿主后，八款所有保存值仍存在，恢复随机海风后其覆盖为空，固定海风及渐变参数保留。
- 长时间 QA 中合成授权会话过期，预览等待造成 REPL 重置；确认旧宿主进程后正常关闭，并复用原隔离数据库启动新授权宿主，完成重启/恢复检查。没有修改产品授权或连接用户应用。两份本任务宿主均已关闭，临时基线、日志与合成数据库保留于仓库 tmp 供差异核对。
- 第一次文档门禁 9/10 通过，唯一报告为并行的 `2026-11-07-advanced-lyrics.md` 与索引状态不一致；未修改该任务的文档。后续该任务状态一致、本计划使用标准 Status 标签后，文档门禁 10/10 通过。
- 暗月最终颜色修正后，两项直接相关颜色/正文浏览器检查通过；12 个受影响 JS 文件语法通过，机械设计检查结果为空（无发现）。实现与四份说明相对任务前基线已审查，未改架构、远端接口、字体资源或用户其他领域代码。
- 本次不包含真实 B 站上游及 OBS／哔哩哔哩直播姬实播验收，不打包、部署或提交。
