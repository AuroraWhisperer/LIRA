# 测试策略

> 涉及文件:[package.json](../../../package.json)(测试与验证脚本)、[test/](../../../test)、[scripts/check-js.js](../../../scripts/check-js.js)、[scripts/inspect-wesing-playback.js](../../../scripts/inspect-wesing-playback.js)、[scripts/capture-bilibili-events.js](../../../scripts/capture-bilibili-events.js)、[scripts/bilibili-capture-electron/](../../../scripts/bilibili-capture-electron)

本文档是测试的**唯一事实源**:测试框架与命令、按领域的重点行为与测试入口、静态检查、专用诊断、辅助捕获脚本均只在此成表。构建/发布相关命令见 [build.md](build.md)。

## 1. 框架与命令

- **电音助手**：`test/admin/audio-assistant*.test.js` 覆盖入口与连续参数同步，`test/desktop/audio-assistant*.test.js` 覆盖 IPC 来源、输入授权、进程复用和退出。`npm run test:audio-native` 单独编译并验证迁入的 C# 音频核心与真实管道，依赖先完成本机音频资源构建；检查源码在 `test/desktop/audio-assistant-native/`，中间产物、合成数据和恢复状态均在 `tmp/`，不使用个人歌曲或路由记录。`InstallationExitChecks.cs` 启动真实隐藏 bridge/恢复进程，验证安装退出事件、延期记录跨进程接管，以及虚构端点恢复失败时保持运行；不修改实际音频设备。

- **框架**:Node 内置 `node:test` + `node:assert/strict`，测试运行器不依赖第三方框架；浏览器与 Electron 自动化使用开发依赖 Playwright（[package.json](../../../package.json)）。测试文件全部基于 `node:test`。
- **全量运行**:`npm test` 通过 [run-tests.js](../../../scripts/run-tests.js) 递归收集 `test/` 各业务目录中的 `*.test.js`，排除 `helpers/` 和 `fixtures/`，再运行 `node --experimental-vm-modules --test --test-concurrency=<默认 8>`。默认并发取 8 与可用 CPU 数的较小值；显式转发的 `--test-concurrency` **替换**该默认值，运行器不会同时传入两个同名参数。实测同一台 32 逻辑 CPU 发布机：desktop 与 browser 两组 158 秒（并发 4 为 227 秒、并发 12 为 169 秒且桌面组开始因负载丢失用例），且并发 8 下桌面组 0 失败；因此默认停在 8，不再上调。选中 Windows 原生进程归属测试时，先独立运行该文件，再并发执行其余文件，避免其他测试进程竞争原生查询的固定期限；各批分别输出统计，任一批失败都会使整体失败。helper 和探针仍由拥有者导入或显式启动；保留进程隔离，收集清单按文件名排序。
- **管理页回归**:`npm run test:admin` 固定运行 Admin 页面组合、前端行为和 AI 测试并显式启用 ESM VM 模块；前端测试辅助加载器使用 `vm.SourceTextModule` 保留真实 import/export、别名、只读导入绑定和模块作用域。直接运行这些测试也须传入 `--experimental-vm-modules`，缺少 flag 时明确报错，不再回退到剥离 import 的静态拼接。个别依赖通过 `vm.SyntheticModule` 提供显式 fixture，仍参与真实链接检查。
- **文档门禁**:`npm run verify:docs` 检查治理文件、相对链接、AI 路由表和规格索引。
- **原生卸载夹具**:`installer-uninstall.test.js` 通过独立就绪文件区分进程启动与删除执行；启动限时 30 秒，进入夹具后删除仍限时 10 秒。超时终止自己启动的进程，等待退出后再清理隔离目录；所有保留、删除、升级、链接及失败退出断言继续执行。
- **架构门禁**:`npm run verify:architecture` 运行模块边界、遗留债务预算、前端 ESM 边界与源码规模报告测试；行数本身不是硬门禁。模块依赖图覆盖 `src/` 和 `public/js/` 的静态 ESM 与可执行字面量 require/import，检查循环、领域向存储/传输/桌面的反向导入、shared 向上导入及已退役的 Admin 全局注册表。前端 ESM 门禁还将全部 `public/js/` 模块用真实 VM 链接，检查 import/re-export 的来源与导出是否存在，但不执行浏览器模块。计算路径和运行时回调仍需审查消费者与生命周期。
- **规模审查提示**:`npm run verify:modularity` 按文件类型报告物理行数，超过提示线不单独导致失败；职责与用途由正常变更审查判断，同一报告已接入架构和全量测试，口径见 [modularity-standard.md](../../architecture/engineering/modularity-standard.md#file-size-review)。
- **快速门禁**:`npm run verify:quick` 按文档 → 语法 → 架构顺序运行,用于日常评审前反馈。
- **契约输入门禁**:`npm run verify:contracts` 核对固定服务器提交和全部 fixture 的 SHA-256；不下载或切换检出目录。
- **完整门禁**:`npm run verify` 依次执行实时契约输入校验、JavaScript 语法检查和完整 `npm test`。全量测试本身已包含文档和三个架构测试，无需先运行 quick 重复检查；`verify:quick` 可独立调用。当前发布使用本地验证，环境与发布入口见 [build.md](build.md#本地发布验证)。
- **为什么需要 `--experimental-vm-modules`**:源码以 CJS(`require`)为主,但多个前端测试会通过 `vm.SourceTextModule` 或动态 `import()` 加载 `public/js/` 下的 ESM 模块;去掉该 flag 这些测试会失败。
- **单文件运行**:`node --experimental-vm-modules --test test/ai/ai-config-store.test.js`(flag 必须保留)。
- **测试方式**:以离线单元和集成测试为主,不访问真实外部网络;服务端模块直接 require 真实实现并注入临时 SQLite 目录或 mock,server smoke 类测试会在随机本地端口启动完整服务;浏览器模块用 vm + 假 `window`/`localStorage` 求值。

### 按运行依赖选择

周表模型/本机存储由 [weekly-schedule-model.test.js](../../../test/admin/weekly-schedule-model.test.js)、[weekly-schedule-storage.test.js](../../../test/admin/weekly-schedule-storage.test.js) 覆盖日期、模板隔离、清周保时、旧外观字段补齐、逐图效果复制隔离、读取失败保护与写入顺序；[weekly-schedule-export.test.js](../../../test/desktop/weekly-schedule-export.test.js) 覆盖导出来源、限额、外观及图像效果参数验证、特定合成错误的有限重试、取消及文件/窗口责任。[weekly-schedule-electron.test.js](../../../test/desktop/weekly-schedule-electron.test.js) 登记desktop组，使用实际preload、百宝箱导航、IndexedDB和导出controller，在隔离目录验证素材/模板重载、精确数值与恢复参数、切周/统一时间、新参数进入真实PNG渲染及导出点击快照；直接图片编辑流程覆盖缩放画布的拖动坐标、键盘微调、缩放/旋转与退出大屏后自动保存重载、不同图片效果隔离。四角像素检查覆盖初始小窗口和完整窗口，输出固定1920×1080。不启动业务主程序，不访问用户账号或数据。版式与完整操作的人工检查仍需在桌面完成，不能用尺寸断言代替可读性。

| 命令 | 实际依赖与边界 |
| --- | --- |
| `npm run test:offline` | Node/VM、临时 SQLite/HTTP；含使用合成 Git 仓库的契约校验器测试，无私有服务器读取依赖 |
| `npm run test:browser` | Chromium 组件测试及模拟 bridge；不替代 Electron 权限测试 |
| `npm run test:desktop` | Electron、原生 Windows TCP/进程查询及其显式子进程探针 |
| `npm run test:installer` | Windows/NSIS 安装器；保留已有工具检测，缺失导致的 skip 必须单列 |
| `npm run test:contracts` | 从锁定服务器检出读取 fixture 的消费者；包括完整密码兼容样例，UI/协议/HTTP 本地测试另留自主输入 |

五组互不重叠且合计等于 `npm test`。用 `node scripts/run-tests.js <组名或all> --list` 查看实际文件；新增使用浏览器、桌面或服务器 fixture 的测试需在执行器中登记，普通 Node 测试自动进入离线组。`run-tests.test.js` 还沿测试与共享 helper 的静态 `require` 检查 Playwright 和 Electron 依赖归组，直接依赖 `electron` 或使用 `shared-electron` 的用例归 desktop，防止遗漏登记后静默落入 offline。日常运行所属组和直接消费者；完整验证仍用 `npm run verify`。管理页定向入口包含浏览器组件，须先安装 Chromium：`npx playwright install chromium`。

林间花信外置包由 [woodland-style-package.test.js](../../../test/scenes/woodland-style-package.test.js) 覆盖真实 ZIP 检查/导入、原始素材哈希、重复导入及旧媒体 URL 的 Range/HEAD/移除兼容；[woodland-style-import-electron.test.js](../../../test/desktop/woodland-style-import-electron.test.js) 登记在 desktop 组，使用隔离 Electron 与真实文件导入链验证客户端设置、画布项默认 1920×1080、画布保存和重载。打包过滤仍由 [packaging-scope.test.js](../../../test/engineering/packaging-scope.test.js) 检查，并以实际构建 ASAR 确认依赖映射和制作素材确实排除。

### 按业务职责定位和运行

测试目录表达业务职责，运行分组表达环境依赖。同一业务的前端、后端和 IPC 测试放在一起；例如 `desktop/` 下的普通 Node 测试仍属于 `offline`，而 `engineering/build-integrity.test.js` 属于 `desktop` 运行组。保留原文件名，便于按模块名称搜索。

豆包会话的 Electron 测试夹具保持窗口隐藏，并拦截测试窗口的 `show()` / `focus()`，避免发布验证弹出页面或抢占焦点；真实会话、渲染器、加密存储与导航限制仍参与测试，不改变产品登录窗口行为。

| `test/` 下的目录 | 测试职责 |
| --- | --- |
| `admin/` | 管理页组合、状态、工作区、工具箱导航、主播计划和帮助 |
| `ai/` | AI 配置、模型、工具、生成、配额与送达 |
| `bilibili/` | B站协议、认证、直播状态、用户资料和事件解析 |
| `bots/` | 每日播报、签到、抽签和自定义回复 |
| `cloud-sync/` | 云端歌库、账号与运行状态同步 |
| `danmaku/` | 弹幕客户端、发送、缓冲、桌面预览与悬浮层 |
| `desktop/` | Electron 生命周期、桌面认证、数据路径、资源检查与更新 |
| `engineering/` | 测试执行器、语法、文档、架构、契约输入、构建与安装器 |
| `fan-profiles/` | 粉丝档案、合并、导入导出和同步 |
| `games/` | 小游戏、转盘与互动场次 |
| `dynamic-lottery/` | 动态抽奖采集、开奖、账号会话与界面 |
| `gifts/` | 礼物目录、历史、盲盒、投影、特效、同步和 PK 战报 |
| `license/` | 设备授权、激活、续期、协议与远端授权客户端 |
| `lyrics/` | 歌词解析、请求、发布、渲染与减少动态效果 |
| `music/` | 音乐平台认证、Provider、响应与媒体请求头 |
| `overlays/` | 跨悬浮层通信、开播画面和时钟 |
| `overtime/` | 加班机规则、结算、状态、编辑器与悬浮层 |
| `playback/` | 播放器状态、缓存、队列、音质和恢复 |
| `server/` | 服务启动、模块接线、会话、事件发布和本地访问边界 |
| `settings/` | 设置契约、初始化、资料与欢迎设置 |
| `shared/` | 日志脱敏和敏感字段识别 |
| `songs/` | 歌库、导入导出、点歌、排队、冷却和歌单展示 |
| `storage/` | 数据库初始化、维护、清空、迁移和查询 |
| `transport/` | HTTP、WebSocket、响应体和资源上限 |
| `ui/` | 通用 Toast、选择菜单、参数滑块、排版与界面约束 |
| `wesing/` | 全民 K 歌采集、缓存、歌词与诊断 |
| `helpers/`、`fixtures/` | 共享测试辅助模块、素材和由拥有者显式启动的探针 |

```powershell
npm test -- --help
npm run test:offline -- --domain=ai
npm run test:browser -- --domain=gifts
npm test -- --domain=gifts --domain=overtime --list
```

`--domain=<目录名>` 可重复传入；先取这些目录的并集，再与指定运行组求交集。不指定组时默认 `all`，不指定目录时保留整个运行组。`--list` 只列出文件；拼错目录或交集为空会报错，避免误跑全套或产生虚假的成功。其余 Node 参数继续转发，例如 `--test-name-pattern`、`--test-reporter`、`--test-concurrency`。

目录和依赖组用于定位，不要求局部修改运行整个领域。已知测试文件时，优先使用可重复的 `--file`；支持仓库根目录相对路径和加引号的通配符。多个文件选择取并集并去重，再与依赖组和 `--domain` 取交集。每个文件选择器都须命中已发现的测试，拼写错误和空交集会报错，不回退全量。

```powershell
# 歌库筛选只运行拥有者；盲盒页面只列出相关前端文件
npm test -- --file=test/songs/song-library-filter.test.js
npm test -- "--file=test/gifts/frontend-blindbox*.test.js" --list

# 历史记录 Node/VM 行为；拖选等真实浏览器交互单独选择
npm run test:offline -- "--file=test/gifts/frontend-gift-history*.test.js"
npm run test:browser -- --file=test/gifts/frontend-gift-history-selection.test.js

# 一个变更影响多个拥有者时显式合并，支持跨领域
npm test -- --file=test/gifts/frontend-blindbox-overlay.test.js --file=test/ui/frontend-toast-business.test.js
```

`--list` 只列清单，不启动测试。执行时显示 `File scope: full/partial` 和选中文件数，描述的是文件范围；Node 名称过滤、分片、skip 等仍须另行说明，不能称作完整验收。`--test-name-pattern` 只过滤所选文件内部的用例，不能代替 `--file`：未限定文件时，其他文件仍会加载并执行顶层初始化。

`npm run verify` 使用 `--require-full`：拒绝部分组/目录/文件、失败选择、名称/跳过筛选、`--test-only`、分片、仅列表和 watch 模式，也检查 `NODE_OPTIONS` 或 Node 启动参数继承的筛选；跳过、待办和取消用例不能作为完整通过。普通定向 `npm test` 保留筛选能力。所有运行都要求结构化结果可读且完整，完整验收还必须覆盖全部测试文件；子进程退出 0 不能掩盖结果缺失或损坏。

### 失败文件重跑与诊断记录

执行器默认只向终端输出约每 10 秒一次的事件进度、失败详情和最终汇总；显式 `--test-reporter=spec` 或其他 Node reporter 仍可使用。每批完整 spec 输出（含测试 stdout/stderr）自动写入 `tmp/test-results/run-*/batch-*.log`；启动时显示路径，无需额外重定向。完整日志写入失败同样使运行失败。

同目录 `results.json` 记录选中文件、实际文件结果、失败用例、文件耗时、总计数、开始/结束时间、总耗时及日志文件名；终端汇总用于快速判断，定位时按失败文件读取相应日志片段。`latest.json` 在运行开始时指向本次记录。并行启动的较早任务即使较晚结束，也不会覆盖新任务的指针。记录只用于诊断，不是可复用的通过凭证；`complete` 表示诊断记录完整，不代表全部通过，仍须检查退出码、失败与跳过计数。

```powershell
# 先查看最近一次运行的失败文件，再重跑这些文件
npm test -- --failed --list
npm test -- --failed
```

`--failed` 读取最新指针指向的运行，要求结果完整且有失败文件；没有记录、结果不完整、已全部通过或记录中的文件已不存在时会报错，不会回退到更早的失败结果或全量运行。失败文件仍与运行组、`--domain` 和 `--file` 取交集。它选择整个文件，原先的名称过滤等 Node 参数需按需重新传入。重跑会生成新记录；聚焦通过只证明这次选择的范围，不能替代发布验收或未解释的并发失败诊断。

### 按影响范围验证

选择器不自动推断源码依赖。修改共享资源、权限、存储或跨域接线时，按实际消费者补充文件；只调整普通页面样式时，按根 AGENTS 的 Small 工作流进行针对性检查，不默认启动领域全组、浏览器全组或完整发布验证。已通过且相关输入未变的检查不重复执行。

浏览器测试不因存放在 `admin/` 或 `scenes/` 而成为 offline；经 helper 间接启动 Chromium 的文件同样必须登记到 browser。同一文件的多个浏览器用例用 [shared-browser.js](../../../test/helpers/shared-browser.js) 共用一个 Chromium，每个用例使用独立 context；只在用例需要独立进程状态时自行启动浏览器。桌面测试统一经 [shared-electron.js](../../../test/helpers/shared-electron.js) 的 `launchElectron` 启动 Playwright 的 Electron 宿主：它在传给被测应用的进程环境里删除 `ELECTRON_RUN_AS_NODE`，该变量会让 Electron 以纯 Node 启动、握手永不完成，表现为整组桌面用例只报 `Process failed to launch!`。该变量只影响这一个被测进程，直接以 Node 方式启动 Electron 的测试（如 build-integrity）仍自行管理环境。contracts 组只放必须读取锁定服务器 fixture 的用例，同文件中不依赖 fixture 的用例拆到离线文件，避免被服务器检出版本锁住。历史报告与归档计划中的原始执行记录保留当时路径，可点击的本仓库测试链接更新为现位置。

并发运行的界面测试须区分页面导航、模块就绪和业务操作：Electron 窗口创建不代表 `/admin` 已加载；只验证重载后业务状态时，等待 `domcontentloaded` 后继续等待目标组件就绪，避免无关图片阻塞整页 `load`；需要检查图片时等待该图解码。画布发布前须等待组件自动尺寸回传到草稿，否则迟到的尺寸会形成真实的未保存修改；写入完成也不代表浏览器已收到发布完成通知，后续编辑须等画布恢复可操作。保存失败后的重试准备使用目标按钮的 `click({ trial: true })` 检查真实可操作性，避免在两次异步读取间把瞬时 `disabled` 快照当成稳定结果；继续保留失败、重试与发布结果断言。下载进度在合成下载暂停期间检查，随后放行下载；按绝对时间退场的动效使用受控时钟推进到实际截止点，保留延迟图片不重置期限的断言。等待明确状态，保留发布与草稿断言。

Windows 发布环境的隐藏 Electron 夹具使用 `offscreen: true`、`backgroundThrottling: false` 初始化渲染表面，保留真实 preload、IPC 与沙箱，无需显示测试窗口。三个交互夹具（自动回复编辑器、弹幕画布编辑器和到期设置）在 `app.whenReady()` 前关闭硬件加速，使用软件离屏渲染，避免多个隐藏 GPU 表面并发时的随机停顿；资源与媒体生命周期探针保留硬件加速，继续检查 WebGL 和 GPU 资源释放。仅关闭后台限流时，未初始化原生表面的隐藏窗口仍可能停在低帧率，导致操作稳定性、导航或媒体等待超时。动画像素回归先暂停入场，再等待字体和布局就绪，避免异步准备期间完整时间轴已经结束。不得以延长等待、降低整套并发或移除断言代替这些准备条件。

[资源生命周期探针](../../../test/fixtures/resource-lifecycle-probe.cjs) 在窗口、媒体和 WebSocket 释放断言完成后保留一个未发送请求的 HTTP 连接，验证测试服务器关闭时主动释放自己的连接；仅调用 `server.close()` 会等待这类预连接，导致探针迟迟不能写出结果。该清理不替代前面的应用资源释放断言。

两个原生认证探针（[账号竞态](../../../test/desktop/desktop-auth-race-electron.test.js)、[请求权限](../../../test/desktop/desktop-request-auth-electron.test.js)）使用仓库 `tmp/` 下的隔离目录；成功时正常退出 Electron，父测试等待子进程和管道关闭后再清理。异常清理同样先终止并等待进程，不能在进程仍持有目录时先删除文件。

[网页组件导入回归](../../../test/scenes/component-web-import.test.js) 同时注入包目录暂态锁和索引提交失败，分别统计重命名尝试与成功安装；允许安装前的锁重试，仍严格禁止索引提交失败后重放安装，并验证失败后无已安装或暂存包。

### 固定服务器契约输入

[server-contract.lock.json](../../../server-contract.lock.json) 声明服务器仓库、完整 commit SHA 和各份原始 fixture 的 SHA-256。服务器继续拥有协议和样例，客户端不保存副本。[verify-server-contract.js](../../../scripts/verify-server-contract.js) 在消费前核对提交和内容，错误提交、缺失或被改动的样例都会使检查失败，不能用同名目录掩盖版本差异。

目录选择顺序为显式路径、`LIRA_SERVER_ROOT`、已存在的相邻 `lira-server-contract`、相邻 `lira-server`。专用契约检出存在时仍须通过完整版本与哈希校验，损坏或过期不会退回开发工作区。下面在一个新的独立目录准备服务器，不切换正在开发的服务器工作区；读取私有仓库需要已有的 Git 只读权限。

```powershell
$contract = Get-Content -LiteralPath server-contract.lock.json -Raw | ConvertFrom-Json
git clone --no-checkout "https://github.com/$($contract.repository).git" ..\lira-server-contract
git -C ..\lira-server-contract checkout --detach $contract.revision
$env:LIRA_SERVER_ROOT = (Resolve-Path ..\lira-server-contract).Path
node scripts/verify-server-contract.js --runtime
npm ci
npm --prefix "$env:LIRA_SERVER_ROOT" ci
npm run verify
npm run verify:roundtrip
```

`--runtime` 还拒绝服务器 `src/`、`package.json`、`package-lock.json` 中已暂存、未暂存或未跟踪的变更，供加载真实服务器实现的联测使用。仅消费 fixture 的测试不因无关服务器文档修改失败。验证器不会自动拉取、修改或清理服务器文件；目录或版本不匹配时应另建检出或有意识地更新锁。

升级契约时，先确认服务器协议和实现已经提交且该提交可获取，再一起更新锁中的完整 SHA 和全部登记 fixture 的原始字节 SHA-256；服务器 `.gitattributes` 保证这些 JSON 使用 LF。随后运行完整门禁和往返检查，评审两端行为变化。不能只为消除失败而改成浮动分支、跳过哈希或复制工作区样例。

### 两仓歌库往返回归

[verify-song-roundtrip.cjs](../../../scripts/verify-song-roundtrip.cjs) 使用解析后的两仓绝对检出路径，在本机随机端口运行歌曲事务、内存 SQLite store 与 DTO，再由真实桌面 HTTP client 上传、回读。设备鉴权与路由接线使用测试 adapter，JSON parser 按该 revision 的 fixture 请求预算配置；真实设备路由的认证、解析器装配与 413 映射由服务端路由回归验证，不能把本检查当作生产认证或线上容量验收。两仓需先安装各自锁文件依赖；服务器的 `better-sqlite3` 必须匹配执行测试的 Node ABI。

```powershell
node scripts/verify-song-roundtrip.cjs D:\Work\Live D:\Work\lira-server
```

该检查独立于 `npm test`。`npm run verify:roundtrip` 使用当前客户端和上述服务器目录解析规则；原有两个显式绝对路径的调用方式继续有效。脚本在加载服务器模块前校验锁、fixture 和运行时工作区，再执行往返场景。开发联调可显式使用 `node scripts/verify-song-roundtrip.cjs --working-tree <客户端绝对路径> <服务端绝对路径>` 检查当前两仓实现，结果不能替代固定提交的发布契约验收。客户端完整测试也需要锁定的服务器 fixture；单仓的 `verify:quick` 和 `node --test test/engineering/server-contract.test.js` 不需要私有服务器检出。本地发布验证及访问配置见 [构建文档](build.md#本地发布验证)。

### Windows 安装器集成测试

数据保护用例同时核对已验证卸载器的同目录升级不执行复制，卸载器被替换或注册路径不匹配时回退；能力存在也不能绕过换目录、备份冲突或遗留音频保留。[更新管理回归](../../../test/desktop/update-manager.test.js) 用真实 NsisUpdater 和本地 HTTP 服务核对增量传输字节、已下载包离线复用、冷缓存/缺块图/Range 失败回退整包，以及摘要错误与离线失败不得进入可安装状态。

[安装目录测试](../../../test/engineering/installer-directory.test.js)验证默认目录、沿用旧路径、用户指定路径优先和无 D 盘的情况；[数据保护测试](../../../test/engineering/installer-migration.test.js)验证升级、换目录、旧数据迁回、备份恢复、冲突、复制/报告失败、文件占用、备份目录链接，以及升级清理时保留数据和下载文件；[自动关闭测试](../../../test/engineering/installer-app-exit.test.js)使用原生窗口及无窗口进程验证确认关闭、取消、拒绝关闭、超时重试、进程查询失败、静默退出与超时、无实例，以及其他目录同名程序和路径前缀相似程序的隔离，确认退出时的最后一次写入完整进入备份。音频助手夹具使用真实命名事件，覆盖旧/新目录、静默安装、其他目录/相似前缀隔离和旧版无事件超时；不运行用户安装或修改真实路由。

上述安装目录、数据保护、自动关闭，以及[卸载保留与清理测试](../../../test/engineering/installer-uninstall.test.js)需要 Windows 和 NSIS。[installer-tools.js](../../../test/helpers/installer-tools.js) 优先使用 `LIRA_TEST_MAKENSIS`（编译器）和 `LIRA_TEST_NSIS_PLUGINS`（包含 `StdUtils.dll`、`nsProcess.dll` 的 Unicode 插件目录）；未指定的路径从已有 electron-builder 缓存查找。缓存根目录采用 `ELECTRON_BUILDER_CACHE`，缺省为 `%LOCALAPPDATA%/electron-builder/Cache`，支持 `nsis-3.0.4.1`、`nsis-resources-3.4.1` 的平铺和嵌套解压目录。

发现过程只读，不下载工具或修改全局环境。显式配置的无效路径会使实际执行失败，不会被缓存覆盖；缺少工具或不在 Windows 时仍明确报告跳过。完整 Windows 验证前可检查工具；`verify` 已包含安装器测试，无需先单跑该组：

```powershell
node -e "const tools = require('./test/helpers/installer-tools').resolveInstallerTools(); if (!tools.compiler || !tools.plugins) throw new Error('Configure the NSIS compiler and Unicode plugins first'); console.log(tools)"
npm run verify
```

已有完整缓存时不再需要每次设置环境变量；显式覆盖只影响当前进程及其子进程。完整安装器分组应实际执行所有场景并报告 0 项跳过。

测试会编译并静默执行夹具程序，目录选择测试替换注册表读取，数据保护测试将 AppData、临时目录和安装目录重定向到隔离的临时目录；没有执行真实 LIRA 安装或读写用户数据库。此结果验证的是 NSIS 脚本场景，发布包的人工安装验收仍按 [构建文档](build.md)执行。

## 2. 重点行为与测试入口(按领域分组)

下表选取有代表性的测试，不是全量文件索引或代码覆盖率声明。完整发现结果使用 `node scripts/run-tests.js all --list`；发现规则与环境分组见 §1、[test/README.md](../../../test/README.md) 和 [run-tests.js](../../../scripts/run-tests.js)。

| 测试文件                                                                                                     | 被测模块                                                                                        | 覆盖文档                                                                                          |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **治理与架构**                                                                                               |                                                                                                 | [modularity-standard.md](../../architecture/engineering/modularity-standard.md) + [ai-workflow.md](../../architecture/engineering/ai-workflow.md)               |
| [run-tests.test.js](../../../test/engineering/run-tests.test.js) | 递归收集、依赖分组、目录筛选、辅助文件排除、进程隔离、参数转发和失败退出码 | 本文 §1 |
| [check-js.test.js](../../../test/engineering/check-js.test.js)                                                           | 语法检查的并发上限、完整扫描、失败退出与原生 CJS/ESM 语法行为                                   | 本文 §3                                                                                           |
| [server-contract.test.js](../../../test/engineering/server-contract.test.js) | 固定服务器版本、fixture 完整性、目录选择和运行时漂移拒绝；使用临时 Git 仓库 | 本文 §1 |
| [modularity-size.test.js](../../../test/engineering/modularity-size.test.js)                                             | 隔离夹具验证物理行计数、分类提示、未跟踪文件、非阻断 CLI 及静态内容边界；真实仓库报告用 `npm run verify:modularity` | [modularity-standard.md](../../architecture/engineering/modularity-standard.md) + [modularity-debt.md](../../architecture/engineering/modularity-debt.md)       |
| [governance-docs.test.js](../../../test/engineering/governance-docs.test.js)                                             | 治理文件、路由表、规格索引与范围内 Markdown 链接                                                | 同上 + [legacy-boundaries.md](../../architecture/engineering/legacy-boundaries.md)                                               |
| **AI 助手**                                                                                                  |                                                                                                 | [backend/ai.md](../backend/ai.md)                                                                 |
| [ai-api-quota-store.test.js](../../../test/ai/ai-api-quota-store.test.js)                                       | `ai/api-quota-store`(配额存储)                                                                  | 同上                                                                                              |
| [ai-config-store.test.js](../../../test/ai/ai-config-store.test.js)                                             | `ai/config-store`(配置存储)                                                                     | 同上                                                                                              |
| [ai-danmaku-delivery-verifier.test.js](../../../test/ai/ai-danmaku-delivery-verifier.test.js)                   | `ai/danmaku-delivery-verifier`(投递校验)                                                        | 同上                                                                                              |
| [ai-provider-adapters.test.js](../../../test/ai/ai-provider-adapters.test.js)                                   | DeepSeek Chat/Responses 请求协议与 Provider 预设                                                | 同上                                                                                              |
| [ai-provider-contracts.test.js](../../../test/ai/ai-provider-contracts.test.js)                                 | Provider 错误、追踪、模型列表与连接校验契约                                                     | 同上                                                                                              |
| [ai-tools.test.js](../../../test/ai/ai-tools.test.js)                                                           | 时间、天气配额、地图与联网搜索工具契约                                                                    | 同上                                                                                              |
| [ai-request-logger.test.js](../../../test/ai/ai-request-logger.test.js)                                         | `ai/request-logger`(请求日志)                                                                   | 同上                                                                                              |
| [ai-routes.test.js](../../../test/ai/ai-routes.test.js)                                                         | `server/routes/ai-routes`(API 路由)                                                             | 同上 + [backend/api.md](../backend/api.md)                                                        |
| [frontend-admin-ai.test.js](../../../test/ai/frontend-admin-ai.test.js)                                         | 前端不内置密钥、不可信文本不经 innerHTML                                                         | 同上 + [frontend/app.md](../frontend/app.md)                                                      |
| [frontend-admin-danmaku.test.js](../../../test/danmaku/frontend-admin-danmaku.test.js)                               | Admin 弹幕连接、发送与助手入口                                                                  | 同上 + [frontend/app.md](../frontend/app.md)                                                      |
| [frontend-admin-ai-settings.test.js](../../../test/ai/frontend-admin-ai-settings.test.js)                       | AI 配置自动保存、切换服务商时端点恢复与人设保留、密钥遮罩/保留/提交                                                   | 同上 + [frontend/app.md](../frontend/app.md)                                                      |
| [ai-assistant-service.test.js](../../../test/ai/ai-assistant-service.test.js)                                   | AI 触发、回复策略与本地安全                                                                     | 同上                                                                                              |
| [ai-assistant-delivery.test.js](../../../test/ai/ai-assistant-delivery.test.js)                                 | 顺序投递、分块节奏与房间回声重试                                                                | 同上                                                                                              |
| [ai-assistant-generation.test.js](../../../test/ai/ai-assistant-generation.test.js)                             | 生成预算、工具回合、复核阶段与官方聊天搜索                                                      | 同上                                                                                              |
| [ai-assistant-lifecycle.test.js](../../../test/ai/ai-assistant-lifecycle.test.js)                               | 关闭时中止直连 Provider 调用、排空与回复缓存失效                                                | 同上                                                                                              |
| **Bilibili 弹幕/协议**                                                                                       |                                                                                                 | [backend/bilibili/danmaku.md](../backend/bilibili/danmaku.md)                                     |
| [bilibili-danmaku-send.test.js](../../../test/bilibili/bilibili-danmaku-send.test.js)                                 | `bilibili/danmaku/api-client`(发弹幕)                                                           | 同上                                                                                              |
| [bilibili-identity-cache.test.js](../../../test/bilibili/bilibili-identity-cache.test.js)                             | `bilibili/danmaku/identity-cache`(身份缓存)                                                     | 同上                                                                                              |
| [bilibili-diagnostics.test.js](../../../test/bilibili/bilibili-diagnostics.test.js)                                   | `bilibili/bilibili-message-handler`(消息日志格式)                                               | 同上                                                                                              |
| [bilibili-runtime.test.js](../../../test/bilibili/bilibili-runtime.test.js)                                           | `server/bilibili-runtime` 的认证缓存、客户端替换与关闭所有权                                    | [backend/server-core.md](../backend/server-core.md)                                               |
| [bilibili-user-meta.test.js](../../../test/bilibili/bilibili-user-meta.test.js)                                       | `bilibili/utils/user-meta-extractor`(用户信息提取)                                              | 同上                                                                                              |
| [daily-bot-commands.test.js](../../../test/bots/daily-bot-commands.test.js)                                             | 签到/抽签参与弹幕命令过滤，区分命令与普通聊天                                                                | 同上                                                                                              |
| [daily-bot-takeover.test.js](../../../test/bots/daily-bot-takeover.test.js)、[daily-bot-frontend.test.js](../../../test/bots/daily-bot-frontend.test.js)、[daily-bot-editor-electron.test.js](../../../test/desktop/daily-bot-editor-electron.test.js) | 云端词库版本缓存、账号隔离、编辑/预览不请求、失败与并发草稿保留；隔离 Electron 验证正式 preload/IPC | [desktop/preload.md](../desktop/preload.md)、[frontend/app.md](../frontend/app.md) |
| [custom-reply-service.test.js](../../../test/bots/custom-reply-service.test.js)                                   | 自定义回复匹配、内置命令优先及云端独占接线；签到/抽签不在本地落库或回复                                                     | 同上                                                                                              |
| [danmaku-client.test.js](../../../test/danmaku/danmaku-client.test.js)                                               | `bilibili/danmaku-client`(主客户端)                                                             | 同上                                                                                              |
| [danmaku-sender-service.test.js](../../../test/danmaku/danmaku-sender-service.test.js)                               | `bilibili/danmaku/sender-service`(弹幕发送服务)                                                 | 同上                                                                                              |
| [message-deduplicator.test.js](../../../test/bilibili/message-deduplicator.test.js)                                   | `bilibili/danmaku/message-deduplicator`(去重)                                                   | 同上                                                                                              |
| [packet-decoder.test.js](../../../test/bilibili/packet-decoder.test.js)                                               | `bilibili/parsers/packet-decoder`(恶意/损坏数据包边界)                                          | [backend/bilibili/protocol.md](../backend/bilibili/protocol.md)                                   |
| [bilibili-websocket-connection.test.js](../../../test/bilibili/bilibili-websocket-connection.test.js)                                   | `bilibili/danmaku/websocket-connection`(WS 连接)                                                | 同上                                                                                              |
| **礼物**                                                                                                     |                                                                                                 | [backend/bilibili/gift.md](../backend/bilibili/gift.md)                                           |
| [capture-bilibili-events.test.js](../../../test/bilibili/capture-bilibili-events.test.js)                             | `scripts/capture-bilibili-events`(捕获工具,见 §5)                                               | 同上                                                                                              |
| [gift-analysis-service.test.js](../../../test/gifts/gift-analysis-service.test.js)                                 | 盲盒统计、筛选与分页（固定本地日期）                                                            | 同上                                                                                              |
| [gift-audit-page.test.js](../../../test/gifts/gift-audit-page.test.js)                                             | 礼物审计页离线解析与比对（匹配、漏记、仅服务端）                                                 | 同上 + [frontend/pages.md](../frontend/pages.md)                                                  |
| [gift-projection-service.test.js](../../../test/gifts/gift-projection-service.test.js)                             | `bilibili/gift`(服务器结果投影与消费者重试)                                                     | 同上                                                                                              |
| [gift-diagnostics-wiring.test.js](../../../test/gifts/gift-diagnostics-wiring.test.js)                             | preload 礼物展示兼容通道（主窗口来源）与服务端礼物入口不写第二本地账本                            | 同上 + [desktop/main.md](../desktop/main.md)                                                      |
| [gift-effect-config.test.js](../../../test/gifts/gift-effect-config.test.js)                                       | 礼物特效配置拉取、缓存、URL 信任边界与事件构造                                                  | 同上                                                                                              |
| [gift-effects-overlay.test.js](../../../test/gifts/gift-effects-overlay.test.js)                                   | 礼物特效 API、管理工具、透明直播叠加层与其重连策略                                                         | 同上 + [frontend/overlays.md](../frontend/overlays.md)                                            |
| [bilibili-superchat.test.js](../../../test/bilibili/bilibili-superchat.test.js)                               | `bilibili/danmaku/message-handlers`(SC 接收、解析与日志)                                                    | 同上                                                                                              |
| [bilibili-likes.test.js](../../../test/bilibili/bilibili-likes.test.js) + [bilibili-likes-api.test.js](../../../test/server/bilibili-likes-api.test.js) | 客户端点赞总数覆盖、连接/开下播清理、两层 API context 与本机管理读取授权；房间替换由 `bilibili-runtime.test.js` 覆盖 | [backend/bilibili/danmaku.md](../backend/bilibili/danmaku.md) + [backend/api.md](../backend/api.md) |
| [bilibili-gift-identity-hints.test.js](../../../test/bilibili/bilibili-gift-identity-hints.test.js)                   | `bilibili/users/gift-identity-hints`(发送者与舰队身份提示)                                      | 同上                                                                                              |
| [gift-query-service.test.js](../../../test/gifts/gift-query-service.test.js)                                       | 礼物历史查询、搜索、排序、游标分页与来源边界                                                    | 同上 + [backend/storage.md](../backend/storage.md)                                                |
| [gift-statistics-service.test.js](../../../test/gifts/gift-statistics-service.test.js)                             | 礼物金额、指标、月份分桶与聚合失败                                                              | 同上 + [backend/storage.md](../backend/storage.md)                                                |
| [processed-gift-import.test.js](../../../test/gifts/processed-gift-import.test.js)                                 | 已处理礼物的历史与实时投影消费者、捕获来源与传输隐私（离线）                                    | 同上 + [backend/storage.md](../backend/storage.md)                                                |
| [processed-gift-import-atomicity.test.js](../../../test/gifts/processed-gift-import-atomicity.test.js)             | 暂停、清空代次与完整重放回滚                                                                    | 同上 + [backend/storage.md](../backend/storage.md)                                                |
| [processed-gift-contract.test.js](../../../test/gifts/processed-gift-contract.test.js)                             | 服务器样例：规范化、分页 wire 契约、协商身份重新绑定与盲盒产物                                  | 同上                                                                                              |
| [remote-catalog-cache.test.js](../../../test/gifts/remote-catalog-cache.test.js)                                   | 远端目录缓存、ETag、关系/替换保留、32 MiB 容量、落盘回退与停止生命周期                          | 同上                                                                                              |
| [remote-catalog-contract.test.js](../../../test/gifts/remote-catalog-contract.test.js)                             | 远端目录 v2 规范化、图片来源与布尔契约                                                          | 同上                                                                                              |
| [hybrid-gift-catalog.test.js](../../../test/gifts/hybrid-gift-catalog.test.js)                                     | 房间优先合并、关系过滤与服务不可用搜索                                                          | 同上                                                                                              |
| [remote-gift-controller.test.js](../../../test/gifts/remote-gift-controller.test.js)                               | 远端礼物 bootstrap、历史能力、代次与游标校验                                                    | 同上 + [desktop/main.md](../desktop/main.md)                                                      |
| [remote-gift-controller-sse.test.js](../../../test/gifts/remote-gift-controller-sse.test.js)                       | SSE 关闭、发现重试、即时投影、wire 校验与顺序补拉                                               | 同上 + [desktop/main.md](../desktop/main.md)                                                      |
| [remote-gift-controller-reconciliation.test.js](../../../test/gifts/remote-gift-controller-reconciliation.test.js) | 静默补拉、停止/授权失效、退避与在途隔离                                                         | 同上 + [desktop/main.md](../desktop/main.md)                                                      |
| **音乐服务**                                                                                                 |                                                                                                 | [backend/music/services.md](../backend/music/services.md)                                         |
| [lyrics.test.js](../../../test/lyrics/lyrics.test.js)                                                               | `music/lyric-parser`(歌词解析)                                                                        | 同上                                                                                              |
| [netease-provider.test.js](../../../test/music/netease-provider.test.js)                                           | `music/providers/netease-provider`                                                              | [backend/music/netease.md](../backend/music/netease-provider.md)                                  |
| [qq-provider.test.js](../../../test/music/qq-provider.test.js)                                                     | `music/providers/qq-provider`(歌单、电台与最近播放)                                             | [backend/music/qq.md](../backend/music/qq-provider.md)                                            |
| [qq-provider-streams.test.js](../../../test/music/qq-provider-streams.test.js)                                     | `music/providers/qq-provider-streams`(播放权益、音质与歌词)                                     | 同上                                                                                              |
| [music-stream-route.test.js](../../../test/music/music-stream-route.test.js)                                       | `server/routes/music-routes`(播放地址令牌与错误映射)                                            | 同上                                                                                              |
| [song-cooldown.test.js](../../../test/songs/song-cooldown.test.js) | 单首歌曲冷却、北京时间跨日、原子写入、账号隔离、随机过滤与回复 | 同上(music-services) |
| [queue-service.test.js](../../../test/songs/queue-service.test.js)                                                 | `music/queue-service`(点歌队列)                                                                 | 同上(music-services)                                                                              |
| [random-song-filter.test.js](../../../test/songs/random-song-filter.test.js)                                       | `music/random-song-filter`(随机筛选)                                                            | 同上                                                                                              |
| [song-file-codec.test.js](../../../test/songs/song-file-codec.test.js)                                             | `music/song-file-codec`(文件编码)                                                               | 同上                                                                                              |
| [song-request-autocomplete.test.js](../../../test/songs/song-request-autocomplete.test.js)                         | `music/song-service`(歌单补全)                                                                  | 同上                                                                                              |
| [tag-aliases.test.js](../../../test/songs/tag-aliases.test.js)                                                     | `music/tag-aliases`(标签别名)                                                                   | 同上                                                                                              |
| **全民 K 歌**                                                                                                |                                                                                                 | [backend/music/wesing.md](../backend/music/wesing.md)                                             |
| [wesing-native-audio.test.js](../../../test/wesing/wesing-native-audio.test.js) | Windows 原生合成多设备/会话、进程过滤、活跃状态合并、故障隔离；不访问真实播放器 | 同上 |
| [wesing-diagnostics.test.js](../../../test/wesing/wesing-diagnostics.test.js) / [playback-wesing-diagnostics.test.js](../../../test/playback/playback-wesing-diagnostics.test.js) | 按需诊断的有界采样、状态分类、停止清理、字段白名单，以及界面请求去重、主动保存到日志目录、过期报告拒绝、不覆盖和失败重试 | 同上 |
| [wesing-capture.test.js](../../../test/wesing/wesing-capture.test.js)                                               | 采集门面、本地日志/QRC 解码与缓存目录                                                           | 同上                                                                                              |
| [wesing-capture-timing.test.js](../../../test/wesing/wesing-capture-timing.test.js)                                 | 激活、进度门控、暂停、校准、重载与监控错误时序                                                  | 同上                                                                                              |
| [wesing-capture-refresh.test.js](../../../test/wesing/wesing-capture-refresh.test.js)                               | 在线回退与退避、延迟 QRC、缓存迁移和歌词偏移；不验证原生窗口探测与音频采集                         | 同上                                                                                              |
| [wesing-capture-recording-mode.test.js](../../../test/wesing/wesing-capture-recording-mode.test.js)                 | `music/wesing-capture`(录制模式)                                                                | 同上                                                                                              |
| [wesing-online-lyrics.test.js](../../../test/wesing/wesing-online-lyrics.test.js)                                   | `music/wesing-online-lyrics`(在线歌词)                                                          | 同上                                                                                              |
| [wesing-playback-diagnostic.test.js](../../../test/wesing/wesing-playback-diagnostic.test.js)                       | `scripts/inspect-wesing-playback`(诊断脚本,见 §4)                                               | 同上                                                                                              |
| [wesing-routes.test.js](../../../test/wesing/wesing-routes.test.js)                                                 | `server/routes`(wesing API 路由)                                                                | 同上 + [backend/api.md](../backend/api.md)                                                        |
| **加班机**                                                                                                   |                                                                                                 | [backend/overtime.md](../backend/overtime.md)                                                     |
| [overtime-service.test.js](../../../test/overtime/overtime-service.test.js)                                           | 加班机 schema 迁移与恢复暂停/重载                                                               | 同上                                                                                              |
| [overtime-state.test.js](../../../test/overtime/overtime-state.test.js)                                               | 单调计时、重启与状态校验                                                                        | 同上                                                                                              |
| [overtime-state-failures.test.js](../../../test/overtime/overtime-state-failures.test.js)                             | 状态动作保存失败矩阵                                                                            | 同上                                                                                              |
| [overtime-rules.test.js](../../../test/overtime/overtime-rules.test.js)                                               | 固定、分组、单项、随机与效果规则                                                                | 同上                                                                                              |
| [overtime-settlement.test.js](../../../test/overtime/overtime-settlement.test.js)                                     | 待结算代次、补偿、回滚/重试、清空与身份重放                                                     | 同上                                                                                              |
| [frontend-overtime.test.js](../../../test/overtime/frontend-overtime.test.js)                                         | Admin 加班机控制台与规则编辑器                                                                  | 同上 + [frontend/app.md](../frontend/app.md)                                                      |
| [overtime-routes.test.js](../../../test/overtime/overtime-routes.test.js)                                             | `server/routes`(加班机 API)                                                                     | 同上 + [backend/api.md](../backend/api.md)                                                        |
| [overtime-gift-picker.test.js](../../../test/overtime/overtime-gift-picker.test.js)                                   | 加班机选礼器身份、搜索与选择行为                                                                | 同上 + [frontend/app.md](../frontend/app.md)                                                      |
| [overtime-gift-picker-contract.test.js](../../../test/overtime/overtime-gift-picker-contract.test.js)                                 | 加班机选礼器角色与同 ID 身份(服务器 fixture)                                                          | 同上 + [frontend/app.md](../frontend/app.md)                                                      |
| [overtime-rule-editor.test.js](../../../test/overtime/overtime-rule-editor.test.js)                                   | 加班机礼物规则编辑器模块边界                                                                    | 同上 + [frontend/app.md](../frontend/app.md)                                                      |
| [overtime-overlay.test.js](../../../test/overtime/overtime-overlay.test.js)                                           | `public/pages/overlays/overtime.html`+js/css(叠加层)                                            | 同上 + [frontend/pages.md](../frontend/pages.md)                                                  |
| [overtime-overlay-runtime.test.js](../../../test/overtime/overtime-overlay-runtime.test.js)                                         | 叠加层规则说明与按显示边界刷新的时钟(浏览器)                                       | 同上 + [frontend/pages.md](../frontend/pages.md)                                                  |
| [overtime-status-view.test.js](../../../test/overtime/overtime-status-view.test.js) | 管理页时钟按显示边界刷新，加减时、暂停、隐藏恢复及跨天 | [frontend/app.md](../frontend/app.md) |
| **服务器核心**                                                                                               |                                                                                                 | [backend/server-core.md](../backend/server-core.md)                                               |
| [admin-page-composition.test.js](../../../test/admin/admin-page-composition.test.js)                               | Admin HTML 分片组合顺序、完整性及禁止向页面注入管理 token                                                    | 同上 + [frontend/pages.md](../frontend/pages.md)                                                  |
| [server-lifecycle.test.js](../../../test/server/server-lifecycle.test.js)                                           | `server/lifecycle`(端口/生命周期)                                                               | 同上                                                                                              |
| [server-modules.test.js](../../../test/server/server-modules.test.js)                                               | 服务兼容层与 API Context 模块边界                                                               | 同上                                                                                              |
| [server-smoke.test.js](../../../test/server/server-smoke.test.js)                                                   | `src/server`(端到端冒烟)                                                                        | 同上 + [backend/api.md](../backend/api.md)                                                        |
| [module-boundaries.test.js](../../../test/engineering/module-boundaries.test.js)                                         | 持久化、Admin、播放、叠加层连接、组合根和 shared 工具的架构适应度函数                                       | [modularity-standard.md](../../architecture/engineering/modularity-standard.md)                                                  |
| [websocket-transport.test.js](../../../test/transport/websocket-transport.test.js)                                     | `server/ws`(WS 传输)                                                                            | [backend/ws.md](../backend/ws.md)                                                                 |
| **桌面层**                                                                                                   |                                                                                                 | 见各列                                                                                            |
| [bilibili-login-window.test.js](../../../test/bilibili/bilibili-login-window.test.js)                                 | `electron/bilibili-login-window`(登录窗口)                                                      | [desktop/auth.md](../desktop/auth.md)                                                             |
| [bilibili-startup-wiring.test.js](../../../test/bilibili/bilibili-startup-wiring.test.js)                             | `electron/cloud-sync-controller`(取消登录不上传，登录成功上传凭据)                              | [desktop/main.md](../desktop/main.md)                                                         |
| [desktop-lyrics.test.js](../../../test/lyrics/desktop-lyrics.test.js)                                               | 桌面歌词浏览器源状态与时间轴规范化                                                              | [frontend/playback.md](../frontend/playback.md) + [frontend/overlays.md](../frontend/overlays.md) |
| [desktop-lyric-settings.test.js](../../../test/lyrics/desktop-lyric-settings.test.js)                               | 歌词比例控件换算与颜色透明度应用                                                                | [frontend/app.md](../frontend/app.md) + [frontend/overlays.md](../frontend/overlays.md)           |
| [desktop-lyric-settings-runtime.test.js](../../../test/lyrics/desktop-lyric-settings-runtime.test.js)               | 字体权限、设置预览与自动保存                                                                    | 同上                                                                                              |
| [desktop-lyric-fonts-browser.test.js](../../../test/lyrics/desktop-lyric-fonts-browser.test.js)                     | 多语言字体实际命中、常规/加粗补字与离线按需加载                                                  | 同上                                                                                              |
| [desktop-lyric-layout-browser.test.js](../../../test/lyrics/desktop-lyric-layout-browser.test.js)                   | 用户选定对齐、逐字高亮及独立颜色设置的应用                                                      | 同上                                                                                              |
| [desktop-lyric-publication.test.js](../../../test/lyrics/desktop-lyric-publication.test.js)                         | 授权发布、顺序、调度器与共享时钟                                                                | [frontend/playback.md](../frontend/playback.md) + [frontend/overlays.md](../frontend/overlays.md) |
| [desktop-lyric-renderer.test.js](../../../test/lyrics/desktop-lyric-renderer.test.js)                               | 当前行、卡拉 OK 模式、连写文字完整性、隐藏时不重启动画与可见行渲染                                | 同上                                                                                              |
| [license-manager-operations.test.js](../../../test/license/license-manager-operations.test.js)                       | 歌曲、背景、目录、礼物与渲染器边界的受保护操作                                                  | 同上                                                                                              |
| [license-manager-renewal.test.js](../../../test/license/license-manager-renewal.test.js)                             | 授权 bootstrap、续期、撤销、心跳与暂时性受保护失败                                                              | 同上                                                                                              |
| [license-manager-revalidation.test.js](../../../test/license/license-manager-revalidation.test.js)                   | 云读取、共享重验证、代次、销毁与挑战竞态                                                        | 同上                                                                                              |
| [license-manager-identity.test.js](../../../test/license/license-manager-identity.test.js)                           | 跨账号迟到请求、ABA 切换、续期与心跳生命周期隔离                                                | 同上                                                                                              |
| [remote-license-client.test.js](../../../test/license/remote-license-client.test.js)                                 | 远端授权 HTTP 请求、错误与脱敏契约                                                              | [desktop/auth.md](../desktop/auth.md)                                                             |
| [remote-license-response-budget.test.js](../../../test/license/remote-license-response-budget.test.js)                       | 远端响应体预算与歌库 8 MiB 精确字节边界、UTF-8、超限流取消与不可重试错误                                        | 本文 §1 两仓歌库往返回归                                                                          |
| [remote-license-event-stream.test.js](../../../test/license/remote-license-event-stream.test.js)                     | 远端授权 SSE 分块、取消与 reader 释放                                                           | 同上                                                                                              |
| [desktop-resource-integrity.test.js](../../../test/desktop/desktop-resource-integrity.test.js)                                                 | 资源完整性 IPC 的窗口、来源与路径门禁                                                                   | [desktop/main.md](../desktop/main.md)                                                             |
| [desktop-update-controller.test.js](../../../test/desktop/desktop-update-controller.test.js)                                                 | 自动更新设置读取、状态推送、错误与安装前排空                                                                   | [desktop/main.md](../desktop/main.md)                                                             |
| [electron-main-modules.test.js](../../../test/desktop/electron-main-modules.test.js)                                 | Electron runtime 适配、本地字体权限、safeStorage 注入与礼物同步装配                                 | [desktop/main.md](../desktop/main.md)                                                             |
| [local-media-access.test.js](../../../test/desktop/local-media-access.test.js)                                       | `electron/local-media-access`(local-media:// 协议授权与字节范围)                                              | [desktop/main.md](../desktop/main.md)                                                             |
| [playback-flush.test.js](../../../test/playback/playback-flush.test.js)                                               | `electron/playback-flush`(播放状态落盘)                                                         | [backend/storage.md](../backend/storage.md) + [desktop/main.md](../desktop/main.md)               |
| [terminal-log.test.js](../../../test/desktop/terminal-log.test.js)                                                   | `electron/terminal-log`(终端日志)                                                               | [desktop/main.md](../desktop/main.md)                                                             |
| [update-manager.test.js](../../../test/desktop/update-manager.test.js)                                               | `electron/update-manager`(自动更新)                                                             | [desktop/update.md](../desktop/update.md)                                                         |
| **存储**                                                                                                     |                                                                                                 | [backend/storage.md](../backend/storage.md)                                                       |
| [cooldown-store.test.js](../../../test/songs/cooldown-store.test.js)                                               | 冷却 Map 的过期剪枝                                                                             | 同上                                                                                              |
| [database-maintenance.test.js](../../../test/storage/database-maintenance.test.js)                                   | 歌库/礼物库旧版本迁移、v3→v4 投影列与身份去重、初始化失败释放句柄                               | 同上                                                                                              |
| [playback-snapshot-ordering.test.js](../../../test/playback/playback-snapshot-ordering.test.js)                       | `storage/playback-store`(播放快照顺序、写入者代次与播放历史)                                    | 同上                                                                                              |
| [superchat-store.test.js](../../../test/gifts/superchat-store.test.js)                                             | `storage/superchat-store` 的 SQLite 映射与领域对象契约                                          | 同上                                                                                              |
| **前端**                                                                                                     |                                                                                                 | 见各列                                                                                            |
| [esm-module-boundaries.test.js](../../../test/engineering/esm-module-boundaries.test.js)                                 | `public/js/` ESM 未声明标识符审计及全部模块的真实 import/re-export 链接检查                        | [frontend/app.md](../frontend/app.md)                                                             |
| [frontend-admin-toolbox.test.js](../../../test/admin/frontend-admin-toolbox.test.js)                               | 硬件指标不可用与零负载显示、桌面更新入口                                                         | 同上                                                                                              |
| [frontend-usage-guide-search-browser.test.js](../../../test/admin/frontend-usage-guide-search-browser.test.js) | 最小片段验证正文定位、折叠内容展开与高亮清理；实际指南验证内部链接唯一目标 | [frontend/pages.md](../frontend/pages.md) |
| [text-box-editor.test.js](../../../test/admin/text-box-editor.test.js)、[text-box-electron.test.js](../../../test/desktop/text-box-electron.test.js) | 浏览器负责连续格式切换与 DOM 不累积；Electron 验证真实输入、撤销、保存发布和重开 | [frontend/pages.md](../frontend/pages.md) |
| [frontend-admin-runtime.test.js](../../../test/admin/frontend-admin-runtime.test.js)                               | 异步主题数据加载与表单编辑保护                                                                  | 同上                                                                                              |
| [frontend-parameter-range.test.js](../../../test/ui/frontend-parameter-range.test.js) | 通用滑块值映射、指针操作、重复绑定与监听/观察释放 | [frontend/app.md](../frontend/app.md) |
| [frontend-gifts.test.js](../../../test/gifts/frontend-gifts.test.js)                                               | 礼物工作区与摘要契约                                                                            | [frontend/app.md](../frontend/app.md)                                                             |
| [frontend-gift-history.test.js](../../../test/gifts/frontend-gift-history.test.js)                                 | 礼物历史抽屉、查询、排序与分页 UI                                                               | 同上                                                                                              |
| [frontend-blindbox-admin.test.js](../../../test/gifts/frontend-blindbox-admin.test.js)                             | 盲盒管理与配置 UI                                                                               | 同上                                                                                              |
| [frontend-blindbox-mapping-state.test.js](../../../test/gifts/frontend-blindbox-mapping-state.test.js)             | 盲盒映射状态与本地编辑                                                                          | 同上                                                                                              |
| [frontend-blindbox-mapping-refresh.test.js](../../../test/gifts/frontend-blindbox-mapping-refresh.test.js)         | 盲盒映射刷新与目录更新                                                                          | 同上                                                                                              |
| [frontend-blindbox-overlay.test.js](../../../test/gifts/frontend-blindbox-overlay.test.js)                         | 盲盒 浏览器源渲染                                                                                   | [frontend/overlays.md](../frontend/overlays.md)                                                   |
| [frontend-recent-gifts.test.js](../../../test/gifts/frontend-recent-gifts.test.js)                                 | 近期礼物卡片、图像与目录事件                                                                    | [frontend/app.md](../frontend/app.md)                                                             |
| [frontend-playback.test.js](../../../test/playback/frontend-playback.test.js)                                         | 全屏歌词、收藏分页与播放搜索竞态                                                                | [frontend/playback.md](../frontend/playback.md)                                                   |
| [frontend-queue.test.js](../../../test/songs/frontend-queue.test.js)                                               | 队列设置、持久化排版、尺寸与所选样式                                                            | [frontend/overlays.md](../frontend/overlays.md)                                                   |
| [frontend-queue-scrolling.test.js](../../../test/songs/frontend-queue-scrolling.test.js)                           | 队列实际溢出触发滚动与循环副本清理                                                              | 同上                                                                                              |
| [danmaku-overlay.test.js](../../../test/danmaku/danmaku-overlay.test.js)                                             | 固定弹幕整合与连接状态                                                                          | 同上                                                                                              |
| [danmaku-feed-motion.test.js](../../../test/danmaku/danmaku-feed-motion.test.js) | 固定弹幕公共 feed 不变量：续接与打断不瞬移、行不重叠、淘汰保留边界行、快照不重播入场、减少动态效果与销毁清理；逐款观感由实际播放验收 | [固定弹幕动效](../frontend/danmaku-motion.md) |
| [danmaku-glowy-browser.test.js](../../../test/danmaku/danmaku-glowy-browser.test.js)、[danmaku-neon-glass-browser.test.js](../../../test/danmaku/danmaku-neon-glass-browser.test.js) | 两款弹幕在实际浏览器中的入场、排列、公共透视、配置更新及 SC 撤回；登记在 browser 运行组 | [固定弹幕动效](../frontend/danmaku-motion.md) |
| [danmaku-overlay-renderer.test.js](../../../test/danmaku/danmaku-overlay-renderer.test.js)                           | 排名视口、共享表情渲染与固定流裁剪                                                              | 同上                                                                                              |
| [danmaku-overlay-fullscreen.test.js](../../../test/danmaku/danmaku-overlay-fullscreen.test.js)                       | 全屏随机位置、计时、预览与时间戳                                                                | 同上                                                                                              |
| [opening-overlay.test.js](../../../test/overlays/opening-overlay.test.js)                                             | 开场动画管理设置与 直播画面展示                                                                     | 同上                                                                                              |
| [opening-upload-api.test.js](../../../test/overlays/opening-upload-api.test.js)                                       | 开场媒体上传、鉴权与静态提供                                                                    | 同上 + [backend/api.md](../backend/api.md)                                                        |
| [frontend-song-board.test.js](../../../test/songs/frontend-song-board.test.js)                                     | 歌单展示板字号、视口与滚动速度                                                                  | [frontend/pages.md](../frontend/pages.md)                                                         |
| [playback-cache.test.js](../../../test/playback/playback-cache.test.js)                                               | `public/js`(个人歌单缓存 CacheManager)                                                          | [frontend/playback.md](../frontend/playback.md)                                                   |
| [playback-persistence.test.js](../../../test/playback/playback-persistence.test.js)                                   | 播放队列、进度、Provider 与关闭刷新持久化                                                       | 同上 + [backend/storage.md](../backend/storage.md)                                                |
| [playback-provider-operations.test.js](../../../test/playback/playback-provider-operations.test.js)                   | Provider 操作的选中音源语义                                                                     | 同上                                                                                              |
| [playback-queue-behavior.test.js](../../../test/playback/playback-queue-behavior.test.js)                             | 歌单、电台、搜索直播与历史队列行为                                                              | 同上                                                                                              |
| [playback-wesing.test.js](../../../test/playback/playback-wesing.test.js)                                             | `public/js`(播放器全民 K 歌集成)                                                                | 同上                                                                                              |
| [provider-manager.test.js](../../../test/playback/provider-manager.test.js)                                           | `public/js`(Provider 状态管理)                                                                  | [frontend/pages.md](../frontend/pages.md)                                                         |
| [queue-overlay-esm.test.js](../../../test/songs/queue-overlay-esm.test.js)                                         | 队列叠加层真实 ESM 依赖图与渲染路径                                                             | [frontend/overlays.md](../frontend/overlays.md)                                                   |
| [queue-overlay-responsive.test.js](../../../test/songs/queue-overlay-responsive.test.js)                           | 经典样式行溢出时滚动、未溢出时不复制行                                                          | 同上                                                                                              |
| [song-library-filter.test.js](../../../test/songs/song-library-filter.test.js)                                     | 歌单筛选界面与 `music/song-service`、`storage/song-store`；查询使用真实内存 SQLite                                                      | 同上 + [backend/storage.md](../backend/storage.md)                                                |
| [toolbox-sidebar-preferences.test.js](../../../test/admin/toolbox-sidebar-preferences.test.js)                     | 侧栏持久偏好恢复与旧缓存迁移                                                                    | 同上                                                                                              |
| [toolbox-sidebar-routing.test.js](../../../test/admin/toolbox-sidebar-routing.test.js)                             | 导航接线与折叠分组偏好持久化                                                                    | 同上                                                                                              |
| [streamer-planner.test.js](../../../test/admin/streamer-planner.test.js)                                                   | `public/js`(工具箱待办)                                                                         | 同上                                                                                              |

## 3. 静态检查:npm run check

- 命令:`npm run check` → `node scripts/check-js.js`（[package.json](../../../package.json) 的 `scripts.check`）。
- 行为:[check-js.js](../../../scripts/check-js.js) 递归收集 `src/`、`public/`、`scripts/`、`test/`、`tools/` 下全部 `.js`、`.cjs`、`.mjs` 文件，逐文件比较内容、最近包的模块解析配置、实际 Node 和 checker 实现，仅对缺少有效证明的文件执行原生 `node --check`。最多 4 个子进程，并发数同时受可用 CPU 数和文件数限制。应用版本号变化不单独使语法结果失效；模块类型、包边界或文件变化仍重查。失败后停止分配新文件并等待已启动检查，返回非零；输入在检查期间变化不登记成功。
- `npm run check -- --plan` 只列出待运行文件，`npm run check -- --force` 强制重查并先撤销旧记录。执行输出运行、复用与总文件数，新增文件自动纳入，已删除文件不再计入覆盖。记录和互斥锁位于仓库 `tmp/verification/`，损坏记录按未验证处理；拒绝 `NODE_OPTIONS` 和父进程 Node flags。异常退出后先确认锁中 PID 已停止，再移除该锁。
- 边界:**仅查语法**,不做类型检查、模块导入一致性或风格检查(旧文档的描述不准确)。
- 日常按根 [AGENTS.md](../../../AGENTS.md) 的风险分级选择验证：小改动只检查相关文件或运行一次针对性界面验证；单个功能运行自身及直接受影响的测试；跨领域或关键边界变化运行相关完整门禁。`npm run verify:quick` 和 `npm run verify` 仍执行各自完整范围，发布遵循 [RELEASE_GUIDE.md](../../../RELEASE_GUIDE.md)。输入和相关环境未变时，不重复运行已通过的同一检查。

## 4. 专用诊断:diagnose:wesing

- 命令:`npm run diagnose:wesing` → `node scripts/inspect-wesing-playback.js`（[package.json](../../../package.json) 的 `scripts["diagnose:wesing"]`）；Windows 便捷包装 [scripts/inspect-wesing-playback.cmd](../../../scripts/inspect-wesing-playback.cmd)(chcp 65001、运行后 pause)。
- 用途:现场诊断全民 K 歌播放状态识别问题。同时抓两条数据流 — PowerShell 窗口采样(`createPowerShellWeSingMonitor`:标题/进度/audioActive 等,250ms 轮询)与 WeSingCache 日志 tail(UTF-16LE,轮询最新 .log 的新增字节),并解析 `StartKSong` 行提取 mid/歌名。日志选择、UTF-16 残字节、偏移和停止刷新由 [wesing-log-probe.js](../../../scripts/wesing-log-probe.js) 管理；[wesing-diagnostic-terminal.js](../../../scripts/wesing-diagnostic-terminal.js) 管理键盘 setup/cleanup，CLI 保持统一结束顺序。
- 交互:启动后在全民 K 歌执行动作并按键打标 — `1` 点击 K 歌/开始录制、`2` 暂停、`3` 继续、`4` 退出录制、`5` 重新进入同一首歌、`6` 歌词状态不正确;`q`/Ctrl+C 结束。JSONL 落盘 `tmp/wesing-playback-diagnostic-{时间戳}.jsonl`(含 diagnostic-start/monitor-sample/wesing-log-line/user-marker/diagnostic-stop 事件)。
- 参数:`--cache <WeSingCache 目录>`(缺省时经 `/api/music/wesing/status` 从运行中的服务读取,[inspect-wesing-playback.js:96-126](../../../scripts/inspect-wesing-playback.js#L96-L126))、`--output <文件>`、`--duration <秒>`(1-3600)、`--help`。
- 配套测试:[wesing-playback-diagnostic.test.js](../../../test/wesing/wesing-playback-diagnostic.test.js)、[wesing-diagnostic-resources.test.js](../../../test/wesing/wesing-diagnostic-resources.test.js);数据流细节见 [backend/music/wesing.md](../backend/music/wesing.md)。

## 5. 其他辅助脚本

- [scripts/capture-bilibili-events.js](../../../scripts/capture-bilibili-events.js)：独立捕获工具，复用 `BilibiliApiClient`、`WebSocketConnection` 与 `packet-parser`，默认写入 `tmp/bilibili-events-{时间戳}.ndjson`。`meta.formatVersion=2`；每条 `event` 保留兼容字段 `receivedAt/cmd/data`，新增完整 `message`，包含普通弹幕顶层 `info` 及其他顶层字段，不能只用 `data` 回放。
- 参数:`--room <房间号>`(必填)、`--duration <秒>`(默认 300)、`--output <路径>`、`--gift-only`(仅礼物类命令)、`--bilibili-user-data <Electron userData>`;另支持环境变量 `BILIBILI_COOKIE`/`BILIBILI_UID`。
- 预算：最多 10,000 条事件、16 MiB 输出、1 MiB 待写数据（含流内部缓冲）；输出为 summary 预留 64 KiB，触限即停止并排空已接纳写入。输出文件用 `wx` 创建，不覆盖已有文件。断线即结束本次捕获，不自动持续重连。
- `summary` 分开记录 `parseErrorCount`（抛出的异常）、`decodeDiscardCounts`（帧解码拒绝原因）及 `writeRejectedCount`（写入预算拒绝），并记录结束原因、事件数与命令计数；命令计数有界，额外命令归 `(other)`。`recordBytes` 是 summary 之前已接纳记录的字节数。写入或关闭失败直接报错，不能据不完整输出宣称成功；诊断原因与覆盖边界见 [协议 §4.5](../backend/bilibili/protocol.md#45-帧解析与解压)。
- 登录态捕获：`--bilibili-user-data` 需以 Electron 运行，入口 [scripts/bilibili-capture-electron/index.js](../../../scripts/bilibili-capture-electron/index.js) 复用桌面登录状态。采样文件保留上游 UID、昵称、正文等原始信息，**不做匿名化**；它不是可直接公开的脱敏样本。
- 配套离线测试：[capture-bilibili-events.test.js](../../../test/bilibili/capture-bilibili-events.test.js) 覆盖完整消息、过滤、输出预算及停止/写入清理；[packet-decoder.test.js](../../../test/bilibili/packet-decoder.test.js) 覆盖解码边界与丢弃原因。样本或零错误计数均不代表断线窗口已补齐。

独立 Electron 检查脚本 [verify-gift-export.cjs](../../../scripts/verify-gift-export.cjs)、[verify-gift-history.cjs](../../../scripts/verify-gift-history.cjs)、[verify-overlay-filters.cjs](../../../scripts/verify-overlay-filters.cjs) 和 [verify-welcome-settings.cjs](../../../scripts/verify-welcome-settings.cjs) 的截图、导出文件与 Electron 配置保存在仓库 `tmp/` 下各自唯一的检查目录，便于复核与清理。

过滤器与欢迎检查通过现有 Admin fragment 组合器加载当前组件/工具箱片段及共享 dialog，使用隔离的合成数据、随机 loopback 端口和真实 preload/IPC；分别拥有本次 userData、sessionData、crashDumps 与 HTTP 退出清理。可用 `LIRA_VERIFY_OUTPUT_DIR` 指定唯一检查目录的父目录，默认仍为仓库 `tmp/`。

`verify-gift-history.cjs` 以 Electron 独立入口运行，使用随机本地端口、独立 userData、检查目录内的合成 SQLite 数据以及真实导出 preload/IPC，不启动或连接用户的 LIRA 实例。浏览器源复用现有页面服务和 API 分发，按正常的 scoped token、sandbox、CORS 与 WebSocket 鉴权加载。设置检查挂载现行 `toolbox/gift.html` 的滚动礼物面板，验证 `scrollSpeed` 保存与 72px 单行画面；不再从历史抽屉寻找旧设置页或 `intervalSeconds` 控件。它是可选桌面验收，不在发布脚本的自动门禁内；设置表单的浏览器回归由 `test/gifts/frontend-gift-display-settings.test.js` 覆盖。

## 6. 测试约定

- **命名与布局**:测试按 §1 的业务职责放在 `test/<领域>/`，`test/helpers/` 存放共享辅助模块，`test/fixtures/` 存放隔离输入和由拥有者启动的探针。测试文件使用 `xxx.test.js` 命名，对应实际行为或明确的工程契约。
- **隔离与加载**：真实被测业务逻辑必须参与；mock 用于隔离外部依赖，测试间不共享可变状态。按行为选择 Node、VM、浏览器或 Electron，纯函数不启动整页或应用；已有 helper 能满足时直接复用。语法检查覆盖 `test/`，命令见 §3。
- **运行单个文件**:`node --experimental-vm-modules --test test/<领域>/xxx.test.js`(见 §1)。

### 何时新增或修改测试

按故障后果、独立检测价值和维护成本决定是否保留或新增自动化：**故障值得防护，现有检查不足，且新增信心值得维护成本**，才补最小覆盖。能设想一种错误、规范写了一个值，本身不足以证明需要测试。默认不为每个文件、函数、字段、控件或修复配一条用例；低风险且容易通过代码审查或针对性查看发现的问题，可以直接不测。评审中简述依据即可，无需逐例建台账。

| 改动或场景 | 处理原则 |
| --- | --- |
| 属于[不新增的测试与断言](#不新增的测试与断言)所列类别 | 不新增用例或断言，需要确认效果时做针对性查看；只在该节“例外”成立时写最小断言。 |
| 函数改名、文件移动、DOM 包裹层变化等内部调整，外部行为不变 | 沿用有效行为测试；被无关内部细节牵动时收窄夹具或断言，不为新结构增加镜像检查。 |
| 已有覆盖足够，或现有证据足以确认的简单修复 | 复用相关检查，不因“修了一个问题”“改了一个文件”再新增用例。 |
| 业务计算、校验、状态流转、异常恢复、权限、协议、持久化、并发、资源生命周期存在具体覆盖缺口 | 在所属模块补最小有效覆盖；同一行为优先修改已有用例，独立失败方式分别保留。 |
| 外观设置保存/恢复、用户指定字号/颜色的准确应用、拖拽坐标、导出尺寸，或遮挡/溢出造成实际操作和信息丢失 | 验证对应功能结果、可访问性或明确边界；不附带锁定默认排版、装饰尺寸及其他样式。 |

同一用户行为可以在一个场景中验证必要的连续步骤，不按内部函数拆成一串微型测试；独立故障与状态隔离仍须保留。低层已覆盖的输入矩阵不在高层重跑，高层只保留有价值的接线与关键用户流程。移除低价值测试不要求逐条另建替代测试。测试总数和覆盖率数字没有通用目标，不用合并无关场景或跳过来制造下降；运行依赖见 §1。

### 不新增的测试与断言

下表各类默认不新增用例，也不往已有用例里追加断言。需要确认的效果交给代码审查或针对性查看。只有“例外”栏的功能结果成立时，才写证明该结果的最小断言。已有测试中的同类断言按[断言的取舍](#断言的取舍)删除或改写。

| 类别 | 不新增 | 例外：保留最小断言 |
| --- | --- | --- |
| 界面文案 | 标题、按钮、标签、占位、提示、toast、状态与错误说明、计数的原文与位置 | 需要区分结果时，断言失败提示不同于成功提示或过期值不出现，不写两段原文；不可信文本按文本显示 |
| 显隐与控件清单 | 普通控件的显隐、禁用与排列；静态页面的 ID、按钮、标签与默认选项清单；图标、class、`data-*`、CSS 变量等装饰 | 显隐或禁用本身阻止数据丢失或危险操作，例如未加载完成不能保存、破坏性操作需确认；必要的整体页面组合检查保留一次 |
| 排版与动效 | 布局、尺寸、间距、颜色、圆角、阴影、字体度量、层级、断点、滚动偏移，以及动画曲线、时长与帧位置的数值、源码断言或截图快照。规范写了展示数值，本身不构成理由 | 溢出或遮挡造成信息丢失或无法操作；明确的导出尺寸与拖拽坐标；用户设置的字号、颜色准确应用；长驻画面的定时器、RAF 与监听清理 |
| 源码扫描 | 读取 `src/`、`public/` 后断言包含某字符串、函数名、选择器或 CSS 规则 | IPC 来源校验、Electron 安全开关、CSP、凭据、路径穿越、危险 API，以及 `test/engineering/` 的架构与文档门禁 |
| 默认值快照 | 完整默认配置或设置对象；默认颜色、尺寸、字体、时长、文案与选项列表 | 已持久化或跨版本兼容的设置键与默认值 |
| 整体比较 | 场景只关心少数字段时，对整个对象、数组、请求体、日志、HTML 或调用序列做 `deepEqual` 或快照 | 完整输出本身就是协议、持久化或导出契约 |
| 等价输入 | 同一分支的参数化循环与近似重复用例；简单截断、去空格、格式化函数对 `null`、空串、`NaN`、负数、数字字符串的逐项穷举 | 每个独立分支保留一个代表；金额、时间窗口、持久化数据与安全相关的真实边界 |
| 转发与 mock | getter/setter 与原样转发；mock 返回 A 再断言 A；无业务意义的调用顺序与私有函数名；“导出了函数”“模块能加载” | “只发送一次”“失败时不写库”等业务副作用 |
| 跨层重复 | 已由 owner 验证的规则在路由、服务、前端或页面再测一遍 | owner 处一次，加至多一条接线检查 |
| 外观性生命周期 | 短命弹窗或菜单的销毁、Escape 关闭、焦点去向、普通控件的 aria 文案 | 核心流程唯一的键盘操作覆盖；进程、窗口、连接、文件句柄等有实际成本的资源释放 |
| 措辞 | 诊断日志与异常 `message` 的原文 | 作为契约的错误码、类型与 HTTP 状态；凭据不进入日志 |
| 测试自身 | 针对 helper、fake、fixture 本身的用例，以及只执行夹具代码的断言 | 无 |
| 开发与支持脚本 | 截图、诊断、事件捕获等脚本的参数解析与提示文案 | 凭据不写入输出、输出上限、已有文件不覆盖与资源释放 |
| 昂贵运行时 | Node/VM 已能证明的规则在浏览器或 Electron 中重跑；每个样式、变体或控件各开一个真实窗口用例；按固定时长等待 | 每条核心用户流程保留一个端到端用例；等待业务事件或状态，不按装饰动画时长等待 |

新增一条用例或断言前依次回答下面的问题，任一项答不上来就不写：

1. **故障**：它失败时，用户或数据会遇到什么实际问题？“文案、样式或默认值变了”不算。
2. **归属**：owner 层是否已有用例？有就扩展该用例或不写，不在消费者层再测一遍。
3. **误报**：只改文案、样式、默认值、DOM 层级或内部函数名时，它会不会失败？会就改成行为断言或不写。
4. **成本**：能否用更便宜的运行时证明？依次考虑纯函数或 Node、VM、浏览器、Electron。

修复缺陷时，只在出错的 owner 层补一条能复现原问题的回归；不顺带为同一文件的其他控件、字段或分支补测试。

### 复用与职责范围

- **先查 owner**：按行为和所属模块搜索已有用例、helper 与 fixture，确认覆盖由谁承接。相同行为的新输入或边界优先扩展现有场景，参数化用例须能独立定位失败。
- **保持职责小**：每个用例验证一个明确行为或契约，可包含证明该行为所需的多个断言。不要把无关流程塞进同一用例；测试文件和 helper 也应围绕同一职责，不为复用而扩大依赖或建立万能测试框架。
- **规则归属明确**：公共规则在拥有者层验证，调用方验证自己的接线、输入输出和集成契约，不重复冻结拥有者的内部结构、完整默认对象或普通视觉数值。不同层确有独立失败风险的覆盖应保留，不能仅因使用同一模块就合并。
- **矩阵围绕分支**：共享字段校验器的合法、非法和边界输入在 owner 处验证一次；各样式保留字段集合、自己的默认分支和代表性设置应用，不展开“所有样式 × 所有字段 × 所有非法值”。消费者的重置或传播预期可引用 owner 导出的默认值，不能用待测算法计算校验器的预期答案。
- **复用保持隔离**：优先复用适用的现有构造器、数据和辅助函数，每个场景只准备需要的输入；共享构造逻辑，不共享可变状态或依赖其他用例的执行结果。避免修改一个通用 fixture 就迫使无关场景同步改断言，也不为单次使用预先抽象。
- **按 owner 加载输入**：单页或单控件测试优先用已有 `readAdminFragmentHtml` / `readCssBundle` 读取所属片段；纯函数直接加载所属模块。完整管理页组合、全局规则和入口接线由各自的集成测试承接，避免无关页面或模块变化牵连局部测试。
- **检查连带影响**：局部改动导致大量测试需要修改时，先区分真实契约变化、重复断言和过宽的 fixture 耦合，再在本次范围内修正。不能批量改期望值、删除独立回归覆盖或扩大成无关测试重构来消除失败。

### 断言的取舍

断言只保留证明当前场景结果和必要副作用的部分。评审时检查：没有这条断言，会漏掉什么实际故障；只调整无关设计或内部结构，它是否会误报。普通视觉参数调整不应要求在多个测试里同步修改同一组期望值；测试数量下降也不代表覆盖丢失或治理完成。

| 处理 | 适用情况 |
| --- | --- |
| 删除 | 属于[不新增的测试与断言](#不新增的测试与断言)所列类别且不在例外栏内，例如普通排版、DOM 装饰层级、文案顺序和装饰样式快照；直接删除断言、用例或整个文件，不新增截图测试替代。 |
| 修改 | 意图有效但依赖属性顺序、完整标签、无意义文案排列或内部函数写法；改为可观察行为、目标属性或与输入相关的边界关系。 |
| 合并 | 公共组件、页面源码和运行时重复检查同一规则；在拥有者处保留一次规范检查，并注明承接行为的现有用例。 |
| 保留 | 权限、身份/来源隔离、数据完整性、协议/持久化、并发与重试、资源释放、可访问性，以及明确的输出尺寸和用户设置准确应用。 |

静态源码测试只用于有实际风险的依赖方向、权限/凭据边界、危险 API 等约束；把设计惯例命名成“架构约束”不自动赋予其测试价值。“源码包含某字符串/函数名”本身没有契约价值。真实页面交互已有覆盖时，不再为同一控件保留静态库存；没有实际风险的源码检查直接删除。

字体 token 名称、CSS 使用方式和装饰层级交给样式维护与审查；保留有实际价值的对比度、键盘操作及用户设置准确应用。导出尺寸、拖拽坐标、业务金额和时间边界可精确断言；不附带普通排版、控件清单和默认外观快照。

- **重复回归**：按业务行为归并多轮审计添加的同类用例，保留能识别原问题的场景；同一函数的不同失败方式不能只因名称相近合并。
- **mock 与内部实现**：删除只配置 mock 返回 A 再检查 A、没有实际业务逻辑参与的用例；不锁定无契约意义的私有变量、函数名或调用顺序。“只发送一次”“失败时不能写库”等业务副作用约束可以保留。
- **输入与输出**：普通输入按实际分支取代表；缺失字段、`null`、空字符串和越界值不必然等价。只比较场景需要的字段或结果，完整对象、日志及快照仅在完整输出本身属于明确契约时保留。
- **时间与负载**：异步测试跟随业务状态、事件或实际调度推进，不复制装饰动画时长。真实超时、重试和业务期限仍须验证。压力测试保留所需输入量，在相关峰值和结束处检查资源、总量与清理，避免逐条重复检查同一不变量；必须全程成立的上界、顺序或隔离仍检查过程，不能只验证终态。
- **过时覆盖**：确认功能或兼容范围已取消后，连同不再引用的测试辅助代码删除；不能仅因代码年久判断其过时。

清理混合用例时逐项保留有效覆盖，删除独占的无用读取和 import，不留下空测试、跳过或吞错。涉及行为的合并必须确认新旧场景等价；缺少等价运行覆盖的关键接线检查可明确保留。跨领域治理除聚焦/全量回归外，可在隔离子进程中验证普通设计变化仍通过、代表性真实故障仍失败，不能只以最终全绿判断测试质量。

以上是本项目按风险与维护成本采用的取舍，不规定单元/集成测试数量比例。参考：[Google：Change-Detector Tests Considered Harmful](https://testing.googleblog.com/2015/01/testing-on-toilet-change-detector-tests.html)、[Ham Vocke：The Practical Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html)、[Kent C. Dodds：Testing Implementation Details](https://kentcdodds.com/blog/testing-implementation-details)。
