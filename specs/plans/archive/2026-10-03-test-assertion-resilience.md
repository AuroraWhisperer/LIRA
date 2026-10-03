# Test Assertion Resilience Implementation Plan

> 执行方式：先完成分类计划和独立代理审核，消除阻塞意见后，再由三个职责互不重叠的代理并行修改；主代理集成、复核并验证。遵循根 PLANS.md，不自动提交。

**Status:** Completed — 分类清理、独立计划审核及终审、聚焦/全量验证和设计/故障探针均已完成。

**Goal:** 清理因普通视觉参数、属性顺序和内部写法变化而误报的测试，同时保留能发现行为、安全、数据和兼容性回归的覆盖；给每类修改、删除、合并、保留提供可核对的理由。

**Architecture:** 保持现有 Node test、VM、Playwright 和 Electron 测试结构。优先复用已有行为用例，静态测试继续保护模块边界和明确的资源/样式所有权；不把被删除的每条样式断言逐一替换成浏览器测试。

**Tech Stack:** Node.js 24、node:test、node:assert/strict、现有 VM fixture、Playwright、Electron。

## Global Constraints

- 生产代码、页面、CSS、持久化格式、HTTP/WebSocket/IPC 与安全边界保持本次任务开始时的行为。
- 保留工作区已有改动；本次开始时的 test 快照保存在 `tmp/assertion-audit/baseline/test/`，仅用于识别本次差异。
- 不增加依赖、框架、前端构建、截图平台或通用解析框架，不提交、建分支或发布。
- 所有临时报告、反例验证脚本、日志和测试产物放在根 `tmp/assertion-audit/`。
- 正常页面的特权集成以 Electron 为准；已有浏览器组件测试只能证明其覆盖的 DOM/交互行为。
- 测试数量下降本身不代表完成；必须验证被保留的检查仍能发现实际故障。

## 当前证据与范围

- 当前收集到 494 个 `*.test.js`。源码/正则/文件读取关键词出现在 267 个文件；这个搜索结果只用于定位，不能直接作为删除清单。
- 上一轮全量验证通过 3458 项，但发现 6 项旧界面断言会随设计调整误报；另 12 项失败来自固定服务器契约检出缺失，已用独立的 `D:/Work/lira-server-contract` 解决，应继续保留契约校验。
- 只读盘点覆盖整个 test 目录，分为桌面外壳及通用界面、功能及浏览器源、其余平台/服务领域三组。
- 不把所有源码匹配都视为低价值。权限入口、资产可用性、CSS 所有权、overlay 透明输出、配置值传递、禁止不安全 API 等有独立保护目标。
- 字体规范的 owner 是 `docs/reference/frontend/pages.md` §1.1；保留 token 完整性、语义作用域、可读性下限和 overlay 隔离，避免在多个页面测试里重复冻结完整样式值。

## 分类规则与验收

| 动作 | 条件 | 实施要求 |
| --- | --- | --- |
| 删除 | 只冻结普通装饰数值、颜色、圆角、阴影、动画时长、无契约意义的 class 或源码布局 | 删除该断言及其独占读取/import；混合用例中的行为检查继续保留。纯装饰用例可整项删除。 |
| 修改 | 测试意图有效，但依赖完整 HTML 字符串、属性顺序、函数内部写法或完整 CSS 表达式 | 检查实际输出/交互、相关属性或稳定的相对约束；优先现有 fixture，不引入新解析系统。 |
| 合并 | 同一规则在公共组件、页面源码和浏览器用例重复出现 | 将规范检查留在唯一的拥有者；已有行为用例承接其行为保护，并在完成记录中注明覆盖位置。 |
| 保留 | 数据正确性、安全、权限、API/IPC/持久化兼容、并发/重试/排序、资源释放、可访问性、明确输出尺寸/设置应用契约 | 不修改预期来掩盖失败；动态执行可替代脆弱源码检查时，必须先核对等价场景。 |

纯装饰删除没有“等价像素检查”的替代义务。涉及真实功能的删除必须给出现有或新增的行为覆盖位置。

## 所有权与并行分工

| 工作包 | 独占测试目录 | 主要拥有者/保留覆盖 |
| --- | --- | --- |
| A：桌面外壳及通用界面 | admin、ui、settings、songs、playback、lyrics | Admin composition、toolbox runtime、queue、toast、client appearance、playback、desktop lyric；保留请求防重、失败恢复、焦点、可读性、显示配置和持久化用例。 |
| B：功能及浏览器源 | gifts、overlays、danmaku、games、overtime、scenes | opening/clock runtime、gift player/resource lifecycle、danmaku renderer、游戏和场景配置回环；保留透明输出、协议尺寸、资产、关闭清理及安全。 |
| C：平台与服务边界 | 其余 test 业务目录 | AI、license、fan profiles 等界面用例可清理；工程、安全、存储、传输、生命周期和服务器契约原则上保留。 |
| 主代理 | 本计划、计划索引、docs/reference/engineering/test.md、docs/reference/frontend/pages.md 的字体说明、test/engineering/governance-docs.test.js；必要的公共引用 | 记录政策、澄清可调设计值与强制可读性边界、消除状态标记的 Markdown 装饰耦合、审核覆盖去向、统一更新删除文件的脚本/文档引用，完成最终验证。 |

各代理只修改其测试目录；共享 helper 或测试执行器变更先交给主代理处理。当前存在其他任务修改生产功能；若其变更导致新失败，先辨别来源，不恢复或覆盖其改动。

## Milestone 1：完成计划及分类清单

- [x] 阅读三个只读盘点报告，将确定的逐文件决策纳入本计划的工作包。
- [x] 自审：全部范围有去向，纯装饰删除与功能保护有区分，没有削弱安全/契约/数据检查。
- [x] 独立代理审核：检查遗漏、误删风险、重复替代、并行冲突及验证是否能证明“更不脆弱”；记录结论和修订。

审核通过前不修改测试。主代理修订后，阻塞意见需要复核；没有阻塞意见即可按用户授权继续，不增加人工批准步骤。

## Milestone 2：按审核后的分类并行实施

### A：桌面外壳及通用界面

只读盘点确认的清单（均位于 test 下，文件名省略 `.test.js`）：

| 目录 | 文件 | 决策与保留范围 |
| --- | --- | --- |
| admin | frontend-admin-shell、frontend-admin-layout | 删装饰高度/配色与重复资产检查，保留控制归属、独立滚动、dock reserve、真实 wheel/展开交互；普通属性顺序不作为条件。 |
| admin | toolbox-sidebar、toolbox-sidebar-routing | 删宽度/字号/颜色快照，导航与持久化交互由 routing/preferences 统一保护。 |
| admin | streamer-planner、contextual-help、interactive-tour、frontend-usage-guide | 删间距、具体文案/字形和无契约版本快照；保留日历结构、目标有效、帮助定位、进度持久化、可访问性和惰性图片。 |
| admin | client-appearance、admin-page-composition | 调整属性/包装层依赖；保留主题选择语义、唯一 ID、完整页面组合、目录链接对应和路径安全。 |
| ui | frontend-typography、ui-surface | 合并重复字体检查到中央 token/语义边界；确认框/选择器的有效可访问性检查需实际执行覆盖或保留原检查，不能删后无替代。 |
| ui | frontend-toast、frontend-select-menu-overflow | 删装饰数值/渐变快照，保留布局可用、对比度、焦点、唯一节点、资源/请求；层级用相对关系，不冻结内部 z-index。 |
| settings | frontend-welcome | 控制存在/唯一、初始禁用、保存和账号隔离保留；删 class、无关总数和普通布局顺序。 |
| playback | frontend-playback | 删展示字号快照，保留播放、浏览、歌词、请求竞态和关闭行为。 |
| songs | frontend-queue-random、frontend-queue | 删按钮类名/配色快照；保留请求防重、失败恢复、设置键与不同样式的独立持久化。 |
| songs | frontend-song-board、frontend-queue-themes、queue-overlay-responsive、frontend-queue-scrolling | 删装饰 inset/配色/固定样式表达式；保留真实 contain 缩放、用户配置、滚动速度、边界、资源与转义。 |
| lyrics | desktop-lyric-settings、desktop-lyric-settings-runtime | 删预览卡片几何/缩放和帮助布局；保留百分比转换、设置/持久化、字体授权、请求竞态和安全输出。 |

另外检查过的 frontend-admin-runtime、toolbox-sidebar-preferences、desktop-lyric-publication、frontend-admin-toolbox 中的组成根接线，没有确认等价行为覆盖的部分继续保留；不能仅用函数单元测试替代真正的接线保护。

- [x] 去掉队列高度、按钮配色、通知字号等精确设计值及重复组件映射，保留交互和布局功能约束。
- [x] 随机点歌示例：将 `queue random button uses secondary styling before the primary next button` 改为真实组合 HTML 的按钮存在性与非 submit 语义检查，删除 class/位置/文案绑定。现有行为 fixture 手工创建按钮，不能证明真实页面还有入口，因此必须保留这一小段组成检查：

```js
const buttons = [...readAdminHtml().matchAll(/<button\b[^>]*>/g)].map(([tag]) => tag);
for (const id of ['randomSongBtn', 'nextBtn', 'clearBtn']) {
  const matches = buttons.filter((tag) => new RegExp(`\\sid\\s*=\\s*["']${id}["']`).test(tag));
  assert.equal(matches.length, 1, `${id} must be a unique button`);
  assert.match(matches[0], /\stype\s*=\s*["']button["']/);
}
```

同文件保留 `queue random click stays disabled while pending and recovers after success or failure`，其中继续验证：

```js
assert.equal(button.disabled, true);
await button.fire('click');
assert.equal(calls.length, 1);
assert.equal(calls[0].url, '/api/queue/random');
```

- [x] 公共字体检查保留所需 token、有效取值和层级关系；通知字号由样式 owner 调整，不再由多个测试复制 `calc(var(--type-size-card-title) + 2px)`。
- [x] 运行修改文件及直接承接覆盖的既有文件，记录执行清单和结果。

### B：功能及浏览器源

只读盘点确认 22 个文件（均位于 test 下，文件名省略 `.test.js`）：

| 目录 | 文件 | 决策与保留范围 |
| --- | --- | --- |
| gifts | frontend-gifts、frontend-recent-gifts | 删标题数量、卡片网格/颜色/布局快照；保留观众汇总、身份与盈亏、金额边界、图源刷新和有界显示。 |
| gifts | frontend-gift-assistant、frontend-gift-display-settings | 删标签/预览高度与装饰动作几何；保留安全预览 URL、设置验证、主题轮播/减少动画、单实例与关闭清理。 |
| gifts | frontend-gift-banner、frontend-guard-thanks | 装饰精确尺寸改为相对适配/不溢出；保留 PNG 输出/倍率、长文本、等级与头像、安全及生命周期。 |
| gifts | frontend-blindbox-overlay、frontend-blindbox-admin | 删响应断点/网格/普通文案和 class；保留统计字段、正负盈亏、过滤、无陈旧响应、独立分析区域与来源地址。 |
| gifts | frontend-gift-history | 删外观/属性排列，重复源码并入已有排序/分页/取消/删除恢复行为；保留六列、身份不泄露、不可逆告知及确认。 |
| gifts | gift-effects-overlay、gift-frame-admin、guard-thanks | 删画框装饰坐标/颜色/旧层名称与文档关键词快照；保留资源、透明输出、帧媒体 alpha/CORS/no-referrer、设置、受限队列/粒子和 reduced-motion。 |
| overlays | opening-overlay、clock-overlay | 删装饰动画/间距/类名、重复运行时源码检查；保留 CSP、媒体默认禁用、设置/枚举、同源消息、完整画布缩放与有限计时器。 |
| danmaku | danmaku-overlay、danmaku-style-ownership、frontend-admin-danmaku | 删布局/配色/间距/精确断点，事件重复源码并入 snapshot/renderer/buffer 运行用例；保留身份、透明输出、风格所有权、输入限制和隐私。 |
| games | frontend-games、games-overlay、wheel-overlay | 删卡片布局、图标/普通文案和装饰曲线；保留答案保密、画具语义、状态/增量/重连、共享来源与独立 wheel、安全文本和减少动画。 |
| overtime | frontend-overtime、overtime-overlay | 删装饰字号/断点/布局/文案；保留规则计算、保存状态、服务端限制、时钟边界/新版本动画、可见性与资源控制。 |

`test/scenes/**` 的画布坐标、iframe/节点生命周期、token redaction、源隔离和发布原子性均保留。本组其他 ledger、identity、quantity、settlement、transport、transaction/auth 测试也保留。

- [x] 在混合用例中移除装饰间距、描边、色值、素材几何和动画曲线快照；保留路由、资产存在、安全文本、设置键和用户配置准确应用。
- [x] 合并已由 `frontend-opening-runtime.test.js`、`frontend-clock-runtime.test.js`、`gift-effect-player.test.js`、`gift-effect-resource-lifecycle.test.js` 保护的重复内部源码断言；不得删除这些实际执行的行为用例。
- [x] official gift player 的资源测试不能冒充自定义 woodland frame 的覆盖；实施时 woodland 已改为透明视频，保留其独立 controller/queue/media 检查，不恢复旧粒子/图层。
- [x] 明确区分“字号是用户设置的输入，输出应准确等于该值”与“当前设计字号恰好为某个值”：前者继续断言精确值。
- [x] 运行修改文件及承接覆盖的既有文件，记录执行清单和结果。

### C：平台与服务边界

已确认修改 `test/ai/frontend-admin-ai.test.js`、`test/license/license-ui.test.js`、`test/license/license-password-ui.test.js`、`test/fan-profiles/frontend-fan-profiles-view.test.js`、`test/desktop/electron-main-modules.test.js`；`test/cloud-sync/cloud-song-sync-ui.test.js` 承接无效云端歌曲数量的缺失行为用例。

- [x] 删除纯外观清单，降低无意义的属性/文案排列依赖；保留 AI 数值限制、XSS、秘密清理、授权/初始化以及错误恢复。
- [x] 内部实现拼写检查只有在已有行为场景覆盖同一风险时才合并；否则保留或改成真实执行用例。
- [x] 保留 `server-contract.test.js` 及其 fixture 消费者、架构、打包、安全和数据验证。
- [x] license 的四条重复云同步源码检查合并到 `cloud-song-sync-ui.test.js` 的确认/取消/最新快照/错误歌曲/成功记录用例；先补无效 count 场景。失败后恢复操作和授权错误提示改为现有 license fixture 的实际事件测试。
- [x] Electron shutdown 的源码数组/调用顺序断言合并到 `electron-shutdown.test.js`，后者实际控制 Promise 并验证 drain 完成后才能 stop/relaunch；保留组成边界。
- [x] `wesing-online-lyrics.test.js` 的动态偏好接线、Bilibili safeStorage/登录接线、背景上传初始禁用等缺少等价运行覆盖的源码检查继续保留，并记录原因。
- [x] 运行修改文件及承接覆盖的既有文件，记录执行清单和结果。

### 测试策略文档

- [x] 在 `docs/reference/engineering/test.md` §6 写明四类决策、静态测试边界和设计变化的验证方式；修正本节过期的测试平铺说明，使其与现有按领域组织一致。
- [x] 在 `docs/reference/frontend/pages.md` §1.1 说明当前字号表是可调默认设计值，强制约束是可读性下限、语义作用域和用户配置隔离；避免把页面当前值复制成多个测试的不可变协议。
- [x] 若删除整个文件，同步清理 package scripts、执行分组及当前文档中该文件的有效引用；本轮未删除整个文件，执行器与文件引用无需修改。

### 基线暴露的状态格式误报

- [x] `test/engineering/governance-docs.test.js` 的 active plan 校验允许 `Status: In Progress` 和 `**Status:** In Progress` 两种等义标记；保留非终态白名单、索引必须存在且状态一致、完成计划必须归档等全部约束。只调整格式读取，不能放宽允许的状态。
- [x] 使用普通/粗体与未知/缺失状态示例验证解析及拒绝语义，不通过修改其他任务的计划消除本次重现。

## Milestone 3：集成审查与验证

- [x] 对照本轮快照逐项检查删除内容；确认混合用例保留了有意义的检查，没有留下只运行 setup 的空测试，也未引入 skip 或吞错。
- [x] 用子进程内的临时 source-read 替换做设计变化探针，不改真实生产文件：队列高度 64→68、通知字号增量 2→3、标签栏属性顺序变化。相关测试应继续通过。
- [x] 做行为故障反例：同样在独立子进程里去掉 `queue.js` 的 `randomButton.disabled = true;`，保留的随机点歌行为测试必须失败。验证这次治理没有让测试一律放行。
- [x] 执行以下最终命令，依据真实输出记录结果：

```powershell
npm.cmd run verify:contracts
npm.cmd run check
npm.cmd run verify:docs
npm.cmd test -- --test-reporter=tap
git diff --check
git status --short
```

使用已有 Node/浏览器/Electron/安装器隔离测试；不操作用户正在运行的应用。全量测试至少执行一次以发现跨目录消费者与测试收集问题；成功后除新增编辑或具体失败外不重复全量。

## 失败处理

先区分真实行为回归、仍残留的脆弱断言、环境缺失及并发任务的改动。只修复本任务范围内的测试问题；保留原始失败日志和预期失败的反例日志。需要退回时，逐文件对照本轮快照撤销本任务片段，不做 blanket checkout/reset，不覆盖新增用户改动。

## Done When

- [x] 全目录盘点有记录，确定的修改/删除/合并/保留清单已实施或有具体的保留理由，没有用“全部正则都删除”替代判断。
- [x] 独立计划审核通过；并行修改的边界清晰；最终对照审核没有误删重要覆盖。
- [x] 普通设计变化不再被本次清理的断言锁死；行为故障反例仍被捕获。
- [x] 修改仅涉及测试、必要的测试引用和文档；无生产行为改动，无新增依赖，原有用户内容被保留。
- [x] 聚焦测试和最终门禁通过，失败/跳过如有则明确记录；最终 diff/status 已核对。
- [x] 本计划写入实际决策与验证结果后归档，并更新计划索引。

## 审核与完成记录

2026-10-03：完成三个只读盘点。A 覆盖 admin/ui/settings/songs/playback/lyrics；B 覆盖 gifts/overlays/danmaku/games/overtime/scenes；C 扫描其余 212 个测试文件。候选源于全目录定向搜索，再逐项读取确认；没有宣称对所有业务测试逐行审计。

自审修订：将 C 组 WeSing 动态偏好接线从“改写候选”改为明确保留；将原本可能误合并的 woodland 粒子与 official player 资源覆盖分开；明确 UI 取消/焦点/键盘不能因已有后端测试而删除；补齐中央字体规范说明与真正行为故障反例。

独立审核修订：随机点歌运行 fixture 手工创建按钮，不能替代真实 HTML 的入口检查。改为保留唯一 button/type 语义，去掉外观 class/排列/文案依赖；其它类似手工 DOM fixture 承接源码检查时也必须核对真实页面接线没有丢失。

独立审核结论：修订后可执行，无未解决阻塞。额外采纳属性匹配必须区分真实 id/type 与 data-id/data-type 的建议。审核确认普通/粗体 Status 兼容不会放宽治理；再次确认 B 组按最新 woodland 视频/字幕/队列重新分类，不能照旧报告恢复粒子约束。

当前基线全量运行：原生批 3/3；主批 3461 通过、1 失败、0 跳过。唯一失败来自并发任务的新计划使用普通 `Status:` 而测试只接受粗体标记；没有产品行为用例失败。日志位于 `tmp/assertion-audit/baseline.log`。这是本轮新增的明确格式耦合案例，已提交独立审核。另一个任务已将旧 woodland 粒子改为视频/字幕和独立队列；B 实施前必须读取新用例和其运行覆盖，旧盘点中不存在的粒子/图层不得恢复。

实施分工调整：A 将尚未编辑的 `frontend-song-board`、`frontend-queue-themes`、`queue-overlay-responsive`、`frontend-queue-scrolling` 四文件明确移交主代理；即时快照位于 `tmp/assertion-audit/shell-before-edit/test/songs/`。保留 artwork 比例、contain 缩放、输入导出的滚动距离/速度与安全文本；guard/medal 色值改为同级一致关系，层级改为相对关系；补实际字号边界应用和 resize 不重建真实节点的执行验证。四文件 32/32 通过，见 `root-songs-focused.log`。

抗变化验证：临时 `source-variation.cjs` 仅在独立测试子进程读取指定文件时替换内容，没有写生产源码。队列高度 64→68、通知标题增量 2→3、通知 padding 14/20→16/22、标签栏属性顺序/引号变化均命中，shell/layout/typography/toast/random 38/38 通过，包含现有 toast 浏览器用例。两个故障探针各出现 1 个预期失败：缺失真实入口在唯一按钮检查失败；取消 pending 禁用在随机点歌行为检查失败。详见 `probe-design.log`、`probe-missing-entry.log`、`probe-duplicate-requests.log`，均位于 `tmp/assertion-audit/`。

A 实际完成 20 文件，另四个歌曲文件由主代理承接。删除 18 项完整装饰/重复用例，混合用例保留有效边界；唯一入口、confirmation/select 的键盘/焦点、overlay 隔离、token 层级与可读性保持，原生 select 与队列选项的焦点/选中保护在自审中确认保留。27 个修改及承接文件最终 198/198 通过，详见 `tmp/assertion-audit/shell-result.md` 和 `shell-tests.log`。

C 实际完成 7 文件，授权失败拒绝后恢复两个动作、错误类别提示、云同步非法数量回退改为实际事件执行；其中包含未定义/负数/小数/不安全整数/Infinity/非数字及有效零/非零返回值。云同步确认/取消/后确认快照及 Electron drain 顺序由已有运行测试承接；Bilibili/WeSing/背景上传初始化与危险批量删除 guard 无等价运行场景，明确保留。13 个相关文件 140/140 通过，详见 `tmp/assertion-audit/boundaries-result.md` 和 `boundaries-tests.log`。

B 实际完成 22 文件，删除 5 项完整装饰/关键词用例，其余只清理混合用例内的脆弱部分。opening/clock 的重复实现检查由现有 runtime 承接；近期礼物的名称转义、数量、金额、时间和 guard 身份改为实际模块渲染；视频框/字幕/队列按并发任务当前实现保留。40 个相关文件 227/227 通过，后续变更子集分别 50/50、8/8、5/5 通过，不把重复子集相加。详见 `tmp/assertion-audit/features-result.md` 及其中的日志清单。

独立终审发现并修复：恢复 ranked/outline 的用户字号 CSS 消费、transparent 普通条目透明背景、outline 的绝对定位；这是 FakeNode 不能替代的功能边界。礼物昵称另一处固定 24px 改为初始 computed 字号基线；song-board 验证读取实际 CSS 基础字号乘运行时 scale，避免 CSS/JS 基准失配被放过。原生 select/队列选项的焦点保护也已核对。复核后没有新增阻塞，报告位于 `tmp/assertion-audit/final-review.md`。修改内容与各自即时快照的汇总位于 `task-owned.diff`、`task-changes.json`：54 个测试文件及 2 个参考文档，未新增/删除测试文件。

## 最终验收记录

2026-10-03，独立计划审核、分组执行、自审与独立终审均完成。原工作区及并发任务的生产代码、视频素材和新增测试保持其当前内容；本任务没有提交、建分支、修改依赖或放宽服务器契约输入。

| 验证 | 实际结果 | 日志（相对根 tmp/assertion-audit/） |
| --- | --- | --- |
| `npm.cmd run verify:contracts` | 固定服务器提交 `01fb2b47d5e081f5dd559933991ade4819eb3428`，10 个 fixture 全部校验通过 | `final-contracts.log` |
| `npm.cmd run check` | 最后测试修改后的 1201 个 JavaScript 文件语法通过 | `final-check.log` |
| `npm.cmd run verify:docs` | 10/10 通过，0 失败、0 跳过 | `final-docs.log` |
| `npm.cmd test -- --test-reporter=tap` | 原生批 3/3，主批 3438/3438；合计 3441 通过，0 失败、0 跳过、0 取消 | `final-test.log` |
| 设计变化与故障探针 | 设计变化 38/38 通过；两个故障各准确触发目标断言失败 | `probe-*.log` |
| `git diff --check` / `git status --short` | 无空白错误；变更及已有用户内容已核对，暂存区未改动；临时材料位于被忽略的根 tmp/ | `final-diff-check.log` / `final-status.txt` |

最终全量只运行一次；后续只有本计划与索引归档，使用文档检查复核即可。记录的聚焦批次及全量存在重叠，不能累加为唯一用例数量。审核和反例验证说明本次清理的代表性设计变化不会误报、真实故障仍受保护，不代表对所有业务测试逐行重审或对所有视觉方案完成截图验收。
