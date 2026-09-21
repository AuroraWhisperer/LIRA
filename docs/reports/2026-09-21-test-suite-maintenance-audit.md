---
status: informative
review_date: 2026-09-21
scope: LIRA desktop and LIRA Server working trees
implementation_status: implemented-with-j01-commit-dependency
---

# 客户端与服务器测试整理审查及实施记录

目标是实际减少低价值测试代码、重复维护和执行成本，同时保留独立行为的保障。不能只把文件拆小，或把多个场景塞进一个 `test()` 来降低显示的数量。第 1–9 节保留原审查依据（行号指修改前）；第 10 节记录实际实施、核实后保留与阻塞。测试、辅助代码、执行入口和 CI 已修改；J01 客户端迁移仍依赖真实服务器提交。本文不替代现有规格、协议和测试策略。

## 1. 审查范围与结论

| 工作区 | HEAD 基线 | 测试文件 | 测试文件物理行数 |
| --- | --- | ---: | ---: |
| 客户端 `D:\Work\Live` | `bb3881bb61bf66fcc5a56cdccb22aa17a756830a` | 389 个 `*.test.js` | 89,921 |
| 服务器 `D:\Work\lira-server` | `80f0271fd457fca7616ec5508df58a9f37cabdfa` | 230 个 `*.test.js`、59 个浏览器 `*.spec.js` | 63,044 |

统计包含本次工作区内未忽略的新测试，以上两行排除辅助模块、依赖与生成文件；物理行数包含空行和注释，文件末尾换行不额外计一行。客户端存在未提交业务变更，HEAD 不能单独复现本次工作区。文件数不等于运行用例数，循环和子测试会展开；客户端的 `*.test.js` 中也有实际启动浏览器、Electron 的测试。

| JavaScript 维护体量 | 业务代码行数 | 测试及辅助代码行数 | 测试占两者合计 |
| --- | ---: | ---: | ---: |
| 客户端 | 105,144 | 94,972 | 47.5% |
| 服务器 | 47,922 | 65,284 | 57.7% |
| 合计 | 153,066 | 160,256 | 51.1% |

该表通过 `rg --files` 收集 `src/`、`public/` 的 `.js/.mjs/.cjs` 作为业务代码，`test/`、`e2e/` 同类文件作为测试及辅助代码；不含 `scripts/`、CSS、HTML、JSON、文档和资产。因此，“约一半”在这个 JS 口径下成立，不能表述成整个仓库的文件或字节占比。测试与业务接近 1:1 不能单独证明过度测试，但已经值得认真管理其维护成本。

原审查方法：扫描两仓测试路径、声明和重复断言特征，再逐项核对下列候选的被测文件、输入、断言、现有替代覆盖与执行入口。原审查未运行全量测试或采集耗时；实施阶段的实测与限制见第 10 节，不以单次耗时推断稳定提速。

**主要结论：**需要按整组整理，范围不止 C01–C12、S01–S11、J01–J03 的 26 个局部主题。第 6 节扩大到客户端 7 组、服务器 5 组，共 56 个不同文件、22,351 行现有测试代码。这是重点复核和重构范围，**不是已经确认可以删除 22,351 行**；其中既有冗余，也有必要行为测试。优先收敛 UI 源码镜像、重复初始化和跨层重复细节，授权、隔离、回滚与时序边界继续保留。

对于没有现行要求、没有独立回归价值的装饰常量或一次性改版断言，核实后可以直接删除，不必逐条补另一种测试。仍承担行为保护的检查，才需要先确认替代覆盖。参数化和共享辅助函数通常减少代码，不减少执行场景；分组运行主要减少日常执行成本，不会自动减少仓库代码。

## 2. 四批处理方向

| 批次 | 处理对象 | 判断标准 | 完成标准 |
| --- | --- | --- | --- |
| 第一批：重复检查 | 相同目标、输入和预期的断言；外壳测试侵入子功能细节 | 保留一处明确归属，其他位置保留装配或调用边界 | 独立行为不丢失；相关测试通过 |
| 第二批：实现耦合 | 函数名、源码语句、历史版本串、装饰性 CSS 常量 | 无独立约束的旧检查可退休；有行为责任的优先验证结果；安全和明确的架构约束仍保留 | 记录直接删除的理由；承担行为保护的先确认可运行的替代覆盖 |
| 第三批：参数化与结构 | 同一行为的输入变体；一个测试塞入大量独立场景 | 简单数据表、独立名称、每例独立状态；避免通用测试框架 | 同样的输入/边界仍被执行，失败能定位到场景 |
| 第四批：运行分层 | 收集范围、重复命令、浏览器启动、CI 分组 | 按被测边界和资源分层，不按文件名前缀猜测依赖 | 入口清晰，分组合集不漏测试，完整验证仍可运行 |

下文“优先”表示已确认、可以先实施；“替换后处理”表示需要先验证替代覆盖；“后续”表示收益有限或应先测量。它们不是缺陷严重级别。四批用于分类，实际实施次序按替代覆盖和样例依赖调整，见第 8 节。

## 3. 客户端

### 第一批：重复检查

| 编号 / 顺序 | 需要修改的测试 | 理由与方案 |
| --- | --- | --- |
| C01 · 优先 | [frontend-admin-shell.test.js:439](/D:/Work/Live/test/frontend-admin-shell.test.js:439)、[license-ui.test.js:282](/D:/Work/Live/test/license-ui.test.js:282) | 外壳和账号面板测试重复检查同一设置片段的账号/设备字段、重置密码提示和敏感文案。账号面板负责内部内容，外壳只检查该面板已组合、入口可达及初始隐藏状态。保留独立 `license.html` 的注册/登录检查；同名字段不代表同一页面。 |
| C02 · 优先 | [toolbox-sidebar-routing.test.js:115](/D:/Work/Live/test/toolbox-sidebar-routing.test.js:115)、[frontend-admin-danmaku.test.js:58](/D:/Work/Live/test/frontend-admin-danmaku.test.js:58) | 两者读取同一组合页面和 `other-features.css`，重复检查部分弹幕分组、布局及旧预览样式。删除重复断言，将侧栏独有的连接/发送分组、机器人双列和窄屏布局断言迁入弹幕测试；侧栏保留导航、可见性、选中状态和挂载验证。不整段删除或合并完整文件。 |

### 第二批：实现耦合

| 编号 / 顺序 | 需要修改的测试 | 理由与方案 |
| --- | --- | --- |
| C03 · 替换后处理 | [frontend-admin-danmaku.test.js:18](/D:/Work/Live/test/frontend-admin-danmaku.test.js:18)，以及该文件的状态、登录后刷新场景 | 例如匹配 `Array.from(...).length` 只能证明源码写法存在。改为输入中文/emoji 后检查计数，触发登录或打开面板后检查刷新次数和显示状态；使用现有前端加载/模拟模式。无固定长度上限和必要控件挂载契约可以保留。 |
| C04 · 优先收敛、替换后删除 | [frontend-admin-danmaku.test.js:251](/D:/Work/Live/test/frontend-admin-danmaku.test.js:251)、[frontend-admin-ai-autosave.test.js:8](/D:/Work/Live/test/frontend-admin-ai-autosave.test.js:8)、[frontend-admin-ai-secrets.test.js:8](/D:/Work/Live/test/frontend-admin-ai-secrets.test.js:8) | 弹幕测试还检查 AI 的防抖常量、监听写法和字段映射，而 AI 已有真实执行模块的保存、密钥处理测试。先完成或同步完成 C07，再把必要字段契约归到 AI 测试；确认运行覆盖后删除相应源码正则。弹幕侧保留 AI 区域位置/装配。 |
| C05 · 替换后处理 | [games-overlay.test.js:10](/D:/Work/Live/test/games-overlay.test.js:10)、[danmaku-overlay.test.js:13](/D:/Work/Live/test/danmaku-overlay.test.js:13) | 前者只有 3 个测试声明，却含 152 处 `assert.match/doesNotMatch` 调用；总条数掩盖了维护体量。逐段区分挂载、安全、渲染结果、局部变量写法，把依赖局部变量或语句的断言改成事件输入后的 DOM/状态结果。复用 [games-drawing.test.js](/D:/Work/Live/test/games-drawing.test.js:197)、[danmaku-overlay-renderer.test.js](/D:/Work/Live/test/danmaku-overlay-renderer.test.js:71) 的既有测试方式；保留原文件中真实执行的裁剪行为和安全约束。 |
| C06 · 替换后处理 | [frontend-queue-themes.test.js:24](/D:/Work/Live/test/frontend-queue-themes.test.js:24) | 存在 `88%`、`94%`、边框像素等写死的布局断言。纯装饰值不宜逐项锁死；优先保留完整行缩放、内容不被前景遮挡、滚动终点、字号设置生效等结果。结合 [frontend-queue-scrolling.test.js](/D:/Work/Live/test/frontend-queue-scrolling.test.js:353) 核对覆盖；明确来自已接受美术/布局规格的数值仍保留。无需把每个 CSS 断言都改成一条截图测试。 |

### 第三批：参数化与结构

| 编号 / 顺序 | 需要修改的测试 | 理由与方案 |
| --- | --- | --- |
| C07 · 优先 | [frontend-admin-ai-autosave.test.js:8](/D:/Work/Live/test/frontend-admin-ai-autosave.test.js:8) | 一个测试包含数百行设置、保存、密钥、模型请求和供应商切换操作；前面失败会阻断后面的独立验证。拆成防抖/即时保存、编辑保持、模型请求、供应商切换等独立场景，抽取本文件的初始化夹具，每例重建元素、计时器和请求记录。保留必要的连续操作链，不共享上一例状态。数量可能增加，但失败定位会更清楚。 |
| C08 · 后续 | [electron-url-policy.test.js:13](/D:/Work/Live/test/electron-url-policy.test.js:13) | 多组纯函数检查仅 URL 和布尔预期不同。按三个公开函数分别建具名数据表，保留协议、子域伪装、凭据 URL、大小写和 loopback 的全部样例；不能因预期同为 `false` 删除攻击变体。不把三种不同信任策略混成一个通用判断。 |
| C09 · 后续 | [license-manager-renewal.test.js:26](/D:/Work/Live/test/license-manager-renewal.test.js:26) | 多个 `getProfile()` 拒绝场景重复创建已授权 manager、注入错误、检查阻断和 token 清空。仅这些同路径场景可用错误工厂数据表，每例独立 harness、保留错误类型和状态组合。续期失败、并发共享续期、heartbeat 等不同调用链继续单独测试。 |

### 第四批：运行分层

| 编号 / 顺序 | 需要修改的入口/测试组织 | 理由与方案 |
| --- | --- | --- |
| C10 · 优先 | [package.json:13](/D:/Work/Live/package.json:13)、[test/helpers](/D:/Work/Live/test/helpers) | `node --test` 使用默认发现；本机 Node 24.15 的默认模式包含 `test/**/*.{js,mjs,cjs}`。已列出的 29 个非测试 JS 辅助文件也落在匹配范围。明确收集真正的 `*.test.js`，辅助模块由测试导入；对子进程探针保留显式启动。收集前后核对真实测试文件集合，不能只比较总通过数；不关闭进程隔离。 |
| C11 · 优先设计分组 | [package.json](/D:/Work/Live/package.json:13)、[ui-edit-state-fixture.js:39](/D:/Work/Live/test/helpers/ui-edit-state-fixture.js:39)、[desktop-request-auth-electron.test.js:10](/D:/Work/Live/test/desktop-request-auth-electron.test.js:10)、[CI](/D:/Work/Live/.github/workflows/check.yml:11) | 当前同一 Node 入口混有纯逻辑、临时数据库/HTTP、Chromium、Electron 和安装器场景。为离线行为、浏览器组件、桌面集成、契约建立明确执行组；普通变更运行所属组及直接消费者，完整入口仍覆盖全部。浏览器带模拟 bridge 的测试不能替代真实 Electron 权限验证；安装器跳过数要单列。PR 的 quick 当前以静态门禁为主，应补所选模块的行为组，不能把 quick 通过当作行为回归通过。 |
| C12 · 后续，先看耗时 | [package.json:20](/D:/Work/Live/package.json:20)、[CI:34](/D:/Work/Live/.github/workflows/check.yml:34)、[测试策略:17](/D:/Work/Live/docs/architecture/engineering/test.md:17) | quick job 执行后，main 的 full job 又通过 `verify` 执行 quick，随后全量还发现文档/架构测试。仓库已明确允许这类有限重复，不是现有错误。先避免人工连续重复调用；若实测占比高，再精简同一提交的 CI 编排，保持独立执行 `verify` 的完整语义，不优先维护复杂的排除名单。 |

## 4. 服务器

### 第一批：重复检查

| 编号 / 顺序 | 需要修改的测试 | 理由与方案 |
| --- | --- | --- |
| S01 · 优先 | [admin-live-state.test.js:9](/D:/Work/lira-server/test/admin-live-state.test.js:9)、[admin-surface-boundary.test.js:68](/D:/Work/lira-server/test/admin-surface-boundary.test.js:68) | 两处读取同一 `public/admin/index.html` 并匹配相同 CSS/JS 版本串。资源入口/版本策略集中一处，live-state 保留状态渲染、刷新和错误处理。若要放宽固定版本值，先对齐 [browser-page-caching.md](/D:/Work/lira-server/docs/protocol/browser-page-caching.md)，不能直接删掉缓存失效约束。 |
| S02 · 优先 | [public-surface.test.js:12](/D:/Work/lira-server/test/public-surface.test.js:12)、[同文件:61](/D:/Work/lira-server/test/public-surface.test.js:61) | 首页不包含 admin/API 入口的三个断言，在后一个测试的 HTML 分支中再次完整执行。集中成具名的 HTML、JS 两个目标检查，脚本加载测试只验证入口、加载属性和缓存约束；两种目标都保留。 |
| S03 · 优先 | [gift-blind-box-page.test.js:9](/D:/Work/lira-server/test/gift-blind-box-page.test.js:9) | 同一 `catalog-view.js` 的 `innerHTML` 禁用断言在第 24、56、77 行重复。集中到一个安全渲染检查；`blind-box-award-card.js` 是另一目标，仍需单独覆盖。不要借此删除安全边界。 |
| S04 · 优先，补齐断言后收敛 | [password-policy.test.js:22](/D:/Work/lira-server/test/password-policy.test.js:22)、[password-compatibility.json](/D:/Work/lira-server/test/fixtures/password-compatibility.json) | “Unicode examples”中的三个密码已在共享样例中，但样例循环只检查 error，并在 `result.ok` 为真时检查原文；独立用例还明确断言成功。先在具名样例中按 `newPasswordError === null` 断言 `result.ok`，保留原文检查，再删这组三个重复输入。账号相关弱密码和旧哈希场景仍保留；跨仓治理见 J02。 |

### 第二批：实现耦合

| 编号 / 顺序 | 需要修改的测试 | 理由与方案 |
| --- | --- | --- |
| S05 · 替换后处理 | [public-surface.test.js:84](/D:/Work/lira-server/test/public-surface.test.js:84)、[site-preferences.test.js:416](/D:/Work/lira-server/test/site-preferences.test.js:416)、[public-homepage.spec.js:572](/D:/Work/lira-server/e2e/public-homepage.spec.js:572) | 静态测试锁定装饰透明度/模糊值，以及 `readStoredValue`、`applyLocale` 等函数名。已有浏览器场景检查语言切换、存储拒绝、焦点和降低透明度。把持久化与 UI 结果归到运行测试，保留无追踪请求、无登录 cookie 访问等边界检查。先落实 S11 的执行归属并运行相应场景，不能仅因文件存在就删静态覆盖。 |
| S06 · 替换后处理 | [gift-blind-box-page.test.js:9](/D:/Work/lira-server/test/gift-blind-box-page.test.js:9)、[gift-blind-box-probabilities.spec.js:118](/D:/Work/lira-server/e2e/gift-blind-box-probabilities.spec.js:118) | `createBlindBoxOutputCard(...)`、`grid.append(...)` 等源码正则不能证明卡片正确显示。用现有浏览器场景验证普通礼物可跳转、权益奖励不伪造链接、概率/描述正确及无奖池时的空态；缺少的关键场景先补齐。S03 的安全检查仍保留，不把整文件视为可删。 |

### 第三批：参数化与结构

| 编号 / 顺序 | 需要修改的测试 | 理由与方案 |
| --- | --- | --- |
| S07 · 优先 | [overlay-style-options.spec.js:10](/D:/Work/lira-server/e2e/overlay-style-options.spec.js:10) | 一个浏览器测试循环多种样式，同时覆盖字体、背景、颜色和礼物图片；早期失败会遮住后续样式。把样式×同一行为展开为具名测试，沿用小型初始化函数，每例使用独立 page/路由状态；图片错误回退继续单列。保留字体、透明度和装饰颜色不受正文颜色影响的实际断言。 |
| S08 · 后续 | [song-library-validation.test.js:49](/D:/Work/lira-server/test/song-library-validation.test.js:49) | 价格文本、旧数字、空白和别名的纯函数断言可整理成“输入—预期”具名数据表。文件顶部的非法输入已经表驱动，无需重做；UTF-16 边界、内部换行和 canonical 字段清空等不同语义单列。收益是阅读和增补样例方便，不是减少运行场景。 |

### 第四批：运行分层

| 编号 / 顺序 | 需要修改的入口/测试组织 | 理由与方案 |
| --- | --- | --- |
| S09 · 优先澄清入口 | [package.json:8](/D:/Work/lira-server/package.json:8)、[CI:24](/D:/Work/lira-server/.github/workflows/check.yml:24) | `check` 和 `test` 完全相同，当前 CI 只调用一次 `check`，并没有实际重跑两次。保留兼容别名，在执行说明中明确二选一；不要把 `check → test` 当成两道不同门禁。`docs:check` 适用于单独查文档，不必在每次全量前后重复执行。 |
| S10 · 优先 | [package.json:8](/D:/Work/lira-server/package.json:8)、[test/support](/D:/Work/lira-server/test/support)、[test-environment.test.js:14](/D:/Work/lira-server/test/test-environment.test.js:14) | 测试目录下有 15 个非 `*.test.js` 的 JS 辅助/探针文件；默认发现范围过宽。明确枚举实际测试入口，保留 `--require ./test/support/test-mode.cjs`，隔离探针仍由拥有者显式启动。服务器 CI 使用 Node 20，不能未经验证照搬 Node 24 的 glob 写法；按支持版本验证收集范围和隔离场景。 |
| S11 · 优先设计分组 | [CI:27](/D:/Work/lira-server/.github/workflows/check.yml:27)、[playwright.config.js:13](/D:/Work/lira-server/playwright.config.js:13)、[e2e](/D:/Work/lira-server/e2e) | 59 个浏览器文件中，当前 CI 仅显式运行 data、images、appearance 三个入口；其余不能算作每次执行负担，也不能默认为已覆盖。建立管理、歌单、礼物、overlay、小游戏等业务组和完整浏览器入口；按变更选组，发布运行适用完整组。现有三个 CI 命令会分别启动测试服务器，可在确认文件间数据隔离后合为一次执行；保留 `workers: 1` 起步，不以直接提高并发替代隔离检查。 |

## 5. 需要客户端和服务器配合

| 编号 / 顺序 | 涉及位置 | 分工与方案 |
| --- | --- | --- |
| J01 · 第一/四批，优先统一样例 | 客户端 [license-protocol.test.js:39](/D:/Work/Live/test/license-protocol.test.js:39)；服务器 [device-license-protocol.test.js:12](/D:/Work/lira-server/test/device-license-protocol.test.js:12)、[device-protocol-contract.test.js:348](/D:/Work/lira-server/test/device-protocol-contract.test.js:348) | 两端手写了同一组 golden 字符串；服务器另有 `device-auth-v2-vectors.json`，其输入与手写向量不同，不能直接删掉一组。服务器先将旧向量及其大小写/空白场景纳入明确的版本化样例，保留固定预期字节串；客户端通过锁定 fixture 消费同一来源。两端仍各测自己的编码/验签实现，不用服务器实现计算客户端的预期答案。 |
| J02 · 第一/四批，优先统一样例 | 两仓 `test/fixtures/password-compatibility.json`；客户端 [license-password-ui](/D:/Work/Live/test/license-password-ui.test.js:170)、[license-protocol](/D:/Work/Live/test/license-protocol.test.js:8)、[remote-license-client](/D:/Work/Live/test/remote-license-client.test.js:38)；服务器 [password-policy](/D:/Work/lira-server/test/password-policy.test.js:5)、[account-activation](/D:/Work/lira-server/test/account-activation.test.js:345) | 已确认两份 JSON 的 28 条样例内容完全相同。服务器维护唯一样例，客户端通过现有契约读取器消费，避免手工同步副本。客户端保留 UI、原文传输和签名输入验证；服务器保留新密码策略、旧密码验证和激活服务流程检查。这些断言位于不同边界，不能因为样例相同只留一端。 |
| J03 · 第四批，保留覆盖并明确分工 | 客户端 [remote-license-song-budget](/D:/Work/Live/test/remote-license-song-budget.test.js:9)、[processed-gift-contract](/D:/Work/Live/test/processed-gift-contract.test.js:19)；服务器 [song-snapshot-budget](/D:/Work/lira-server/test/song-snapshot-budget.test.js:46)、[song-snapshot-http-budget](/D:/Work/lira-server/test/song-snapshot-http-budget.test.js:1)、[gift-history-contract](/D:/Work/lira-server/test/gift-history-contract.test.js:114)；[verify-song-roundtrip.cjs](/D:/Work/Live/scripts/verify-song-roundtrip.cjs:1) | 已有共享礼物/歌库 fixture 和真实 HTTP 歌库往返入口，应继续复用。客户端负责响应读取上限、解码与导入，服务器负责生成上限、事务回滚及 HTTP 拒绝，往返负责两端组合。分别保留；往返脚本的鉴权是 adapter，不能替代真实授权测试。只统一样例与执行位置，不把三层压成一条大联测。 |

J01、J02 原拟实施顺序：服务器先完成并提交样例变更；客户端再更新 [server-contract.lock.json](/D:/Work/Live/server-contract.lock.json) 的固定提交与 fixture 哈希，通过 [verify-server-contract.js](/D:/Work/Live/scripts/verify-server-contract.js) 读取。实施核实发现 J02 的完整样例已存在于当前锁定提交，因此无需新提交即可落实；J01 仍有该依赖。J02 的 28 条全集循环提取到独立契约测试组；原 UI/协议/HTTP 测试保留自主输入的提交操作、空格/Unicode 原文保持、请求体等具名行为场景，不再维护完整样例副本。纯本地 PR quick 不新增私有服务器仓库读取凭据依赖，也不绕过现有锁校验。契约字段和语义不变时不提升协议版本。

## 6. 按维护体量处理的整组范围

### 为什么局部去重还不够

- **有些存量是在保存一次改版的实现快照。**例如 [管理页布局](/D:/Work/Live/test/frontend-admin-layout.test.js:15) 同时锁定默认透明度、模糊值和 `resetValues` 的源码写法；[歌词预览](/D:/Work/Live/test/desktop-lyric-settings-runtime.test.js:196) 的一个场景横跨 DOM、循环语句、动画函数名和大量 CSS。应按当前可观察行为收敛，而不是每次改实现都同步改几十条正则。
- **测试中有大量自建环境代码。**AI 两个文件都从零搭建元素、监听器、计时器和请求记录；礼物历史同一文件多次搭建相近 DOM；服务器多个 HTTP 测试各写端口、请求、登录与关闭逻辑。它们计入测试行数，却不都是独立测试场景。
- **过去的拆文件没有减少检查。**[队列测试归属归档](/D:/Work/Live/specs/plans/archive/2026-09-13-frontend-queue-test-ownership.md:5) 明确把 1,543 行、22 个测试拆成三份并保留所有断言。它解释了文件变小但总量不减的原因；这是历史记录，不是本轮必须继续保留全部断言的规范。
- **运行维度和维护维度不同。**浏览器矩阵、重复启动、默认收集辅助文件影响运行成本；源码正则和重复夹具影响维护成本。两者分别处理，不用“通过数量下降”替代实际收益。

辅助筛查发现：客户端 39 个测试文件各有至少 20 处 `assert.match/doesNotMatch`，合计 14,253 行、2,377 处调用；服务器对应为 9 个文件、3,064 行、458 处调用。行数指命中文件的完整体量，不是正则本身的行数；这些文件与下列 56 个文件有交集，不能相加。此指标只用于定位：对运行结果、错误消息和安全规则的正则断言可能很有价值，不能把这些调用全部标成冗余。

### 客户端：7 组、38 个文件、13,942 行

下表名称默认位于客户端 `test/`，后缀为 `.test.js`。各组文件互不重叠；与前面 C/J 条目有交集，不能再次相加。行数是完整文件体量，含需保留的测试。

| 组 / 现有体量 | 涉及测试 | 具体收敛方案 |
| --- | --- | --- |
| BC01 · 页面外壳与布局；9 文件 / 3,038 行 | `admin-page-composition`、`frontend-admin-shell`、`frontend-admin-layout`、`frontend-admin-runtime`、`frontend-admin-toolbox`、`toolbox-sidebar`、`toolbox-sidebar-routing`、`ui-surface`、`admin-style-ownership` | 外壳只拥有组合顺序、唯一 ID、导航和装配；功能内部交给所属测试。清退无现行约束的逐像素/内部写法检查，将零散样式归属断言集中表达必要边界。例：[runtime](/D:/Work/Live/test/frontend-admin-runtime.test.js:36) 对加班礼物刷新检查大量函数名、Map 查询和代际变量，可在核对 `overtime-gift-picker` 的迟到回包/刷新场景后移除重复部分。鉴权、凭据不进入页面、frame/CSP 规则仍归组合测试。扩展 C01–C02。 |
| BC02 · OBS 与互动功能的源码检查；11 文件 / 3,802 行 | `games-overlay`、`danmaku-overlay`、`opening-overlay`、`clock-overlay`、`gift-effects-overlay`、`overtime-overlay`、`wheel-overlay`、`frontend-games`、`frontend-overtime`、`frontend-blindbox-admin`、`danmaku-style-ownership` | 整组含 969 处正则断言，逐功能收敛为入口/资源、关键渲染与独立边界；删除已有行为测试保护的源码语句镜像。例：[clock](/D:/Work/Live/test/clock-overlay.test.js:147) 匹配查询参数读取写法，而 [clock runtime](/D:/Work/Live/test/frontend-clock-runtime.test.js:237) 已运行设置与 URL 覆盖行为。CSS 分文件所有权保留少量有明确依据的约束，避免逐选择器成对罗列。仍保留透明/嵌入、安全转义、裁剪、资源有效性、消息来源和设置语义。扩展 C05，不整组删除。 |
| BC03 · 队列样式与滚动；5 文件 / 2,633 行 | `frontend-queue`、`frontend-queue-themes`、`frontend-queue-scrolling`、`queue-overlay-responsive`、`queue-overlay-esm` | 将字体/主题设置、完整行缩放、裁剪和滚动各归到一个明确拥有者；对照页面、主题、响应式测试的被测目标与输入，删除已确认的交集及无规格依据的装饰数值。各主题存在不同渲染分支时保留相应场景；已保存设置、滚动终点和事件更新仍独立。现有滚动运行场景优先复用，不把 323 处正则逐条变成浏览器测试。扩展 C06，尚未认定这五份存在完整重复场景。 |
| BC04 · 歌词界面与样式归属；4 文件 / 1,078 行 | `desktop-lyric-settings`、`desktop-lyric-settings-runtime`、`desktop-lyric-surface-ownership`、`desktop-lyric-style-ownership` | 收敛 [runtime:196](/D:/Work/Live/test/desktop-lyric-settings-runtime.test.js:196) 大段源码和 CSS 检查：时间线/逐字行为由 [renderer](/D:/Work/Live/test/desktop-lyric-renderer.test.js:10) 等运行场景拥有，设置保存、字体拒绝、OBS/管理页装配分别保留。版本串和选择器归属集中；OBS 页面与管理页的相同 ID 不是同一入口，不能删掉其中一页。不同宿主共有的是渲染算法测试，不是宿主授权和接线测试。 |
| BC05 · AI/弹幕重复细节与初始化；4 文件 / 1,404 行 | `frontend-admin-danmaku`、`frontend-admin-ai`、`frontend-admin-ai-autosave`、`frontend-admin-ai-secrets` | 把 [autosave:15](/D:/Work/Live/test/frontend-admin-ai-autosave.test.js:15) 与 [secrets:15](/D:/Work/Live/test/frontend-admin-ai-secrets.test.js:15) 重复的元素、监听、时钟和请求记录搭建提成只服务 AI 面板的小夹具；每例重建状态。随后把弹幕/普通 AI 测试中的防抖、监听写法、编辑保持检查与运行场景对照收敛。密钥不泄漏、模型请求、保存与切换仍独立。C04、C07 应作为同一组整理，不能只拆大测试而保留重复环境。 |
| BC06 · 礼物相关自建 DOM；3 文件 / 1,736 行 | `frontend-gift-history`、`frontend-gift-history-recovery`、`overtime-gift-picker` | [history:147](/D:/Work/Live/test/frontend-gift-history.test.js:147)、同文件 :331/:451 和 [recovery:274](/D:/Work/Live/test/frontend-gift-history-recovery.test.js:274) 重复搭建同一历史面板；共享该面板的小型初始化，排序/关闭/失败恢复仍分别测试。[picker:400](/D:/Work/Live/test/overtime-gift-picker.test.js:400) 的大段模块桩及 :601 的假 DOM 单独评估，优先复用现有模块加载器；不与历史面板硬合成通用 DOM 框架，也不把全部离线测试升级为浏览器测试。收益以测试加 helper 的净行数验证。 |
| BC07 · 重复 ESM 加载器；2 文件 / 251 行 | `playback-wesing`、`playback-provider-operations` | [两份](/D:/Work/Live/test/playback-wesing.test.js:153) [加载器](/D:/Work/Live/test/playback-provider-operations.test.js:52) 都维护同类 VM 模块递归链接逻辑；核对全局注入与链接行为后改用已有 [frontend-modules](/D:/Work/Live/test/helpers/frontend-modules.js:30)。保留播放器行为和模块隔离，减少 helper 副本；不要为此扩大生产模块导出或重构业务代码。 |

### 服务器：5 组、18 个文件、8,409 行

下表未注明 `e2e/` 的名称位于服务器 `test/`、后缀为 `.test.js`。各组互不重叠，部分文件承担契约和安全职责，体量不能直接换算为删除量。

| 组 / 现有体量 | 涉及测试 | 具体收敛方案 |
| --- | --- | --- |
| BS01 · 页面静态检查；7 文件 / 2,260 行 | `public-surface`、`site-preferences`、`admin-live-state`、`admin-surface-boundary`、`streamer-manage-surface`、`gift-blind-box-page`、`public-song-page` | 统一入口/缓存与安全检查的拥有者；纯函数继续低层测试，页面行为优先归到已有浏览器组。处理 S01–S03、S05–S06 后，继续删重复选择器、函数名、装饰常量。版本缓存、管理端与公开端分离、秘密字段禁止暴露仍保留，不能把所有否定正则当成“旧 UI 残留”。先落实浏览器执行入口，文件存在不等于持续覆盖。 |
| BS02 · 小游戏页面与发布契约；2 文件 / 993 行 | `public-games-page`、`game-offline-contract` | [页面测试:264](/D:/Work/lira-server/test/public-games-page.test.js:264) 和 [发布测试:380](/D:/Work/lira-server/test/game-offline-contract.test.js:380) 都检查 `loadStylesheet(moduleConfig.styleUrl)`、`moduleConfig.scriptUrls.reduce` 和同一版本映射。将资源版本/加载边界归发布契约，页面只保留目录解析、展示、链接和文本安全。优先复用已有 [game-publications.cjs](/D:/Work/lira-server/test/support/game-publications.cjs)，固定预期继续来自独立契约数据，不能从被测 loader 反推期望。Host、immutable/ETag、资源白名单、包体预算和离线零请求保障不删。 |
| BS03 · HTTP 测试初始化；5 文件 / 2,729 行 | `song-page-title`、`song-page-qr`、`cloud-sync-http`、`overlay-settings-routes`、`password-reset-flow` | 前两份各建临时 DB、租户、Express、请求收集器；后三份已经复用 [test-environment](/D:/Work/lira-server/test/support/test-environment.cjs:133)，仍各写 `freePort/request/waitForServer/login`。只共享相同生命周期与 HTTP 传输操作，接口响应、身份、租户与业务预置留在测试正文。同进程 Express 与完整子进程不能硬合；QR 的 SVG/字节响应不能被统一 JSON 解码破坏。目标是减少重复搭建，不减少鉴权/重置/隔离场景。 |
| BS04 · 文档治理中的一次性断言；2 文件 / 788 行 | `documentation-governance`、`gift-sync-documentation-governance` | [旧计划删除清单:499](/D:/Work/lira-server/test/documentation-governance.test.js:499) 和 README 逐句中文正则应审查是否只是已完成迁移的验收痕迹；无当前约束者退休，有要求者检查稳定结构和索引关系。礼物治理中的协议/fixture 必要字段归相应 schema/契约检查，去除与通用治理门禁重复的存在性检查。REQ/AC 唯一性与关联、路由/OpenAPI 对齐、敏感信息及 normative 边界仍保留；不整文件删除或把文档门禁关掉。 |
| BS05 · 浏览器场景矩阵；2 文件 / 1,639 行 | `e2e/public-homepage.spec.js`、`e2e/offline-games.spec.js` | [首页:161](/D:/Work/lira-server/e2e/public-homepage.spec.js:161) 在 9 个视口重走语言、同意弹窗、导航及截图。先分离功能与布局的验证责任：独立功能场景拥有持久化/文案更新，多视口保留形成布局状态所需的操作及断言，收敛尺寸无关的重复细节和非必须诊断截图。**首页语言/Cookie 状态、字号与留白已有 [现行验收](/D:/Work/lira-server/docs/requirements/acceptance-criteria.md:2560)，小游戏六视口与精确几何也有 [要求](/D:/Work/lira-server/docs/requirements/acceptance-criteria.md:2532)**，不能当装饰细节随意删除。本行是矩阵审查范围，不是减少规定视口或截图的建议；收益待测量，执行入口按 S11。 |

### 双端配合的边界

以上 BC/BS 的 UI、夹具和运行入口整理可以分别实施，不需要为了测试重构改协议。真正需两仓配合的是 J01–J02 的共享样例与锁定版本；J03 的两端单独边界及组合验证继续存在。不得把“减少重复 fixture”误做成“只在一端验证协议”。

### 怎样确认确实变轻

实施每组时记录测试文件与 helper 的合计行数、保留的独立场景和实际运行时间；源码断言还需记录删除理由或替代位置。辅助代码搬到新文件不算净减少；多个场景塞进一个测试也不算。只要保障不丢、维护代码减少、无关实现变更不再触发一片测试修改，就有真实收益，不要求用例数同步下降。

原审查没有做删除后的等价性实验，也没有逐项穷尽全部 678 个测试文件，因此不承诺“可以删一半”或预设百分比。56 个文件是有具体证据的首轮成组范围，不是两仓唯一可能精简的地方；本次实施的替代覆盖和故障实验见第 10 节。

后续新增测试也应沿用现有仓库的风险分级：已有场景能保护的微小改动不再增加源码写法断言；新增场景说明独立风险并放在拥有该行为的层；一次性改版检查在对应迁移完成后复查是否还有长期价值。现行规格明确要求的验证仍执行，不能仅为减少数量放宽规格。

## 7. 明确保留的相似测试

| 对象 | 不直接合并的原因 |
| --- | --- |
| [desktop-lyric-surface-ownership](/D:/Work/Live/test/desktop-lyric-surface-ownership.test.js:10) 与 [desktop-lyric-settings-runtime](/D:/Work/Live/test/desktop-lyric-settings-runtime.test.js:242) | 相似 ID 断言分别针对 OBS 歌词页和管理页预览，两个宿主都需要接线正确。 |
| [frontend-welcome](/D:/Work/Live/test/frontend-welcome.test.js:84) 与 [frontend-pk-report](/D:/Work/Live/test/frontend-pk-report.test.js:83) | 未授权不能读取设置的结果相似，但两个独立页面各有调用入口；可以复用小夹具，不能只测其中一页。 |
| [license-manager-renewal](/D:/Work/Live/test/license-manager-renewal.test.js:11) 与 [license-manager-revalidation](/D:/Work/Live/test/license-manager-revalidation.test.js:1) | 续期、重验证、并发和失效时序不同；最终都进入 BLOCKED 不等于同一故障路径。 |
| [bilibili-gift-parity](/D:/Work/lira-server/test/bilibili-gift-parity.test.js:382) 与 [streamer-storage-gift-migration](/D:/Work/lira-server/test/streamer-storage-gift-migration.test.js:146) | 相同数据库行数断言分别保护实时事件处理和历史迁移，不能靠文本相同认定重复。 |

数据迁移/回滚、租户隔离、授权失败、取消与迟到回包、幂等/去重等测试继续按行为保留。现有参数化用例和共享辅助模块也不需要仅为统一形式而重写。

## 8. 建议落地顺序与验收

1. **从整组开始，先拿确定收益：**客户端 BC01–BC02、服务器 BS01–BS02 先只处理已确认重复和可直接退休的部分，另纳入 C01–C02、S01–S04 的局部项。每次只整理一个拥有者；需要替代行为覆盖的部分留到第三步，不能因进入某组就整组删除。S04 先补成功断言；功能、权限和失败路径保持具名可定位。
2. **明确运行边界：**C10–C11、S09–S11。先输出各组文件清单和依赖，验证分组合集等于原有真实测试入口；额外收集的辅助文件单列。记录总耗时、最慢文件、跳过项与失败原因，再决定 C12 是否值得做。
3. **收敛实现镜像与初始化：**BC05 与 C07/C04 同步处理，先建立清晰的 AI 场景和共享初始化，再移除重复。此步同时承接 BC01–BC02、BS01–BS02 的剩余行为替代，并继续 BC03–BC04、BC06–BC07、BS03–BS04。需要保留行为的检查关联到可运行的替代测试，确认执行入口并通过后移除旧断言。通过临时改变预期行为确认关键替代断言会失败，恢复后重跑相关组；不依赖“代码覆盖率没下降”单独证明等价。已确认无独立责任的旧断言不强制补一条新测试。
4. **再调矩阵、参数化与共享样例：**BS05、C08–C09、S07–S08、J01–J02。视口矩阵先对齐接受的验收要求，参数化前后对照样例、边界和独立状态；共享数据遵循服务器提交→客户端锁更新→两端契约验证。J03 保留现有分层覆盖。

每个实施改动仍按仓库风险分级验证。原报告审查仅核对证据路径、行号、方案边界和 Markdown；本次实施运行隔离测试，不读写用户数据库、不执行发布。

## 9. 参考的成熟项目原则

| 来源 | 本报告采用的原则 |
| --- | --- |
| [Google：Test Behavior, Not Implementation](https://testing.googleblog.com/2013/08/testing-on-toilet-test-behavior-not.html) | 行为没有变化时，测试应尽量不因内部重构变化；具体性能或安全要求仍可约束实现。用于第二批。 |
| [Google：Tests Too DRY? Make Them DAMP!](https://testing.googleblog.com/2019/12/testing-on-toilet-tests-too-dry-make.html) | 测试首先要容易看懂和判断正确；允许适量重复，不为缩短代码隐藏输入、预期或状态。用于第三批，避免过度抽象。 |
| [GitLab：Testing levels](https://docs.gitlab.com/development/testing_guide/testing_levels/) | 低层充分验证细节，高层关注组合和关键用户流程，避免在更昂贵层重复穷举。用于第四批和双端分工。 |

这些资料提供取舍原则，不代表 LIRA 必须采用相同框架、固定测试比例或大型 CI 平台。优先复用现有 Node、Playwright、Electron 和锁定契约机制。

## 10. 首轮实施记录（2026-09-21）

本节保留首轮实施与验证结果；后续精简及最新累计统计见第 11 节。

### 工作树与统计口径

已读取两仓 `AGENTS.md`、客户端 `PLANS.md` 及对应规范，按组先测再改。初始状态、差异、测试/helper 文件快照、命令输出和故障实验保存在本机 `C:/Users/Tom/AppData/Local/Temp/lira-test-maintenance-349Yj9`，详细批次记录为 `client-surfaces-notes.md`、`client-fixtures-notes.md`、`server-tests-notes.md`；不把这些临时证据加入仓库。客户端原有 17 个已修改文件的差异与初始记录一致，两仓暂存内容未变；原有未跟踪业务、计划及设计资源保留。本任务未修改生产实现、增加依赖、提交、建分支或发布。

以下仍按第 1 节 JS 口径统计，每个路径只计一次，**包含全部新增 helper、行为替代和拆出的独立场景**。C/S/J 与 BC/BS 重叠不重复计数；不以显示用例数衡量精简。

| 范围 | 修改前 | 修改后 | 净减少 |
| --- | ---: | ---: | ---: |
| 客户端全部测试及 helper | 94,972 | 93,862 | 1,110 |
| 服务器全部测试及 helper | 65,284 | 64,783 | 501 |
| **合计** | **160,256** | **158,645** | **1,611** |
| BC01（包含 C02 侧栏文件） | 3,038 | 2,789 | 249 |
| BC02 | 3,802 | 3,571 | 231 |
| BC03 | 2,633 | 2,513 | 120 |
| BC04 | 1,078 | 1,034 | 44 |
| BC05（包含 AI helper） | 1,404 | 1,284 | 120 |
| BC06（包含历史面板 helper） | 1,736 | 1,581 | 155 |
| BC07 | 251 | 198 | 53 |
| BS01 | 2,260 | 1,989 | 271 |
| BS02 | 993 | 971 | 22 |
| BS03（包含 HTTP helper） | 2,729 | 2,571 | 158 |
| BS04 | 788 | 721 | 67 |
| BS05（包含新增实际透明度验证） | 1,639 | 1,657 | -18 |

BC/BS 候选及其新增 helper 合计减少 1,472 行；候选外测试/helper 净减 139 行，合计为上表 1,611 行。候选外包含 C08/C09、账号面板独有断言、J01/J02、S04/S08 和浏览器替代覆盖，不能再次叠加批次统计。新增三个执行脚本共 **167 行**，若同时计入执行脚本，JS 净减少 **1,444 行**。JSON 另计：删除客户端密码样例副本 254 行，服务器授权向量增加 41 行；未把移动 golden 数据当成无成本删除。首轮逐路径账本已归档为证据目录的 `round2/round1-final-accounting.json` 和两份 `round2/round1-*-current-counts.json`；根目录账本记录最新累计结果。

### C / S / J 逐项结论

| 条目 | 状态、删除理由与剩余归属 |
| --- | --- |
| C01 | 已实施。账号/设备/重置密码内容只归 `license-ui`，迁入唯一“账号信息”断言；shell 保留组合、入口和初始隐藏，独立登录页面覆盖保留。 |
| C02 | 已实施。连接/发送分组、机器人双列、600px 窄屏等独有断言迁入 `frontend-admin-danmaku`；sidebar 保留导航、可见性、选中和挂载。无当前要求的缩略图内部标记与装饰像素退休。 |
| C03 | 已实施。复用现有 `ui-edit-state-fixture`，执行中文/emoji 计数、账号/缺失状态、登录后刷新、断线重开与已连接不重连；删除对应表达式/函数名镜像。该文件列入 browser 组；模拟 bridge 不声称验证 Electron 授权。 |
| C04 | 已实施，与 C07/BC05 同批。AI HTML 字段/默认值归 `frontend-admin-ai`，防抖、编辑保持、保存和字段映射由执行模块验证；弹幕只保留 AI 装配。`innerHTML` 禁令在 AI 所属处保留一次。 |
| C05 | 已实施可证明部分，其余具体保留。drawing undo/指针输入/快捷键归 `games-drawing`；弹幕样例与样式 URL 归 `danmaku-local-preview`，feed 归 renderer/fullscreen。未被运行场景触发的 pointerup 接线、消息来源、安全转义、素材和实际裁剪继续保留。 |
| C06 | 已实施。完整行缩放/素材坐标由 responsive 的原有表拥有；themes 复用每次新建 VM 的小助手，底部遮挡检查改为相对前景几何。退休无现行要求的 88%/-2% 装饰快照；规定的 94%/72%、115%/80%、固定宽度及滚动终点保留。几何计算不是浏览器实测。 |
| C07 | 已实施。594 行长链拆为 14 个独立 autosave 场景，secrets 为 4 个；177 行 AI 专用 helper 复用控件、可取消时钟、请求，每例重建。供应商切换等必要连续操作仍在各自场景内。 |
| C08 | 已实施。三个 URL 策略分别具名表驱动，原 45 组 URL/预期全部保留（14/24/7）；伪装子域、凭据 URL、大小写及 loopback 等攻击变体未删。 |
| C09 | 已实施。仅五类同路径 getProfile 拒绝复用错误工厂，每例新 harness 并清理；续期、重验证、并发和 heartbeat 不合并。 |
| C10 | 已实施。`scripts/run-tests.js` 仅枚举根 `test/*.test.js`，保留 VM flag、并发 6 和默认进程隔离；helper/probe 仍导入或显式启动。 |
| C11 | 已实施。按实际依赖分为 offline 365、browser 8、desktop 4、installer 5、contracts 8 文件，互斥并集 390；原 389 文件无遗漏，新增密码契约文件 1 个。32 个 helper/probe 不再独立收集（原 29 + 新 3）。 |
| C12 | 已实施。实测 quick 48.523s，重复有明显成本；CI quick 增加离线行为，依赖其成功的 main full 补其余四组及往返，避免同一提交重复 quick/offline。独立 `npm run verify` 语义不变，未建立复杂排除系统，也未声称端到端提速比例。 |
| S01 | 已实施。Admin 资产入口/依赖顺序归 `admin-surface-boundary`；按缓存规范保留版本化入口，删除历史 query 固定值。HTTP 缓存仍由 `production-domain-config`/`management-auth` 验证，live-state 的状态/错误行为保留。 |
| S02 | 已实施。HTML 和 JS 禁止 Admin/API 暴露分别具名一次；脚本加载测试只负责入口/defer/缓存。 |
| S03 | 已实施。catalog-view 的 `innerHTML` 禁用只查一次；award-card 是独立目标，单独保留。 |
| S04 | 已实施。先补 `result.ok === (newPasswordError === null)`，再删重复的三个 Unicode 输入；原文、弱密码、旧哈希、NFKC、控制字符和 bcrypt 边界保留。 |
| S05 | 已实施。函数名/DOM 语句和装饰值镜像移交已执行的 homepage 语言、存储拒绝、焦点与透明度场景；补实际背景透明/文字不透明断言。无追踪与不访问授权 cookie 的边界保留。 |
| S06 | 已实施。跳转/权益/概率归 `gift-blind-box-probabilities`，补奖池 absent/empty、纯文本说明/缺省、metadata 折叠/切换和英文权益值；安全静态检查继续保留。 |
| S07 | 已实施。7 个背景字体、9 个文字颜色及 1 个图片回退分别为独立 page 场景，沿用小型初始化；代码增加 10 行如实计入，不合并独立保障。 |
| S08 | 已实施。五类价格输入具名表驱动；UTF-16、内部换行、超长和 canonical 清空仍独立。 |
| S09 | 已实施。`check` 明确为 `npm test` 的兼容别名，二选一；`docs:check` 显式收集礼物治理文件，避免其原先经另一个 `.test.js` require 后在全量中重复执行。 |
| S10 | 已实施。`scripts/run-tests.cjs` 传具体文件，保留 test-mode preload、230 个真实入口和隔离探针；16 个 helper/probe 不再默认收集（原 15 + 新 1）。Node 20.20.2 与 24.15.0 集合一致，20 的隔离/退出码探针验证通过。 |
| S11 | 已实施。59 个 browser 文件分为 admin/songs/gifts/overlay/games/public/shared；全量及七组入口可列出全部 624 场景。CI 9 文件集合包含原 data/images/appearance 与源码替代拥有者，一次服务器生命周期执行；原别名仍有效。workers、快照路径和临时数据隔离不变。 |
| J01 | **服务器准备完成，客户端实际应用阻塞于新提交。**服务器 fixtureVersion 升为 2，追加原手写大小写/空白 golden 向量及固定字节，原向量保留，wire protocolVersion 仍为 2；服务器独立消费通过。另已准备客户端四文件迁移补丁（见下），核对两端八次 canonical 字节比较和 code/password 字段映射。用户禁止提交，因此当前客户端保留旧 golden，不能把工作树伪装成新 revision。后续需服务器真实提交，再更新锁的实际 revision/hash、应用消费者补丁并跑双端及往返。 |
| J02 | 已实施。28 条样例已存在于锁定 `5ea7b01c8fc7b1cec34a43b01f99c403fd9d1577`，核对当前/旧副本/该提交数据相同；用该提交原始字节 SHA-256 加入第六份 fixture，revision 不变，删除客户端副本。`license-password-contract` 对每条样例在 UI、签名输入、HTTP 三边界独立验证；本地原文件保留空输入、Unicode/空格及请求体等自主行为。未放宽锁验证。 |
| J03 | 核实后保留并实际验证。客户端读取/解码/导入预算、服务器生成/事务回滚/HTTP 拒绝分别保留；真实 HTTP 歌库往返 5/5。往返授权 adapter 未代替真正授权测试。 |

### BC / BS 候选的完整处置

| 组 | 已实施与核实后保留的具体范围 |
| --- | --- |
| BC01 | 九文件均核实。删除历史主题默认值/reset 写法、光学 -1px、toolbar 装饰和废弃 fragment 检查；默认值仍由 runtime 比较现行 theme/storage，源码规模交统一 modularity 门禁。路由/四入口实际文档、顺序/唯一 ID、凭据/frame/CSP、共享确认框等保留。**初始 loadCatalog 的 generation 保护故障未被 picker 测试发现，已恢复静态断言**；每次打开 refresh API、saved-rule/server artwork 接线亦无等效替代，保留。 |
| BC02 | 十一文件均核实，九文件精简。删除已有实际执行保护的 query/merge/readMode/undo/feed 镜像、同目标安全检查副本和无要求旧文案/装饰。`overtime-overlay` 整体保留：现行 2cqmin/8.5em/断点/vh fallback、revision/队列/visibility 责任独立；`danmaku-style-ownership` 整体保留：import、各素材及 SVG 安全/不同字节责任独立。其余透明、消息来源、安全、素材、裁剪、时序和规定尺寸继续保留。 |
| BC03 | 五文件均核实，三文件精简。相同比例/背景坐标只归 responsive；clone 删除由实际运行结果保护。`frontend-queue` 的迁移/存储/表单与 `queue-overlay-esm` 的真实模块图/六渲染路径整体保留；主题分支、admin 控件隐藏接线、resize、实际滚动和当前美术值独立保留。 |
| BC04 | 四文件均核实，三文件精简。重复 grid/card/font 数值只归 settings；500ms 防抖/串行保存由 runtime，算法归 renderer；旧英文提示/旧按钮不存在性退休，规模清单归统一门禁。OBS surface 整体保留：它是另一个宿主；完整 timeline DOM、暂停跟随、宿主事件/权限及 JS/CSS 各自缓存入口无完整等效覆盖，继续保留。 |
| BC05 | 四文件与 C02/C04/C07 同步整理完成。AI 的普通表单刷新改为实际 `FormsService.fillForm`，去除无要求装饰轨道/渐变及内部变量名；保留服务器范围约束、焦点、模块顺序、云端/本地边界。保存队列、初始编辑保持、密钥/掩码不泄漏、模型请求、无模型状态和供应商能力均独立。 |
| BC06 | 三文件均核实。history 三处重复面板搭建与 recovery 共用 157 行小 helper；请求/计时器/AbortController/模块每例隔离，排序/键盘/游标/关闭/恢复/取消/迟到回包保留。picker 的字符串桩与八个全局变量改用 SyntheticModule；专用私有导出注入和嵌套 DOM/同 ID 素材/原地筛选未被通用 loader 支持，保留窄加载器与既有 DOM，不扩建框架。 |
| BC07 | 已实施两份 ESM loader 复用现有 `frontend-modules`；相同 globals 和独立 context、原五场景保留。未改公共 helper 或用户已修改的 playback-app。 |
| BS01 | 七文件均核实。除 S01–S06 外，Admin stats/alerts 布局由 `admin-overview-layout`，主播导航由 `streamer-console-navigation`，公开歌曲筛选/页头由对应 browser 文件拥有。保留当前 AC-UX-001/002 字体/留白/动效、980px 歌单几何及未被浏览器覆盖的 1051–1280 三列断点；管理/公开分离、只读、tenant host/selector、秘密禁止暴露继续保留。 |
| BS02 | 两文件已整理。loader/版本映射只归 `game-offline-contract` 及独立 `GAME_PUBLICATIONS` 预期；页面保留目录、Host 链接、错误和文本安全。immutable/ETag、白名单、预算和离线零请求不删。 |
| BS03 | 五文件已整理，新增 83 行 `support/http-client.cjs` 只共享端口、原始响应/可选 JSON、readiness。两个 Express 测试复用既有隔离环境并先关 server；子进程仍走原生命周期。QR 原始 bytes/text、租户种子、身份、登录结果、SSE/回滚留在各测试；登录仅两处相似且返回/身份要求不同，不再抽象。 |
| BS04 | 两文件已整理。退休已完成旧计划/反向规格/抓取脚本删除清单和 README 逐句快照；fixture 重复固定值归已执行 `gift-history-contract`。REQ/AC 唯一性/关联、OpenAPI 路由、安全/normative/secret、seed/runtime 规则保留；三条独有 traceability 行存在性及 schema/官方 relation/空 outbox 等没有完整重复，保留。 |
| BS05 | 两文件核实，首页仅删除四条尺寸无关重复结构断言；新增的真实透明度替代使本组净增 18 行。九个首页视口及语言/Cookie 状态/截图/字号/留白全保留。小游戏六视口/精确几何原样保留；基线页脚命中区 32px 小于规定 44px 的 18 失败未被弱化，亦未借本任务改生产代码。 |

### 实际验证、耗时与限制

主要运行环境为 Windows、Node 24.15.0。下表秒数是实测墙钟，部分批次并行，范围与具名展开数量也有变化，因此不能相减宣称稳定性能收益。入口基线是在各独立批次开展期间测得，逐组修改前基线才是对应语义对照。所有已实施组均跑了修改前后同范围测试与直接消费者；各批及最终均检查差异/空白。

命令简写：`C(名字列表)` 表示客户端 `node --experimental-vm-modules --test --test-concurrency=6` 后逐项追加 `test/名字.test.js`；`S(...)` 表示服务器 `node --require ./test/support/test-mode.cjs --test` 同样追加文件；`B(...)` 表示服务器 `npx playwright test` 后追加 `e2e/名字.spec.js --workers=1`。这只是记录缩写，不是新增执行器。以下清单与本机批次 notes 保存的展开命令一致。

| 验证范围与实际命令 | 修改前 | 修改后/末次 |
| --- | --- | --- |
| BC01：C(admin-page-composition, frontend-admin-shell, frontend-admin-layout, frontend-admin-runtime, frontend-admin-toolbox, toolbox-sidebar, ui-surface, admin-style-ownership, license-ui, overtime-gift-picker, admin-state, admin-state-ordering, admin-state-renderer) | 108/108；0.825s | 103/103；1.154s |
| BC02：C(games-overlay, danmaku-overlay, opening-overlay, clock-overlay, gift-effects-overlay, overtime-overlay, wheel-overlay, frontend-games, frontend-overtime, frontend-blindbox-admin, danmaku-style-ownership, games-drawing, danmaku-overlay-renderer, danmaku-overlay-fullscreen, danmaku-local-preview, frontend-clock-runtime, overtime-rule-editor) | 84/84；1.035s；select-menu-overflow 消费者另 2/2 | 原范围 82 + frontend-select-menu-overflow 消费者 2，84/84；1.012s |
| BC03：C(frontend-queue, frontend-queue-themes, frontend-queue-scrolling, queue-overlay-responsive, queue-overlay-esm) | 41/41；0.511s | 40/40；0.383s |
| BC04：C(desktop-lyric-settings, desktop-lyric-settings-runtime, desktop-lyric-surface-ownership, desktop-lyric-style-ownership, desktop-lyric-renderer, desktop-lyrics, lyric-performance) | 28/28；0.559s | 28/28；0.426s；最后含恢复保护的界面消费者合并复验 183/183，1.663s |
| C02/BC05：C(toolbox-sidebar-routing, frontend-admin-danmaku, frontend-admin-ai, frontend-admin-ai-autosave, frontend-admin-ai-secrets) | 20/20；0.375s | 核心替代 39/39；2.214s；后续独立场景纳入末次组 |
| BC06：C(frontend-gift-history, frontend-gift-history-recovery, overtime-gift-picker) | 24/24；0.660s | 24/24；0.591s；场景名集合不变 |
| BC07：C(playback-wesing, playback-provider-operations) | 5/5；0.425s | 5/5；0.277s；场景名集合不变 |
| C02/BC05–07 末次：上述三组并集 + frontend-danmaku-overlay-filters | — | 74/74；2.038s；settings-auth-profile/daily-bot-frontend/server-danmaku-settings/frontend-gift-history-selection/overtime-rule-editor/frontend-overtime 消费者 31/31，2.527s |
| C(ui-edit-state)，另加 `--test-name-pattern='danmaku panel initializes'` | 1/1；2.068s | 1/1；2.233s；最后 history 清理重跑 15/15 |
| C08/C09：C(electron-url-policy, license-manager-renewal, license-manager-revalidation) | 47/47；0.394s | 70/70；0.238s，输入不减 |
| S01–S04：S(admin-live-state, admin-surface-boundary, public-surface, gift-blind-box-page, password-policy) | 70/70；0.460s | 71/71；0.298s |
| BS01/BS02/S08：S(site-preferences, streamer-manage-surface, public-song-page, public-games-page, game-offline-contract, production-domain-config, management-auth, song-library-validation) | 76/76；2.247s | 页面 Node 组 92/92，2.210s；发布/治理/价格及 gift-contract/seed 消费者组 45/45，1.364s |
| BS03/BS04：S(song-page-title, song-page-qr, cloud-sync-http, overlay-settings-routes, password-reset-flow, documentation-governance, gift-sync-documentation-governance) | 75/75；1.850s | HTTP 五文件 + test-environment：70/70，4.646s；最后含 password-policy/song-library-validation/governance/streamer-manage-surface：121/121，1.905s |
| B(public-homepage, gift-blind-box-probabilities, overlay-style-options, offline-games, admin-overview-layout, streamer-console-navigation, public-song-header, public-song-artist-filter) | 108 pass / 18 fail；256.304s | 改动后同组除未改动的 offline-games：113/113，198.779s；不将范围差异算作提速 |
| J01/J02 服务器：S(device-license-protocol, device-protocol-contract, account-activation) | 111/111；3.751s | 111/111；3.635s |
| J02 客户端：C(license-password-ui, license-protocol, remote-license-client) | 92/92；0.509s | 增加 license-password-contract/server-contract：137/137，10.590s |
| 客户端旧/新 `npm test` 完整入口 | 2665 pass / 1 fail / 4 skip；43.765s | 2681 pass / 1 fail / 4 skip；33.991s，**并非全绿** |
| 服务器旧 `npm run check` / 新 `npm test` | 1682/1682；29.165s | 1665/1665；22.599s，无 skip |
| 服务器原 `test:browser:data` / `:images` / `:appearance` | 全部通过；20.090/4.174/15.632s | `npm run test:browser:ci`：121/121；225.594s；包含新替代拥有者，不是同范围提速对照 |
| 客户端 `npm run test:offline -- --test-reporter=spec`，LIRA_SERVER_ROOT 指向不存在目录 | — | 2471/2471；28.050s，无 skip；验证 quick 无私有检出依赖 |
| 客户端 `npm run test:desktop`；原生端口归属单文件 | — | 6/6；6.863s；单文件 3/3，8.551s |
| 客户端 `npm run verify:contracts` + `npm run verify:roundtrip`，真实锁定检出 | — | 六份 fixture 验证通过，真实 HTTP 往返 5/5；合计 1.714s |
| 服务器 `npm run docs:check` | — | 33/33；0.916s，包含显式礼物治理入口 |
| 客户端 `npm run verify:quick` | 通过；48.523s | 通过；48.465s，文档、语法、架构门禁全过 |
| 新服务器执行器/helper `node --check`；两仓 `git diff --check` | — | 通过；最终差异与状态已核对，无本任务生产实现、运行数据或敏感文件 |
| J01 准备：`node --require D:/Work/lira-server/test/support/test-mode.cjs C:/Users/Tom/AppData/Local/Temp/lira-test-maintenance-349Yj9/verify-j01-preparation.cjs` | — | 八次两端 canonical 比较通过，缺失 code/password 映射会改变结果；0.262s。这是工作树数据的准备验证，不是锁定契约通过 |
| 完成审计补正文档后的 `npm run verify:docs` | — | 5/5；0.648s |

完整客户端入口的失败在修改前后均为 `local-instance-windows.test.js:89`：Windows 原生 TCP 所有者查询在并发负载下返回 undefined ProcessId/超时；单独及 desktop 分组通过，未调大超时或修改实现。四个既有安装器 skip 分别为 app-exit、directory、migration、uninstall，缺少 `LIRA_TEST_MAKENSIS`，其中三个还需 `LIRA_TEST_NSIS_PLUGINS`；未将 skip 记为通过。完整客户端执行后最后 BC04/保护恢复由 183/183 针对组补验，随后 offline 也通过，未重复整套。

服务器 18 个既有小游戏失败是备案页脚链接高度 32px，小于现行 44px 要求；原文件未修改，修改后不重复运行同一失败。59 文件的 624 场景已完整收集，**没有声称全浏览器套件全绿**；113 和 121 两组有重叠，不能相加。Node 20.20.2 实跑具体路径收集（230 文件）、test-mode preload、两个独立子进程 PID、成功 0/故意失败 1 的退出码；完整原生数据库套件在 Node 24 运行，未在 Node 20 重建并复跑。

初次 picker 基线因默认 sibling HEAD 与锁不一致而失败，改用经验证的既有只读固定检出后重跑通过，锁未放宽。实施中发现的 fixture 自身 root/dataset/预期标签错误均在测试层修正后复验；外部故障配置初次 MODULE_NOT_FOUND 不是故障被检出。工作流 YAML 使用现有 Python PyYAML 解析通过；本地没有 js-yaml 时没有新增依赖。

往返使用的本任务临时 detached worktree 已在验证后正常移除；原有固定检出未改动或删除，证据目录继续保留。测试拥有的 3317/3318 监听与本任务测试进程已结束。

完成审计补正测试策略中仍写“五个文件”的契约升级说明，改为核对全部登记 fixture。J01 客户端可审阅补丁为本机证据目录的 `j01-client-after-server-commit.patch`，`git apply --check` 通过；它准备新增独立 canonical 契约文件、删除旧 golden 副本并调整分组/说明，未写入真实工作树、未计入精简行数。补丁不含尚不存在的 revision/hash；必须在服务器真实提交后补齐并验证锁，才可应用。直接读取新 fixture 的现行契约读取器仍以 `SERVER_CONTRACT_FIXTURE_UNDECLARED` 拒绝，确认没有绕过锁。准备脚本首次未带服务器 test-mode preload 而在配置阶段失败，补齐既有 preload 后才得到上述有效结果，未使用真实凭据。

关键替代已做故障实验：中文/emoji 改 UTF-16 计数、错登录事件、AI 700ms 改 1ms、掩码泄漏、活动编辑覆盖、弹幕 guard 样例、drawing undo 改 clear、队列前景遮挡、歌词 500ms 改 0、服务器成功 ok 缺失、空奖池、默认折叠、语言持久化、Cookie 文字透明和密码 trim 均产生对应失败；恢复后相关测试通过。实验用隔离模块/响应或临时修改后按原字节恢复，不留下生产差异。初始目录 generation 故障曾未被 picker 检出，因此恢复所属静态检查，再注入同一故障可使该检查失败；没有把该缺口当作可删除依据。

仍待后续的是 **J01 的服务器真实提交及客户端锁/消费者迁移**，以及另行处理已记录的 Windows 原生查询不稳定、小游戏页脚几何和安装器工具缺失。它们不阻止上述独立精简完成，但本记录不表述为整份报告已无剩余事项。

## 11. 继续精简（2026-09-21）

已按追加授权完成服务器两组 helper 精简。开始前重新记录两仓状态、暂存差异、已有文件哈希及本轮原始字节，证据保存在同一本机目录的 `round2/`。未改生产代码、测试场景、断言、收集入口或契约锁。

| 范围 | 处理结果与保留责任 |
| --- | --- |
| BS03 延伸：HTTP 请求 | **已实施，净减 173 行。**`management-auth`、`song-page-appearance`、`public-song-rate-limit`、`streamer-gift-api`、`gift-image-delivery` 和 `support/device-gift-{api,history}.cjs` 共七处复用既有 `support/http-client.cjs`，共享 helper 本身未改。Host、代理 IP、Cookie、Bearer、自定义 method/header 和管理请求 2 秒超时保留；严格 JSON、空串 `{}`、非 JSON 原文及管理请求的 null 回退仍由对应 wrapper 拥有。SSE 和子进程生命周期原样保留。 |
| 设备礼物账号初始化 | **已实施，净减 26 行。**两份 helper 的主播、许可证、设备、Session 插入及 JWT 构造归新增 68 行 `support/device-gift-seed.cjs`，显式传入数据库和测试 secret；删除的是同一初始化的第二份实现。API/history 各自保留 ID 前缀、runtime ID、设备名和返回结构，仍各自拥有临时目录、数据库激活与清理。其余礼物种子逻辑不相同，保留。 |
| 原始报文测试 | **核实后保留。**`production-domain-config`、`app-lifecycle`、`api-request-limit` 会发送故意损坏或原始 body；现有 HTTP helper 只负责可选 JSON，不为统一入口扩展配置或削弱这些输入。 |
| J01/J02 后续双端 JSON | **具体提交依赖保留。**`daily-bots-v1.json`、`fan-facts-v1.json`、`pk-report-settings.json` 共 137 行副本与服务器当前样例相同，但锁定提交尚无这三份文件；与 J01 一样，需真实服务器提交后再迁移锁及独立消费者。本轮不计这些潜在减少，也不放宽校验。 |

两组重叠的 helper 仅按路径计一次，并包含新增 seed 与未改动的共享 HTTP helper：**2,161 → 1,962 行，净减 199 行**。其中两份设备 helper 在 HTTP 整理后共 391 行，提取后连同新增 seed 共 365 行，实际净减 26 行，未沿用之前的估计。

| 全部 JS 测试与 helper | 初始 | 首轮后 | 本轮后 | 累计净减少 |
| --- | ---: | ---: | ---: | ---: |
| 客户端 | 94,972 | 93,862 | 93,862 | 1,110 |
| 服务器 | 65,284 | 64,783 | 64,584 | 700 |
| **合计** | **160,256** | **158,645** | **158,446** | **1,810** |

执行脚本仍共新增 167 行；包含脚本的累计 JS 净减少为 **1,643 行**。JSON 增减仍按第 10 节单独记录。本轮逐路径计数和两个阶段分别为 `round2/accounting.json`；首轮已有改动不算成本轮成果。

### 本轮实际验证

沿用第 10 节 `S(...)` 命令缩写，本轮增加 `--test-reporter=tap`。八个设备消费者为 `device-gift-events, device-gift-identity, fan-facts, gift-card-profiles, gift-display-profile, gift-effect-device, device-gift-history, device-gift-history-clear`。

| 命令与范围 | 修改前 | 修改后 |
| --- | --- | --- |
| S(management-auth, song-page-appearance, public-song-rate-limit, streamer-gift-api, gift-image-delivery，加上述八个设备消费者) | 70/70；3.654s | 70/70；3.652s |
| S(上述八个设备消费者)，单独验证账号种子提取 | 39/39；1.401s | 39/39；1.384s |
| `node --require ./test/support/test-mode.cjs <证据目录>/round2/verify-device-fixture.cjs <api或history> <before或after>`，两套 fixture 分进程运行 | 2/2；0.593s，保存实际 DB/JWT/返回值基线 | 2/2；0.764s，四张表身份/授权字段、JWT claim 集合和返回结构完全一致；签名算法/issuer/audience 与 1 小时测试 TTL 校验通过 |
| 八个修改/新增文件逐一 `node --check`，再 S(architecture-governance) | — | 语法通过，治理 9/9；合计 0.918s |
| 客户端 `npm run verify:docs` | — | 5/5；0.883s |

两个测试范围的场景名称集合均与基线一致，无新增 skip。39 个设备场景已包含在 70 个场景中，不能相加；仍覆盖租户隔离、认证、Session 撤销、SSE、历史 token 篡改/跨 principal、清理拒绝及其余独立消费者。种子 helper 不共享可变状态，也不模拟生产 verify 的签发流程；此次精简未改变既有人工测试 token 的用途。

本轮在 Windows / Node 24.15.0 执行；没有修改收集或 CI，未重复首轮的全套、浏览器和 Node 20 验证，不把首轮全量结果冒充本轮全量结果。上述耗时不用于宣称稳定性能收益。既有 Windows 查询、小游戏几何和安装器工具限制仍按第 10 节记录。

两批和收尾的 `git diff --check` 均通过，最终差异与 `git status --short` 已核对。除本轮八个服务器测试/helper 文件及客户端报告/计划外，开始时的文件内容、两仓暂存区与 HEAD 均保持不变；客户端最初 17 个既有修改也通过累计账本复核。工作树无本轮新增运行数据或敏感材料。
