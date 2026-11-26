# 测试策略

> 涉及文件：[package.json](../../../package.json)（测试与验证脚本）、[test/](../../../test)、[scripts/check-js.js](../../../scripts/check-js.js)、[scripts/inspect-wesing-playback.js](../../../scripts/inspect-wesing-playback.js)、[scripts/capture-bilibili-events.js](../../../scripts/capture-bilibili-events.js)、[scripts/bilibili-capture-electron/](../../../scripts/bilibili-capture-electron)

本文档是测试体系的**单一事实来源**，集中维护测试框架和命令、各业务域重点测试入口、静态语法检查、专用诊断、事件捕获脚本与测试取舍约定。构建与发布命令见 [build.md](build.md)。

## 1. 框架与命令

- **测试框架**：基于 Node 内置 `node:test` + `node:assert/strict`，测试运行器不依赖第三方框架；浏览器与 Electron 自动化使用开发依赖 Playwright（[package.json](../../../package.json)）。
- **全量运行**：`npm test` 通过 [run-tests.js](../../../scripts/run-tests.js) 递归收集 `test/` 各业务目录中的 `*.test.js`（排除 `helpers/` 和 `fixtures/`，按文件名排序），执行 `node --experimental-vm-modules --test --test-concurrency=<默认 8>`。默认并发取 `min(8, 可用 CPU 数)`，显式传入 `--test-concurrency` 会替换该默认值（在 32 逻辑 CPU 发布机上实测并发 8 兼顾速度与稳定性，桌面组 0 失败）。选中 Windows 原生进程归属测试时，运行器先独立执行该文件，再并发执行其余文件，避免资源竞争导致原生查询超时；各批分别汇总，任一批失败即整体失败。辅助模块和探针仍由对应测试显式导入或启动，保留进程隔离。
- **管理页回归**：`npm run test:admin` 运行固定清单的管理页组合、前端行为与 AI 测试并启用 ESM VM 模块；前端辅助加载器使用 `vm.SourceTextModule` 保留真实 `import`/`export`、别名、只读导入绑定与模块作用域（缺少 `--experimental-vm-modules` 时直接报错，不再退回静态拼接；个别依赖经 `vm.SyntheticModule` 注入样例，仍参与真实链接检查）。
- **文档门禁**：`npm run verify:docs` 检查治理文件、相对链接、AI 路由表和规格索引。
- **架构门禁**：`npm run verify:architecture` 运行模块边界、遗留边界、前端 ESM 边界与源码规模报告测试（行数仅作提示，不作为硬门禁）。模块依赖图覆盖 `src/` 和 `public/js/` 的静态 ESM 与可执行字面量 `require`/`import`，检查循环依赖、领域向存储/传输/桌面的反向导入、`shared` 向上导入及已退役的 Admin 全局注册表；前端 ESM 门禁还会将全部 `public/js/` 模块做真实 VM 链接校验（不执行浏览器代码）。
- **规模审查提示**：`npm run verify:modularity` 按文件类型报告物理行数，超过提示线不单独导致失败，口径见 [modularity-standard.md](../../architecture/engineering/modularity-standard.md#file-size-review)。
- **快速门禁**：`npm run verify:quick` 按文档 → 语法 → 架构顺序执行，用于日常评审前快速反馈。
- **契约输入门禁**：`npm run verify:contracts` 核对固定服务器提交和全部样例的 SHA-256，不下载或切换检出目录。
- **完整门禁**：`npm run verify` 依次执行契约输入校验、语法检查与 `npm test -- --require-full`（已包含文档与全部架构测试，无需先运行 `verify:quick`）。本地发布验证环境见 [build.md](build.md#本地发布验证)。
- **为什么需要 `--experimental-vm-modules`**：后端源码以 CJS（`require`）为主，但多个前端测试通过 `vm.SourceTextModule` 或动态 `import()` 加载 `public/js/` 下的 ESM 模块；缺少该参数会导致这些测试失败。
- **单文件运行**：`node --experimental-vm-modules --test test/ai/ai-config-store.test.js`（必须保留 `--experimental-vm-modules`）。
- **测试方式**：以离线单元和集成测试为主，不访问真实外部网络；服务端模块直接加载真实实现并注入临时 SQLite 目录或替身，服务冒烟测试在随机本地端口启动完整服务；浏览器模块用 VM + 模拟 `window`/`localStorage` 求值。

### 按运行依赖选择

| 命令 | 实际依赖与边界 |
| --- | --- |
| `npm run test:offline` | Node/VM、临时 SQLite/HTTP；含使用合成 Git 仓库的契约校验器测试，无私有服务器依赖 |
| `npm run test:browser` | Chromium 组件测试及模拟桥；不替代 Electron 权限测试 |
| `npm run test:desktop` | Electron、原生 Windows TCP/进程查询及其显式子进程探针 |
| `npm run test:installer` | Windows/NSIS 安装器；缺失工具导致的跳过必须单列 |
| `npm run test:contracts` | 从锁定服务器检出读取样例的调用方测试（含密码兼容样例）；UI/协议/HTTP 本地测试另留自主输入 |

五组互不重叠且合集等于 `npm test`，可用 `node scripts/run-tests.js <组名或all> --list` 查看实际文件清单：

- 新增使用浏览器、桌面或服务器样例的测试需在执行器中登记，普通 Node 测试自动进入 `offline` 组。
- `run-tests.test.js` 会沿测试与共享辅助模块的静态 `require` 校验依赖归组：直接或间接启动 Chromium 的文件归 `browser`，依赖 `electron` 或 `shared-electron` 的文件归 `desktop`，防止遗漏登记后落入 `offline`；`contracts` 组仅放必须读取锁定服务器样例的用例，同文件中不依赖样例的用例拆到离线文件。
- 日常开发只运行改动所属的测试组及直接受影响的用例，完整验证仍使用 `npm run verify`。管理页定向入口包含浏览器组件，需先安装 Chromium：`npx playwright install chromium`。

### 按业务职责定位和运行

测试目录表达业务职责，运行分组表达环境依赖。同一业务的前端、后端和 IPC 测试放在一起（例如 `desktop/` 下的普通 Node 测试仍属于 `offline`，而 `engineering/build-integrity.test.js` 属于 `desktop` 运行组）。

| `test/` 目录 | 测试职责 |
| --- | --- |
| `admin/` | 管理页组合、状态、工作区、工具箱导航、主播计划和帮助 |
| `ai/` | AI 配置、模型、工具、生成、配额与送达 |
| `bilibili/` | B 站协议、认证、直播状态、用户资料和事件解析 |
| `bots/` | 每日播报、签到、抽签和自定义回复 |
| `cloud-sync/` | 云端歌库、账号与运行状态同步 |
| `danmaku/` | 弹幕客户端、发送、缓冲、桌面预览与叠加层 |
| `desktop/` | Electron 生命周期、桌面认证、数据路径、资源检查与更新 |
| `engineering/` | 测试执行器、语法、文档、架构、契约输入、构建与安装器 |
| `fan-profiles/` | 粉丝档案、合并、导入导出和同步 |
| `games/` | 小游戏、转盘与互动场次 |
| `dynamic-lottery/` | 动态抽奖采集、开奖、账号会话与界面 |
| `gifts/` | 礼物目录、历史、盲盒、投影、特效、同步和 PK 播报 |
| `license/` | 设备授权、激活、续期、协议与远端授权客户端 |
| `lyrics/` | 歌词解析、请求、发布、渲染与减弱动态效果 |
| `music/` | 音乐平台认证、Provider、响应与媒体请求头 |
| `overlays/` | 跨叠加层通信、开播画面和时钟 |
| `overtime/` | 加班机规则、结算、状态、编辑器与叠加层 |
| `playback/` | 播放器状态、缓存、队列、音质和恢复 |
| `server/` | 服务启动、模块接线、会话、事件发布和本地访问边界 |
| `settings/` | 设置契约、初始化、资料与欢迎设置 |
| `shared/` | 日志脱敏和敏感字段识别 |
| `songs/` | 歌库、导入导出、点歌、排队、冷却和歌单展示 |
| `storage/` | 数据库初始化、维护、清空、迁移和查询 |
| `transport/` | HTTP、WebSocket、响应体和资源上限 |
| `ui/` | 通用 Toast、选择菜单、参数滑块、排版与界面约束 |
| `wesing/` | 全民 K 歌采集、缓存、歌词与诊断 |
| `helpers/`、`fixtures/` | 共享测试辅助模块、样例素材和由测试显式启动的探针 |

```powershell
npm test -- --help
npm run test:offline -- --domain=ai
npm run test:browser -- --domain=gifts
npm test -- --domain=gifts --domain=overtime --list
```

`--domain=<目录名>` 可重复传入：先取目录并集，再与运行组求交集（默认 `all`）。`--list` 仅列清单，拼错目录或交集为空直接报错；其余 Node 参数（`--test-name-pattern`、`--test-reporter`、`--test-concurrency`）原样转发。

已知测试文件时，优先使用可重复的 `--file`（支持仓库相对路径和加引号的通配符），多个选择器取并集后与依赖组和 `--domain` 求交集，未命中或空交集报错而不回退全量：

```powershell
# 歌库筛选只运行所属模块；盲盒页面只列出相关前端文件
npm test -- --file=test/songs/song-library-filter.test.js
npm test -- "--file=test/gifts/frontend-blindbox*.test.js" --list

# 历史记录 Node/VM 行为；拖选等真实浏览器交互单独选择
npm run test:offline -- "--file=test/gifts/frontend-gift-history*.test.js"
npm run test:browser -- --file=test/gifts/frontend-gift-history-selection.test.js

# 跨领域改动显式合并多个文件
npm test -- --file=test/gifts/frontend-blindbox-overlay.test.js --file=test/ui/frontend-toast-business.test.js
```

执行时会输出 `File scope: full/partial` 与选中文件数。`--test-name-pattern` 仅过滤已选文件内的用例，不能代替 `--file`（未限定文件时其余文件仍会执行顶层初始化）。

`npm run verify` 使用 `--require-full`：拒绝部分组/目录/文件、`--failed`、名称/跳过筛选、`--test-only`、分片、`--list` 和 watch 模式，同时检查 `NODE_OPTIONS` 继承参数；跳过、待办和取消用例均不能通过完整门禁。所有运行均要求结构化结果完整可读，进程退出 0 不能掩盖结果缺失。

### 失败文件重跑与诊断记录

执行器默认约每 10 秒向终端输出一次进度、失败详情和最终汇总（可显式传 `--test-reporter=spec`）。每批完整 `spec` 输出（含测试 `stdout`/`stderr`）自动写入 `tmp/test-results/run-*/batch-*.log`，写入失败同样使运行失败。

同目录 `results.json` 记录选中文件、实际结果、失败用例、耗时、总计数与日志文件名；`latest.json` 在运行开始时指向本次记录，并行较早任务不会覆盖新任务指针。记录仅供诊断，`complete` 仅表示记录完整，是否通过仍以退出码、失败与跳过计数为准。

```powershell
# 先查看最近一次运行的失败文件，再重跑这些文件
npm test -- --failed --list
npm test -- --failed
```

`--failed` 读取最新完整记录中的失败文件（无记录、不完整、已全绿或文件已删除时直接报错，不回退更早记录或全量），并与运行组、`--domain` 和 `--file` 取交集，按整文件重跑。定向重跑通过只证明选中范围，不能替代发布验收或未诊断的并发失败分析。

### 按影响范围验证

选择器不自动推断源码依赖。修改共享资源、权限、存储或跨模块接线时，按实际受影响的调用方补充测试文件；仅调整普通页面样式时，按根目录 `AGENTS.md` 的低风险（Small）流程做针对性检查即可，不默认拉起领域全组、浏览器全组或完整发布验证。已通过且相关输入未变的检查不重复执行。

- **共享浏览器与 Electron 宿主**：同一文件的多个浏览器用例通过 [shared-browser.js](../../../test/helpers/shared-browser.js) 共用一个 Chromium 与各自独立的 context；桌面测试统一经 [shared-electron.js](../../../test/helpers/shared-electron.js) 的 `launchElectron` 启动 Playwright 的 Electron 宿主（会在子进程环境中删除 `ELECTRON_RUN_AS_NODE`，防止 Electron 退化为纯 Node 导致握手超时报 `Process failed to launch!`；直接以 Node 方式启动 Electron 的测试自行管理环境）。
- **并发界面等待原则**：并发运行的界面测试须区分页面导航、模块就绪与业务操作。仅验证重载后状态时等待 `domcontentloaded` 与目标组件就绪（避免无关图片阻塞整页 `load`）；画布发布前等待自动尺寸回传草稿，写入后等待画布恢复可操作；保存失败后的重试用目标按钮 `click({ trial: true })` 检查真实可操作性；下载进度在暂停期间检查，绝对时间动效用受控时钟推进至截止点。
- **离屏渲染与探针清理**：Windows 发布环境的隐藏 Electron 测试窗口使用 `offscreen: true`、`backgroundThrottling: false` 启用离屏渲染，保留真实 preload、IPC 与沙箱。三个交互夹具（自动回复编辑器、弹幕画布编辑器与到期设置）在 `app.whenReady()` 前关闭硬件加速改用软件离屏渲染，避免多个隐藏 GPU 窗口并发时随机卡顿；资源与媒体生命周期探针保留硬件加速以验证 WebGL/GPU 资源释放。动画像素回归先暂停入场再等字体与布局就绪，不得通过延长等待或删断言规避时序问题。
- **探针收尾约定**：[资源生命周期探针](../../../test/fixtures/resource-lifecycle-probe.cjs) 在释放断言完成后保留一条空闲 HTTP 连接以验证测试服务器主动清理连接；两个原生认证探针（[账号竞态](../../../test/desktop/desktop-auth-race-electron.test.js)、[请求权限](../../../test/desktop/desktop-request-auth-electron.test.js)）在 `tmp/` 隔离目录运行，等待子进程与管道关闭后再清理目录。

### 固定服务器契约输入

[server-contract.lock.json](../../../server-contract.lock.json) 声明服务端仓库、完整 commit SHA 及各份原始样例的 SHA-256。协议与样例由服务端维护，客户端不保存副本。[verify-server-contract.js](../../../scripts/verify-server-contract.js) 在使用前核对提交和哈希，错误提交、缺失或改动的样例均会报错。

目录选择顺序为：显式路径 → `LIRA_SERVER_ROOT` → 相邻 `lira-server-contract` → 相邻 `lira-server`（专用检出目录存在但损坏或过期时不会静默回退开发工作区）。可在独立目录准备锁定检出（不切换正在开发的服务器工作区）：

```powershell
$contract = Get-Content -LiteralPath server-contract.lock.json -Raw | ConvertFrom-Json
git clone --no-checkout "https://github.com/$($contract.repository).git" ..\lira-server-contract
git -C ..\lira-server-contract checkout --detach $contract.revision
$env:LIRA_SERVER_ROOT = (Resolve-Path ..\lira-server-contract).Path
node scripts/verify-server-contract.js --runtime
npm ci
npm run verify
```

`--runtime` 额外拒绝服务端 `src/`、`package.json`、`package-lock.json` 中未提交或未跟踪的变更，供加载真实服务端实现的联测使用（仅读取样例的测试不受无关服务端文档改动影响）。验证脚本不会自动拉取、修改或清理服务端文件；目录或版本不匹配时，应另建独立检出目录或主动更新契约锁文件。升级契约时先确认服务端提交可获取，同步更新锁文件 SHA 与全部样例哈希（服务端 `.gitattributes` 保证 JSON 为 LF），再运行完整门禁与往返检查。

### 两仓歌库往返回归

[verify-song-roundtrip.cjs](../../../scripts/verify-song-roundtrip.cjs) 使用两仓绝对路径，在本机随机端口运行真实歌曲事务、内存 SQLite 存储与 DTO，并由真实桌面 HTTP 客户端上传和回读。设备鉴权和路由接线使用测试适配器，JSON 请求体上限按对应版本的契约样例配置；真实设备路由的认证、解析器装配及 413 响应由服务端路由测试覆盖，本脚本不替代生产认证或线上容量验收。两仓需先安装各自锁文件依赖，且服务端的 `better-sqlite3` 须匹配当前 Node ABI。

客户端完整验证使用发布指南要求的最新 Node.js 24 LTS 补丁版。歌库往返会在同一进程加载两仓代码，运行前请对照两份 `package.json` 的 `engines.node`。如果锁定服务端支持的补丁范围更窄，在当前 PowerShell 会话切换到两仓都支持的版本，沿用上节的 `LIRA_SERVER_ROOT`，然后运行：

```powershell
npm --prefix "$env:LIRA_SERVER_ROOT" ci --engine-strict
npm run verify:roundtrip
```

该检查独立于 `npm test`，`npm run verify:roundtrip` 复用上述服务端目录解析规则；开发联调可显式传入 `--working-tree <客户端绝对路径> <服务端绝对路径>`（不替代锁定提交的发布契约验收）。单仓的 `verify:quick` 与 `node --test test/engineering/server-contract.test.js` 不需要私有服务器检出；本地发布验证见 [build.md](build.md#本地发布验证)。

### Windows 安装器集成测试

以下测试需要 Windows 与 NSIS 环境，编译并静默执行隔离夹具程序（重定向注册表、AppData、临时目录与安装目录，不触碰真实安装或用户数据库）：

- **[安装目录测试](../../../test/engineering/installer-directory.test.js)**：验证默认目录、沿用旧路径、用户指定路径优先、无 D 盘及重解析点/ACL 拒绝。
- **[数据保护测试](../../../test/engineering/installer-migration.test.js)**：验证同目录快路径原地保留（及卸载器被替换/路径不匹配时回退）、换目录、旧数据迁回、备份恢复、冲突中止与文件占用重试。
- **[自动关闭测试](../../../test/engineering/installer-app-exit.test.js)**：覆盖原生窗口/无窗口进程确认关闭、取消、超时重试、静默退出、其他目录同名隔离，以及电音助手真实命名事件退出。
- **[卸载保留与清理测试](../../../test/engineering/installer-uninstall.test.js)**：通过独立就绪文件区分启动（限时 30 秒）与删除执行（限时 10 秒），超时终止子进程后再清理隔离目录，验证默认保留数据、确认删除、静默/升级、无关文件保留与目录链接保护。使用真实文件句柄验证程序短暂占用后能完成卸载、持续占用时报告对应路径并保留卸载器。
- **[更新管理回归](../../../test/desktop/update-manager.test.js)**：以真实 `NsisUpdater` 与本地 HTTP 服务验证增量传输字节、已下载包离线复用、缺块图/Range 失败回退整包及摘要校验失败拦截。

[installer-tools.js](../../../test/helpers/installer-tools.js) 优先读取 `LIRA_TEST_MAKENSIS`（编译器）和 `LIRA_TEST_NSIS_PLUGINS`（含 `StdUtils.dll`、`nsProcess.dll` 的 Unicode 插件目录），未指定时自动只读查找 `ELECTRON_BUILDER_CACHE`（默认 `%LOCALAPPDATA%/electron-builder/Cache`）下的 `nsis-3.0.4.1` 与 `nsis-resources-3.4.1`（不下载工具，显式无效路径直接失败）。`verify` 已包含该组，无需预先单跑；完整 Windows 验收前可用以下命令检查工具：

```powershell
node -e "const tools = require('./test/helpers/installer-tools').resolveInstallerTools(); if (!tools.compiler || !tools.plugins) throw new Error('Configure the NSIS compiler and Unicode plugins first'); console.log(tools)"
npm run verify
```

已有完整缓存时无需每次配置环境变量，完整安装器分组应报告 0 项跳过；发布包的人工安装验收仍按 [build.md](build.md) 执行。

## 2. 重点行为与测试入口（按领域分组）

下表仅列出各业务域的代表性测试入口，并非全量文件清单。完整文件清单用 `node scripts/run-tests.js all --list` 查看；发现规则见 §1、[test/README.md](../../../test/README.md) 与 [run-tests.js](../../../scripts/run-tests.js)。

| 测试文件 | 被测模块 | 覆盖文档 |
| --- | --- | --- |
| **治理与架构** | | [modularity-standard.md](../../architecture/engineering/modularity-standard.md) + [ai-workflow.md](../../architecture/engineering/ai-workflow.md) |
| [run-tests.test.js](../../../test/engineering/run-tests.test.js) | 递归收集、依赖分组、目录筛选、辅助文件排除、进程隔离、参数转发和失败退出码 | 本文 §1 |
| [check-js.test.js](../../../test/engineering/check-js.test.js) | 语法检查的并发上限、完整扫描、失败退出与原生 CJS/ESM 语法行为 | 本文 §3 |
| [server-contract.test.js](../../../test/engineering/server-contract.test.js) | 固定服务器版本、样例完整性、目录选择和运行时漂移拒绝（临时 Git 仓库） | 本文 §1 |
| [modularity-size.test.js](../../../test/engineering/modularity-size.test.js) | 物理行计数、分类提示、未跟踪文件、非阻断 CLI 及静态内容边界 | [modularity-standard.md](../../architecture/engineering/modularity-standard.md) + [modularity-debt.md](../../architecture/engineering/modularity-debt.md) |
| [governance-docs.test.js](../../../test/engineering/governance-docs.test.js) | 治理文件、路由表、规格索引与范围内 Markdown 链接 | 同上 + [legacy-boundaries.md](../../architecture/engineering/legacy-boundaries.md) |
| **AI 助手** | | [backend/ai.md](../backend/ai.md) |
| [ai-api-quota-store.test.js](../../../test/ai/ai-api-quota-store.test.js) | `ai/api-quota-store`（配额存储） | 同上 |
| [ai-config-store.test.js](../../../test/ai/ai-config-store.test.js) | `ai/config-store`（配置存储） | 同上 |
| [ai-danmaku-delivery-verifier.test.js](../../../test/ai/ai-danmaku-delivery-verifier.test.js) | `ai/danmaku-delivery-verifier`（投递校验） | 同上 |
| [ai-provider-adapters.test.js](../../../test/ai/ai-provider-adapters.test.js) | DeepSeek Chat/Responses 请求协议与 Provider 预设 | 同上 |
| [ai-provider-contracts.test.js](../../../test/ai/ai-provider-contracts.test.js) | Provider 错误、追踪、模型列表与连接校验契约 | 同上 |
| [ai-tools.test.js](../../../test/ai/ai-tools.test.js) | 时间、天气配额、地图与联网搜索工具契约 | 同上 |
| [ai-request-logger.test.js](../../../test/ai/ai-request-logger.test.js) | `ai/request-logger`（请求日志） | 同上 |
| [ai-routes.test.js](../../../test/ai/ai-routes.test.js) | `server/routes/ai-routes`（API 路由） | 同上 + [backend/api.md](../backend/api.md) |
| [frontend-admin-ai.test.js](../../../test/ai/frontend-admin-ai.test.js) | 前端不内置密钥、不可信文本不经 `innerHTML` | 同上 + [frontend/app.md](../frontend/app.md) |
| [frontend-admin-danmaku.test.js](../../../test/danmaku/frontend-admin-danmaku.test.js) | Admin 弹幕连接、发送与助手入口 | 同上 + [frontend/app.md](../frontend/app.md) |
| [frontend-admin-ai-settings.test.js](../../../test/ai/frontend-admin-ai-settings.test.js) | AI 配置自动保存、工具开关、过期回执和草稿保护 | [frontend/app.md](../frontend/app.md) |
| [frontend-admin-ai-providers.test.js](../../../test/ai/frontend-admin-ai-providers.test.js) | 账号登录、模型能力、服务商切换、密钥保留与提交 | [backend/ai.md](../backend/ai.md) |
| [frontend-admin-ai-personas.test.js](../../../test/ai/frontend-admin-ai-personas.test.js) | 角色选择、导入导出、保存与切换后的恢复 | [backend/ai.md](../backend/ai.md) |
| [ai-assistant-service.test.js](../../../test/ai/ai-assistant-service.test.js) | AI 触发、回复策略与本地安全 | 同上 |
| [ai-assistant-delivery.test.js](../../../test/ai/ai-assistant-delivery.test.js) | 顺序投递、分块节奏与房间回声重试 | 同上 |
| [ai-assistant-generation.test.js](../../../test/ai/ai-assistant-generation.test.js) | 生成预算、工具回合、复核阶段与官方聊天搜索 | 同上 |
| [ai-assistant-lifecycle.test.js](../../../test/ai/ai-assistant-lifecycle.test.js) | 关闭时中止直连 Provider 调用、排空与回复缓存失效 | 同上 |
| **Bilibili 弹幕/协议** | | [backend/bilibili/danmaku.md](../backend/bilibili/danmaku.md) |
| [bilibili-danmaku-send.test.js](../../../test/bilibili/bilibili-danmaku-send.test.js) | `bilibili/danmaku/api-client`（发弹幕） | 同上 |
| [bilibili-identity-cache.test.js](../../../test/bilibili/bilibili-identity-cache.test.js) | `bilibili/danmaku/identity-cache`（身份缓存） | 同上 |
| [bilibili-diagnostics.test.js](../../../test/bilibili/bilibili-diagnostics.test.js) | `bilibili/bilibili-message-handler`（消息日志格式） | 同上 |
| [bilibili-runtime.test.js](../../../test/bilibili/bilibili-runtime.test.js) | `server/bilibili-runtime` 的认证缓存、客户端替换与关闭生命周期 | [backend/server-core.md](../backend/server-core.md) |
| [bilibili-user-meta.test.js](../../../test/bilibili/bilibili-user-meta.test.js) | `bilibili/utils/user-meta-extractor`（用户信息提取） | 同上 |
| [daily-bot-commands.test.js](../../../test/bots/daily-bot-commands.test.js) | 签到/抽签参与弹幕命令过滤，区分命令与普通聊天 | 同上 |
| [daily-bot-takeover.test.js](../../../test/bots/daily-bot-takeover.test.js)、[daily-bot-frontend.test.js](../../../test/bots/daily-bot-frontend.test.js)、[daily-bot-editor-electron.test.js](../../../test/desktop/daily-bot-editor-electron.test.js) | 云端词库版本缓存、账号隔离、编辑/预览不请求、失败与并发草稿保留；隔离 Electron 验证正式 preload/IPC | [desktop/preload.md](../desktop/preload.md)、[frontend/app.md](../frontend/app.md) |
| [custom-reply-service.test.js](../../../test/bots/custom-reply-service.test.js) | 自定义回复匹配、内置命令优先及云端独占接线 | 同上 |
| [fixed-reply-frontend.test.js](../../../test/bots/fixed-reply-frontend.test.js) | 固定回复编辑器的保存与重试、刷新与并发修改时的草稿保留 | [frontend/app.md](../frontend/app.md) |
| [danmaku-client.test.js](../../../test/danmaku/danmaku-client.test.js) | `bilibili/danmaku-client`（主客户端） | 同上 |
| [danmaku-sender-service.test.js](../../../test/danmaku/danmaku-sender-service.test.js) | `bilibili/danmaku/sender-service`（弹幕发送服务） | 同上 |
| [message-deduplicator.test.js](../../../test/bilibili/message-deduplicator.test.js) | `bilibili/danmaku/message-deduplicator`（去重） | 同上 |
| [packet-decoder.test.js](../../../test/bilibili/packet-decoder.test.js) | `bilibili/parsers/packet-decoder`（恶意/损坏数据包边界） | [backend/bilibili/protocol.md](../backend/bilibili/protocol.md) |
| [bilibili-websocket-connection.test.js](../../../test/bilibili/bilibili-websocket-connection.test.js) | `bilibili/danmaku/websocket-connection`（WS 连接） | 同上 |
| **礼物** | | [backend/bilibili/gift.md](../backend/bilibili/gift.md) |
| [capture-bilibili-events.test.js](../../../test/bilibili/capture-bilibili-events.test.js) | `scripts/capture-bilibili-events`（捕获工具，见 §5） | 同上 |
| [gift-analysis-service.test.js](../../../test/gifts/gift-analysis-service.test.js) | 盲盒统计、筛选与分页（固定本地日期） | 同上 |
| [gift-audit-page.test.js](../../../test/gifts/gift-audit-page.test.js) | 礼物审计页离线解析与比对（匹配、漏记、仅服务端） | 同上 + [frontend/pages.md](../frontend/pages.md) |
| [gift-projection-service.test.js](../../../test/gifts/gift-projection-service.test.js) | `bilibili/gift`（服务器结果投影与下游重试） | 同上 |
| [gift-diagnostics-wiring.test.js](../../../test/gifts/gift-diagnostics-wiring.test.js) | preload 礼物展示兼容通道与服务端礼物入口不写第二本地账本 | 同上 + [desktop/main.md](../desktop/main.md) |
| [gift-effect-config.test.js](../../../test/gifts/gift-effect-config.test.js) | 礼物特效配置拉取、缓存、URL 信任边界与事件构造 | 同上 |
| [gift-effects-overlay.test.js](../../../test/gifts/gift-effects-overlay.test.js) | 礼物特效 API、管理工具、透明直播叠加层与其重连策略 | 同上 + [frontend/overlays.md](../frontend/overlays.md) |
| [bilibili-superchat.test.js](../../../test/bilibili/bilibili-superchat.test.js) | `bilibili/danmaku/message-handlers`（SC 接收、解析与日志） | 同上 |
| [bilibili-likes.test.js](../../../test/bilibili/bilibili-likes.test.js) + [bilibili-likes-api.test.js](../../../test/server/bilibili-likes-api.test.js) | 客户端点赞总数覆盖、开下播清理、两层 API 上下文与本机管理读取授权 | [backend/bilibili/danmaku.md](../backend/bilibili/danmaku.md) + [backend/api.md](../backend/api.md) |
| [bilibili-gift-identity-hints.test.js](../../../test/bilibili/bilibili-gift-identity-hints.test.js) | `bilibili/users/gift-identity-hints`（发送者与舰队身份提示） | 同上 |
| [gift-query-service.test.js](../../../test/gifts/gift-query-service.test.js) | 礼物历史查询、搜索、排序、游标分页与来源边界 | 同上 + [backend/storage.md](../backend/storage.md) |
| [gift-statistics-service.test.js](../../../test/gifts/gift-statistics-service.test.js) | 礼物金额、指标、月份分桶与聚合失败 | 同上 + [backend/storage.md](../backend/storage.md) |
| [processed-gift-import.test.js](../../../test/gifts/processed-gift-import.test.js) | 已处理礼物的历史与实时投影入库、捕获来源与传输隐私（离线） | 同上 + [backend/storage.md](../backend/storage.md) |
| [processed-gift-import-atomicity.test.js](../../../test/gifts/processed-gift-import-atomicity.test.js) | 暂停、清空代次与完整重放回滚 | 同上 + [backend/storage.md](../backend/storage.md) |
| [processed-gift-contract.test.js](../../../test/gifts/processed-gift-contract.test.js) | 服务器样例：规范化、分页传输格式契约、协商身份重新绑定与盲盒产物 | 同上 |
| [remote-catalog-cache.test.js](../../../test/gifts/remote-catalog-cache.test.js) | 远端目录缓存、ETag、关系/替换保留、32 MiB 容量、落盘回退与停止生命周期 | 同上 |
| [remote-catalog-contract.test.js](../../../test/gifts/remote-catalog-contract.test.js) | 远端目录 v2 规范化、图片来源与布尔契约 | 同上 |
| [hybrid-gift-catalog.test.js](../../../test/gifts/hybrid-gift-catalog.test.js) | 房间优先合并、关系过滤与服务不可用搜索 | 同上 |
| [remote-gift-controller.test.js](../../../test/gifts/remote-gift-controller.test.js) | 远端礼物历史初始化、历史能力、代次与游标校验 | 同上 + [desktop/main.md](../desktop/main.md) |
| [remote-gift-controller-sse.test.js](../../../test/gifts/remote-gift-controller-sse.test.js) | SSE 关闭、发现重试、即时投影、传输格式校验与顺序补拉 | 同上 + [desktop/main.md](../desktop/main.md) |
| [remote-gift-controller-reconciliation.test.js](../../../test/gifts/remote-gift-controller-reconciliation.test.js) | 静默补拉、停止/授权失效、退避与在途隔离 | 同上 + [desktop/main.md](../desktop/main.md) |
| **音乐服务** | | [backend/music/services.md](../backend/music/services.md) |
| [lyrics.test.js](../../../test/lyrics/lyrics.test.js) | `music/lyric-parser`（歌词解析） | 同上 |
| [netease-provider.test.js](../../../test/music/netease-provider.test.js) | `music/providers/netease-provider` | [backend/music/netease-provider.md](../backend/music/netease-provider.md) |
| [qq-provider.test.js](../../../test/music/qq-provider.test.js) | `music/providers/qq-provider`（歌单、电台与最近播放） | [backend/music/qq-provider.md](../backend/music/qq-provider.md) |
| [qq-provider-streams.test.js](../../../test/music/qq-provider-streams.test.js) | `music/providers/qq-provider-streams`（播放权益、音质与歌词） | 同上 |
| [music-stream-route.test.js](../../../test/music/music-stream-route.test.js) | `server/routes/music-routes`（播放地址令牌与错误映射） | 同上 |
| [song-cooldown.test.js](../../../test/songs/song-cooldown.test.js) | 单首歌曲冷却、北京时间跨日、原子写入、账号隔离、随机过滤与回复 | [backend/music/services.md](../backend/music/services.md) |
| [queue-service.test.js](../../../test/songs/queue-service.test.js) | `music/queue-service`（点歌队列） | 同上 |
| [random-song-filter.test.js](../../../test/songs/random-song-filter.test.js) | `music/random-song-filter`（随机筛选） | 同上 |
| [song-file-codec.test.js](../../../test/songs/song-file-codec.test.js) | `music/song-file-codec`（文件编码） | 同上 |
| [song-request-autocomplete.test.js](../../../test/songs/song-request-autocomplete.test.js) | `music/song-service`（歌单补全） | 同上 |
| [tag-aliases.test.js](../../../test/songs/tag-aliases.test.js) | `music/tag-aliases`（标签别名） | 同上 |
| **全民 K 歌** | | [backend/music/wesing.md](../backend/music/wesing.md) |
| [wesing-native-audio.test.js](../../../test/wesing/wesing-native-audio.test.js) | Windows 原生合成多设备/会话、进程过滤、活跃状态合并、故障隔离 | 同上 |
| [wesing-diagnostics.test.js](../../../test/wesing/wesing-diagnostics.test.js) / [playback-wesing-diagnostics.test.js](../../../test/playback/playback-wesing-diagnostics.test.js) | 按需诊断的有界采样、状态分类、停止清理、字段白名单与界面去重保存 | 同上 |
| [wesing-capture.test.js](../../../test/wesing/wesing-capture.test.js) | 采集门面、本地日志/QRC 解码与缓存目录 | 同上 |
| [wesing-capture-timing.test.js](../../../test/wesing/wesing-capture-timing.test.js) | 激活、进度门控、暂停、校准、重载与监控错误时序 | 同上 |
| [wesing-capture-refresh.test.js](../../../test/wesing/wesing-capture-refresh.test.js) | 在线回退与退避、延迟 QRC、缓存迁移和歌词偏移 | 同上 |
| [wesing-capture-recording-mode.test.js](../../../test/wesing/wesing-capture-recording-mode.test.js) | `music/wesing-capture`（录制模式） | 同上 |
| [wesing-online-lyrics.test.js](../../../test/wesing/wesing-online-lyrics.test.js) | `music/wesing-online-lyrics`（在线歌词） | 同上 |
| [wesing-playback-diagnostic.test.js](../../../test/wesing/wesing-playback-diagnostic.test.js) | `scripts/inspect-wesing-playback`（诊断脚本，见 §4） | 同上 |
| [wesing-routes.test.js](../../../test/wesing/wesing-routes.test.js) | `server/routes`（WeSing API 路由） | 同上 + [backend/api.md](../backend/api.md) |
| **加班机** | | [backend/overtime.md](../backend/overtime.md) |
| [overtime-service.test.js](../../../test/overtime/overtime-service.test.js) | 加班机 schema 迁移与恢复暂停/重载 | 同上 |
| [overtime-state.test.js](../../../test/overtime/overtime-state.test.js) | 单调计时、重启与状态校验 | 同上 |
| [overtime-state-failures.test.js](../../../test/overtime/overtime-state-failures.test.js) | 状态动作保存失败矩阵 | 同上 |
| [overtime-rules.test.js](../../../test/overtime/overtime-rules.test.js) | 固定、分组、单项、随机与效果规则 | 同上 |
| [overtime-settlement.test.js](../../../test/overtime/overtime-settlement.test.js) | 待结算代次、补偿、回滚/重试、清空与身份重放 | 同上 |
| [frontend-overtime.test.js](../../../test/overtime/frontend-overtime.test.js) | Admin 加班机控制台与规则编辑器 | 同上 + [frontend/app.md](../frontend/app.md) |
| [overtime-routes.test.js](../../../test/overtime/overtime-routes.test.js) | `server/routes`（加班机 API） | 同上 + [backend/api.md](../backend/api.md) |
| [overtime-gift-picker.test.js](../../../test/overtime/overtime-gift-picker.test.js) | 加班机选礼器身份、搜索与选择行为 | 同上 + [frontend/app.md](../frontend/app.md) |
| [overtime-gift-picker-contract.test.js](../../../test/overtime/overtime-gift-picker-contract.test.js) | 加班机选礼器角色与同 ID 身份（服务器样例） | 同上 + [frontend/app.md](../frontend/app.md) |
| [overtime-rule-editor-browser.test.js](../../../test/overtime/overtime-rule-editor-browser.test.js) | 加班规则新增、重选、读回及输入法组合校验 | 同上 + [frontend/app.md](../frontend/app.md) |
| [overtime-overlay.test.js](../../../test/overtime/overtime-overlay.test.js) | `public/pages/overlays/overtime.html` + js/css（叠加层） | 同上 + [frontend/pages.md](../frontend/pages.md) |
| [overtime-overlay-runtime.test.js](../../../test/overtime/overtime-overlay-runtime.test.js) | 叠加层规则说明与按显示边界刷新的时钟（浏览器） | 同上 + [frontend/pages.md](../frontend/pages.md) |
| [overtime-status-view.test.js](../../../test/overtime/overtime-status-view.test.js) | 管理页时钟按显示边界刷新，加减时、暂停、隐藏恢复及跨天 | [frontend/app.md](../frontend/app.md) |
| **服务器核心** | | [backend/server-core.md](../backend/server-core.md) |
| [admin-page-composition.test.js](../../../test/admin/admin-page-composition.test.js) | Admin HTML 分片组合顺序、完整性及禁止注入管理令牌 | 同上 + [frontend/pages.md](../frontend/pages.md) |
| [server-lifecycle.test.js](../../../test/server/server-lifecycle.test.js) | `server/lifecycle`（端口与生命周期） | 同上 |
| [server-modules.test.js](../../../test/server/server-modules.test.js) | 服务兼容层与 API 上下文模块边界 | 同上 |
| [server-smoke.test.js](../../../test/server/server-smoke.test.js) | `src/server`（端到端冒烟） | 同上 + [backend/api.md](../backend/api.md) |
| [module-boundaries.test.js](../../../test/engineering/module-boundaries.test.js) | 依赖方向与循环、SQL/DOM/全局注册表边界、叠加层连接、工具回流与空 catch 债务 | [modularity-standard.md](../../architecture/engineering/modularity-standard.md) |
| [websocket-transport.test.js](../../../test/transport/websocket-transport.test.js) | `server/ws`（WS 传输） | [backend/ws.md](../backend/ws.md) |
| **桌面层** | | 见各列 |
| [bilibili-login-window.test.js](../../../test/bilibili/bilibili-login-window.test.js) | `electron/bilibili-login-window`（登录窗口） | [desktop/auth.md](../desktop/auth.md) |
| [bilibili-startup-wiring.test.js](../../../test/bilibili/bilibili-startup-wiring.test.js) | `electron/cloud-sync-controller`（取消登录不上传，登录成功上传凭据） | [desktop/main.md](../desktop/main.md) |
| [desktop-lyrics.test.js](../../../test/lyrics/desktop-lyrics.test.js) | 桌面歌词浏览器源状态与时间轴规范化 | [frontend/playback.md](../frontend/playback.md) + [frontend/overlays.md](../frontend/overlays.md) |
| [desktop-lyric-settings.test.js](../../../test/lyrics/desktop-lyric-settings.test.js) | 歌词比例控件换算与颜色透明度应用 | [frontend/app.md](../frontend/app.md) + [frontend/overlays.md](../frontend/overlays.md) |
| [desktop-lyric-settings-runtime.test.js](../../../test/lyrics/desktop-lyric-settings-runtime.test.js) | 字体权限、设置预览与自动保存 | 同上 |
| [desktop-lyric-fonts-browser.test.js](../../../test/lyrics/desktop-lyric-fonts-browser.test.js) | 多语言字体实际命中、常规/加粗补字与离线按需加载 | 同上 |
| [desktop-lyric-layout-browser.test.js](../../../test/lyrics/desktop-lyric-layout-browser.test.js) | 用户选定对齐、逐字高亮及独立颜色设置的应用 | 同上 |
| [desktop-lyric-publication.test.js](../../../test/lyrics/desktop-lyric-publication.test.js) | 授权发布、顺序、调度器与共享时钟 | [frontend/playback.md](../frontend/playback.md) + [frontend/overlays.md](../frontend/overlays.md) |
| [desktop-lyric-renderer.test.js](../../../test/lyrics/desktop-lyric-renderer.test.js) | 当前行、卡拉 OK 模式、连写文字完整性、隐藏时不重启动画与可见行渲染 | 同上 |
| [license-manager-operations.test.js](../../../test/license/license-manager-operations.test.js) | 歌曲、背景、目录、礼物与渲染器边界的受保护操作 | [desktop/auth.md](../desktop/auth.md) |
| [license-manager-renewal.test.js](../../../test/license/license-manager-renewal.test.js) | 授权启动引导、续期、撤销、心跳与暂时性受保护失败 | 同上 |
| [license-manager-revalidation.test.js](../../../test/license/license-manager-revalidation.test.js) | 云读取、共享重验证、代次、销毁与挑战竞态 | 同上 |
| [license-manager-identity.test.js](../../../test/license/license-manager-identity.test.js) | 跨账号迟到请求、ABA 切换、续期与心跳生命周期隔离 | 同上 |
| [remote-license-client.test.js](../../../test/license/remote-license-client.test.js) | 远端授权 HTTP 请求、错误与脱敏契约 | 同上 |
| [remote-license-response-budget.test.js](../../../test/license/remote-license-response-budget.test.js) | 远端响应体上限与歌库 8 MiB 精确字节边界、UTF-8、超限流取消与不可重试错误 | 本文 §1 两仓歌库往返回归 |
| [remote-license-event-stream.test.js](../../../test/license/remote-license-event-stream.test.js) | 远端授权 SSE 分块、取消与 reader 释放 | 同上 |
| [desktop-resource-integrity.test.js](../../../test/desktop/desktop-resource-integrity.test.js) | 资源完整性 IPC 的窗口、来源与路径校验 | [desktop/main.md](../desktop/main.md) |
| [desktop-update-controller.test.js](../../../test/desktop/desktop-update-controller.test.js) | 自动更新设置读取、状态推送、错误与安装前排空 | [desktop/main.md](../desktop/main.md) |
| [electron-main-modules.test.js](../../../test/desktop/electron-main-modules.test.js) | Electron 运行时适配、本地字体权限、`safeStorage` 注入与礼物同步装配 | [desktop/main.md](../desktop/main.md) |
| [local-media-access.test.js](../../../test/desktop/local-media-access.test.js) | `electron/local-media-access`（`local-media://` 协议授权与字节范围） | [desktop/main.md](../desktop/main.md) |
| [playback-flush.test.js](../../../test/playback/playback-flush.test.js) | `electron/playback-flush`（播放状态落盘） | [backend/storage.md](../backend/storage.md) + [desktop/main.md](../desktop/main.md) |
| [terminal-log.test.js](../../../test/desktop/terminal-log.test.js) | `electron/terminal-log`（终端日志） | [desktop/main.md](../desktop/main.md) |
| [update-manager.test.js](../../../test/desktop/update-manager.test.js) | `electron/update-manager`（自动更新） | [desktop/update.md](../desktop/update.md) |
| **存储** | | [backend/storage.md](../backend/storage.md) |
| [cooldown-store.test.js](../../../test/songs/cooldown-store.test.js) | 冷却 Map 的过期剪枝 | 同上 |
| [database-maintenance.test.js](../../../test/storage/database-maintenance.test.js) | 歌库/礼物库旧版本迁移、v3→v4 投影列与身份去重、初始化失败释放句柄 | 同上 |
| [playback-snapshot-ordering.test.js](../../../test/playback/playback-snapshot-ordering.test.js) | `storage/playback-store`（播放快照顺序、写入代次与播放历史） | 同上 |
| [superchat-store.test.js](../../../test/gifts/superchat-store.test.js) | `storage/superchat-store` 的 SQLite 映射与领域对象契约 | 同上 |
| **前端** | | 见各列 |
| [esm-module-boundaries.test.js](../../../test/engineering/esm-module-boundaries.test.js) | `public/js/` ESM 未声明标识符审计及全部模块的真实 import/re-export 链接检查 | [frontend/app.md](../frontend/app.md) |
| [frontend-admin-toolbox.test.js](../../../test/admin/frontend-admin-toolbox.test.js) | 硬件指标不可用与零负载显示、桌面更新入口 | 同上 |
| [frontend-usage-guide-search-browser.test.js](../../../test/admin/frontend-usage-guide-search-browser.test.js) | 正文定位、折叠内容展开、高亮清理与内部链接唯一目标 | [frontend/pages.md](../frontend/pages.md) |
| [text-box-editor.test.js](../../../test/admin/text-box-editor.test.js)、[text-box-electron.test.js](../../../test/desktop/text-box-electron.test.js) | 浏览器覆盖连续格式切换与 DOM 不累积；Electron 验证输入、撤销、保存发布与重开 | [frontend/pages.md](../frontend/pages.md) |
| [frontend-admin-runtime.test.js](../../../test/admin/frontend-admin-runtime.test.js) | 异步主题数据加载与表单编辑保护 | 同上 |
| [frontend-parameter-range.test.js](../../../test/ui/frontend-parameter-range.test.js) | 通用滑块值映射、指针操作、重复绑定与监听释放 | [frontend/app.md](../frontend/app.md) |
| [frontend-gifts.test.js](../../../test/gifts/frontend-gifts.test.js) | 礼物工作区与摘要契约 | [frontend/app.md](../frontend/app.md) |
| [frontend-gift-history.test.js](../../../test/gifts/frontend-gift-history.test.js) | 礼物历史抽屉、查询、排序与分页 UI | 同上 |
| [frontend-blindbox-admin.test.js](../../../test/gifts/frontend-blindbox-admin.test.js) | 盲盒管理与配置 UI | 同上 |
| [frontend-blindbox-mapping-state.test.js](../../../test/gifts/frontend-blindbox-mapping-state.test.js) | 盲盒映射状态与本地编辑 | 同上 |
| [frontend-blindbox-mapping-refresh.test.js](../../../test/gifts/frontend-blindbox-mapping-refresh.test.js) | 盲盒映射刷新与目录更新 | 同上 |
| [frontend-blindbox-overlay.test.js](../../../test/gifts/frontend-blindbox-overlay.test.js) | 盲盒浏览器源渲染 | [frontend/overlays.md](../frontend/overlays.md) |
| [frontend-recent-gifts.test.js](../../../test/gifts/frontend-recent-gifts.test.js) | 近期礼物卡片、图像与目录事件 | [frontend/app.md](../frontend/app.md) |
| [frontend-playback.test.js](../../../test/playback/frontend-playback.test.js) | 全屏歌词、收藏分页与播放搜索竞态 | [frontend/playback.md](../frontend/playback.md) |
| [frontend-queue.test.js](../../../test/songs/frontend-queue.test.js) | 队列快照重绘、主题控件与样式字段映射。旧排版和滚动设置的启动迁移见 [settings-bootstrap.test.js](../../../test/settings/settings-bootstrap.test.js) | [frontend/overlays.md](../frontend/overlays.md) |
| [frontend-queue-scrolling.test.js](../../../test/songs/frontend-queue-scrolling.test.js) | 经典版与身份版列表溢出滚动、身份版歌名溢出与缩放后的循环副本清理 | 同上 |
| [danmaku-overlay.test.js](../../../test/danmaku/danmaku-overlay.test.js) | 固定弹幕整合与连接状态 | 同上 |
| [danmaku-feed-motion.test.js](../../../test/danmaku/danmaku-feed-motion.test.js) | 公共消息流按方向、缩放和打断场景验证移动、淘汰与销毁。固定样式在同一浏览器页面逐款新建消息流，检查各自 CSS 对快照入场、行间距和减弱动态效果的影响 | [固定弹幕动效](../frontend/danmaku-motion.md) |
| [danmaku-glowy-browser.test.js](../../../test/danmaku/danmaku-glowy-browser.test.js)、[danmaku-neon-glass-browser.test.js](../../../test/danmaku/danmaku-neon-glass-browser.test.js) | 两款弹幕在真实浏览器中的入场、排列、公共透视、配置更新与 SC 撤回（`browser` 组） | [固定弹幕动效](../frontend/danmaku-motion.md) |
| [danmaku-message-renderer.test.js](../../../test/danmaku/danmaku-message-renderer.test.js) | 直接渲染单条消息，检查昵称与 SC 原文、表情回退、图片解析、礼物结算金额及各款特有的呈现 | [frontend/overlays.md](../frontend/overlays.md) |
| [danmaku-style-options.test.js](../../../test/danmaku/danmaku-style-options.test.js)、[component-style-parameters.test.js](../../../test/scenes/component-style-parameters.test.js) | 前者验证已存样式字段和 SC 支持范围，后者验证跨组件共用效果的编辑与校验 | 同上 |
| [danmaku-appearance.test.js](../../../test/danmaku/danmaku-appearance.test.js)、[danmaku-layout.test.js](../../../test/danmaku/danmaku-layout.test.js) | 本机账号配置验证迁移、隔离、保存和重启恢复。布局兼容用最早的九个必需区域构造旧数据，检查后来加入的区域能否自动补齐 | 同上 |
| [danmaku-entry-display.test.js](../../../test/danmaku/danmaku-entry-display.test.js)、[danmaku-overlay-renderer.test.js](../../../test/danmaku/danmaku-overlay-renderer.test.js) | 场景入口按当前直播场次和样式转发消息及撤回。消息流验证快照、增量、节点保留、裁剪和到期清理 | 同上 |
| [danmaku-overlay-fullscreen.test.js](../../../test/danmaku/danmaku-overlay-fullscreen.test.js) | 全屏随机位置、计时、预览与时间戳 | 同上 |
| [opening-overlay.test.js](../../../test/overlays/opening-overlay.test.js) | 开场动画管理设置与直播画面展示 | 同上 |
| [opening-upload-api.test.js](../../../test/overlays/opening-upload-api.test.js) | 开场媒体上传、鉴权与静态提供 | 同上 + [backend/api.md](../backend/api.md) |
| [frontend-song-board.test.js](../../../test/songs/frontend-song-board.test.js) | 歌单展示板字号、视口与滚动速度 | [frontend/pages.md](../frontend/pages.md) |
| [playback-cache.test.js](../../../test/playback/playback-cache.test.js) | `public/js`（个人歌单缓存 `CacheManager`） | [frontend/playback.md](../frontend/playback.md) |
| [playback-persistence.test.js](../../../test/playback/playback-persistence.test.js) | 播放队列、进度、Provider 与关闭冲刷持久化 | 同上 + [backend/storage.md](../backend/storage.md) |
| [playback-provider-operations.test.js](../../../test/playback/playback-provider-operations.test.js) | 音源切换后的登录归属、健康检查与通知更新 | 同上 |
| [playback-queue-behavior.test.js](../../../test/playback/playback-queue-behavior.test.js) | 歌单、电台、搜索直播与历史队列行为 | 同上 |
| [playback-wesing.test.js](../../../test/playback/playback-wesing.test.js) | `public/js`（播放器全民 K 歌集成） | 同上 |
| [provider-manager.test.js](../../../test/playback/provider-manager.test.js) | `public/js`（Provider 状态管理） | [frontend/pages.md](../frontend/pages.md) |
| [queue-overlay-esm.test.js](../../../test/songs/queue-overlay-esm.test.js) | 队列叠加层真实 ESM 依赖图与渲染路径 | [frontend/overlays.md](../frontend/overlays.md) |
| [song-library-filter.test.js](../../../test/songs/song-library-filter.test.js) | 歌单筛选界面与 `music/song-service`、`storage/song-store`（内存 SQLite） | 同上 + [backend/storage.md](../backend/storage.md) |
| [toolbox-sidebar-preferences.test.js](../../../test/admin/toolbox-sidebar-preferences.test.js) | 侧栏持久偏好恢复与旧缓存迁移 | 同上 |
| [toolbox-sidebar-routing.test.js](../../../test/admin/toolbox-sidebar-routing.test.js) | 导航接线与折叠分组偏好持久化 | 同上 |
| [streamer-planner.test.js](../../../test/admin/streamer-planner.test.js) | `public/js`（工具箱待办） | 同上 |

### 重点测试夹具与隔离说明

- **电音助手原生与桌面测试**
  - `test/admin/audio-assistant*.test.js` 覆盖入口与连续参数保存。按“开始”时会等待本批保存请求，任一请求失败都会阻止当次启动，后续独立编辑仍可保存。`test/desktop/audio-assistant*.test.js` 覆盖 IPC 来源、输入授权、进程复用和退出。
  - `npm run test:audio-native` 默认验证 C# 音频核心与真实管道，播放检查会逐个打开枚举到的非 ASIO 输出并写入静音 PCM。原生测试源码位于 `test/desktop/audio-assistant-native/`，中间产物与状态在 `tmp/`。其中 `InstallationExitChecks.cs` 验证安装退出事件与延期记录跨进程接管。仅使用合成输入输出时，见[原生音频与状态帧验证命令](../../../native/audio-assistant/README.md#验证)。
- **周表生成器与导出**：[weekly-schedule-model.test.js](../../../test/admin/weekly-schedule-model.test.js) 与 [weekly-schedule-storage.test.js](../../../test/admin/weekly-schedule-storage.test.js) 覆盖日期、模板隔离与写入顺序；[weekly-schedule-export.test.js](../../../test/desktop/weekly-schedule-export.test.js) 覆盖参数校验、重试、取消与文件/窗口生命周期；[weekly-schedule-electron.test.js](../../../test/desktop/weekly-schedule-electron.test.js)（`desktop` 组）在隔离 Electron 环境下验证真实 preload、IndexedDB、图片编辑保存与 1920×1080 四角像素标记（版式可读性仍需人工查看）。
- **外置样式包与网页组件导入**：[woodland-style-package.test.js](../../../test/scenes/woodland-style-package.test.js) 覆盖 ZIP 校验/导入、哈希与旧媒体 URL Range/HEAD 兼容；[woodland-style-import-electron.test.js](../../../test/desktop/woodland-style-import-electron.test.js)（`desktop` 组）在隔离 Electron 中验证真实导入与画布重载；[component-web-import.test.js](../../../test/scenes/component-web-import.test.js) 注入包目录暂态锁与索引提交失败，验证安装前允许锁重试但禁止索引失败后重放安装。
- **豆包会话夹具**：豆包会话的 Electron 测试夹具保持窗口隐藏并拦截 `show()` / `focus()`，避免发布验证弹窗抢焦点，同时保留真实会话、加密存储与导航限制校验。

## 3. 静态检查：`npm run check`

- **命令**：`npm run check` → `node scripts/check-js.js`（[package.json](../../../package.json)）。
- **行为**：[check-js.js](../../../scripts/check-js.js) 递归收集 `src/`、`public/`、`scripts/`、`test/`、`tools/` 下全部 `.js`、`.cjs`、`.mjs` 文件，逐文件比对文件内容、所属 `package.json` 的模块类型配置、当前 Node 版本以及检查脚本本身，仅对缓存未命中或已变动的文件执行原生 `node --check`（最多 4 个并发子进程）。应用版本号变化不单独使缓存失效；检查失败即停止派发新文件并返回非零。
- **参数与锁**：`--plan` 仅列出待检查文件，`--force` 清除旧记录强制全查。缓存与互斥锁位于 `tmp/verification/`，拒绝 `NODE_OPTIONS` 和父进程 Node flags，异常退出后校验锁中 PID 已停止再移除锁。
- **边界**：**仅查语法**，不做类型检查、模块导入一致性或代码风格检查。日常按根目录 [AGENTS.md](../../../AGENTS.md) 风险分级选择对应检查，输入未变时不重复执行。

## 4. 专用诊断：`diagnose:wesing`

- **命令**：`npm run diagnose:wesing` → `node scripts/inspect-wesing-playback.js`（Windows 便捷入口 [scripts/inspect-wesing-playback.cmd](../../../scripts/inspect-wesing-playback.cmd)）。
- **用途**：现场诊断全民 K 歌播放状态识别问题。同时采集 PowerShell 窗口采样（`createPowerShellWeSingMonitor`，250ms 轮询）与 WeSingCache 日志增量（UTF-16LE，解析 `StartKSong` 提取 `mid`/歌名）。日志偏移与刷新由 [wesing-log-probe.js](../../../scripts/wesing-log-probe.js) 管理，[wesing-diagnostic-terminal.js](../../../scripts/wesing-diagnostic-terminal.js) 管理终端键盘监听的初始化与清理。
- **交互与落盘**：运行时按键打标（`1` 开始录制、`2` 暂停、`3` 继续、`4` 退出录制、`5` 重进同曲、`6` 歌词异常，`q`/Ctrl+C 结束），输出 JSONL 至 `tmp/wesing-playback-diagnostic-{时间戳}.jsonl`。
- **参数**：`--cache <WeSingCache 目录>`（缺省从 `/api/music/wesing/status` 读取）、`--output <文件>`、`--duration <秒>`（1–3600）、`--help`。
- **配套测试**：[wesing-playback-diagnostic.test.js](../../../test/wesing/wesing-playback-diagnostic.test.js)、[wesing-diagnostic-resources.test.js](../../../test/wesing/wesing-diagnostic-resources.test.js)（数据流见 [backend/music/wesing.md](../backend/music/wesing.md)）。

## 5. 其他辅助脚本

- **[scripts/capture-bilibili-events.js](../../../scripts/capture-bilibili-events.js)**：独立事件捕获工具，默认写入 `tmp/bilibili-events-{时间戳}.ndjson`（`meta.formatVersion=2`，保留 `receivedAt`/`cmd`/`data` 并附加完整 `message`）。
  - 参数：`--room <房间号>`（必填）、`--duration <秒>`（默认 300）、`--output <路径>`、`--gift-only`、`--bilibili-user-data <Electron userData>`，另支持 `BILIBILI_COOKIE` / `BILIBILI_UID`。
  - 限额：最多 10,000 条事件、16 MiB 输出（为 `summary` 预留 64 KiB）、1 MiB 待写缓冲，文件以 `wx` 创建防覆盖，断线即结束不自动重连。写入或关闭失败直接报错，不能把不完整的输出视为成功（解码丢弃原因见 [协议 §4.5](../backend/bilibili/protocol.md#45-帧解析与解压)）。
  - 登录态捕获经 [scripts/bilibili-capture-electron/index.js](../../../scripts/bilibili-capture-electron/index.js) 复用桌面会话；采样保留原始 UID、昵称与正文，**不做匿名化**。测试见 [capture-bilibili-events.test.js](../../../test/bilibili/capture-bilibili-events.test.js)（即使捕获过程零报错，也不能说明断线期间未丢失消息）。
- **独立 Electron 界面验证脚本**：[verify-gift-export.cjs](../../../scripts/verify-gift-export.cjs)、[verify-gift-history.cjs](../../../scripts/verify-gift-history.cjs)、[verify-overlay-filters.cjs](../../../scripts/verify-overlay-filters.cjs) 与 [verify-welcome-settings.cjs](../../../scripts/verify-welcome-settings.cjs) 将产物与临时配置保存在 `tmp/`（可用 `LIRA_VERIFY_OUTPUT_DIR` 指定父目录）。过滤器与欢迎检查通过现有的管理页片段组合器加载对应组件、工具箱片段及公共弹窗，使用隔离合成数据、随机本地端口与真实 preload/IPC；`verify-gift-history.cjs` 挂载 `toolbox/gift.html` 验证 `scrollSpeed` 保存与 72px 单行画面（可选桌面验收，不在发布自动门禁内）。

## 6. 测试约定

- **命名与布局**：按 §1 业务职责放置于 `test/<领域>/xxx.test.js`，`test/helpers/` 存放共享辅助模块，`test/fixtures/` 存放隔离样例与显式探针（单文件及筛选命令见 §1）。
- **隔离与加载**：真实被测业务逻辑必须参与；替身仅用于隔离外部依赖，测试间不共享可变状态。按待验证行为选择最轻量的运行时（纯函数/Node → VM → 浏览器 → Electron），语法检查覆盖 `test/`（§3）。

### 何时新增或修改测试

按故障后果、独立检测价值和维护成本决定是否保留或新增自动化：**故障值得防护，现有检查不足，且新增信心值得维护成本**，才补最小覆盖。能设想一种错误或规范写了一个值，本身不足以证明需要测试。默认不为每个文件、函数、字段、控件或修复配一条用例；低风险且容易通过代码审查或针对性查看发现的问题可以直接不测。

| 改动或场景 | 处理原则 |
| --- | --- |
| 属于 [不新增的测试与断言](#不新增的测试与断言) 所列类别 | 不新增用例或断言，需要确认效果时做针对性查看；只在该节「例外」成立时写最小断言 |
| 函数改名、文件移动、DOM 包裹层变化等内部调整（外部行为不变） | 沿用有效行为测试；被无关内部细节牵动时收窄夹具或断言，不为新结构增加镜像检查 |
| 已有覆盖足够，或现有证据足以确认的简单修复 | 复用相关检查，不因「修了一个问题」「改了一个文件」再新增用例 |
| 业务计算、校验、状态流转、异常恢复、权限、协议、持久化、并发、资源生命周期存在具体覆盖缺口 | 在所属模块补最小有效覆盖；同一行为优先修改已有用例，独立失败方式分别保留 |
| 外观设置保存/恢复、用户指定字号/颜色准确应用、拖拽坐标、导出尺寸，或遮挡/溢出造成操作和信息丢失 | 验证对应功能结果、可访问性或明确边界，不附带锁定默认排版与装饰样式 |

同一用户行为可在一个场景中验证连续步骤，不按内部函数拆成微型测试；移除低价值测试不要求逐条另建替代测试，测试总数与覆盖率不设硬指标。

### 不新增的测试与断言

下表各类默认不新增用例，也不往已有用例里追加断言；只有「例外」栏的功能结果成立时才写最小断言（已有测试中的同类断言按 [断言的取舍](#断言的取舍) 清理）。

| 类别 | 不新增 | 例外：保留最小断言 |
| --- | --- | --- |
| 界面文案 | 标题、按钮、标签、占位、提示、toast、状态与错误说明、计数的原文与位置 | 需要区分结果时，断言失败提示不同于成功提示或过期值不出现，不写两段原文；不可信文本按纯文本显示 |
| 显隐与控件清单 | 普通控件的显隐、禁用与排列；静态页面的 ID、按钮、标签与默认选项清单；图标、class、`data-*`、CSS 变量等装饰 | 显隐或禁用本身阻止数据丢失或危险操作（如未加载完成禁保存、破坏性操作需确认）；必要的整体页面组合检查保留一次 |
| 排版与动效 | 布局、尺寸、间距、颜色、圆角、阴影、字体度量、层级、断点、滚动偏移，以及动画曲线、时长与帧位置的数值、源码断言或截图快照 | 溢出或遮挡造成信息丢失或无法操作；明确的导出尺寸与拖拽坐标；用户设置的字号、颜色准确应用；长驻画面的定时器、RAF 与监听清理 |
| 源码扫描 | 读取 `src/`、`public/` 后断言包含某字符串、函数名、选择器或 CSS 规则 | IPC 来源校验、Electron 安全开关、CSP、凭据、路径穿越、危险 API，以及 `test/engineering/` 的架构与文档门禁 |
| 默认值快照 | 完整默认配置或设置对象；默认颜色、尺寸、字体、时长、文案与选项列表 | 已持久化或跨版本兼容的设置键与默认值 |
| 整体比较 | 场景只关心少数字段时，对整个对象、数组、请求体、日志、HTML 或调用序列做 `deepEqual` 或快照 | 完整输出本身就是协议、持久化或导出契约 |
| 等价输入 | 同一分支的参数化循环与近似重复用例；简单截断、去空格、格式化函数对 `null`、空串、`NaN`、负数、数字字符串的逐项穷举 | 每个独立分支保留一个代表；金额、时间窗口、持久化数据与安全相关的真实边界 |
| 转发与替身 | getter/setter 与原样转发；替身返回 A 再断言 A；无业务意义的调用顺序与私有函数名；「导出了函数」「模块能加载」 | 「只发送一次」「失败时不写库」等业务副作用 |
| 跨层重复 | 已由所属模块验证的规则在路由、服务、前端或页面再测一遍 | 所属模块测一次，外层至多保留一条接线检查 |
| 外观性生命周期 | 短命弹窗或菜单的销毁、Escape 关闭、焦点去向、普通控件的 aria 文案 | 核心流程唯一的键盘操作覆盖；进程、窗口、连接、文件句柄等有实际成本的资源释放 |
| 措辞 | 诊断日志与异常 `message` 的原文 | 作为契约的错误码、类型与 HTTP 状态；凭据不进入日志 |
| 测试自身 | 只针对测试辅助函数、假对象或夹具本身的用例，以及仅执行夹具代码的断言 | 无 |
| 开发与支持脚本 | 截图、诊断、事件捕获等脚本的参数解析与提示文案 | 凭据不写入输出、输出上限、已有文件不覆盖与资源释放 |
| 昂贵运行时 | Node/VM 已能证明的规则在浏览器或 Electron 中重跑；每个样式、变体或控件各开一个真实窗口用例；按固定时长等待 | 每条核心用户流程保留一个端到端用例；等待业务事件或状态，不按装饰动画时长等待 |

新增一条用例或断言前依次自检，任一项答不上来就不写：

1. **故障**：它失败时，用户或数据会遇到什么实际问题？（「文案、样式或默认值变了」不算。）
2. **归属**：所属模块层是否已有用例？有就扩展该用例或不写，不在调用方层再测一遍。
3. **误报**：只改文案、样式、默认值、DOM 层级或内部函数名时，它会不会失败？会就改成行为断言或不写。
4. **成本**：能否用更便宜的运行时证明？依次考虑纯函数/Node、VM、浏览器、Electron。

修复缺陷时，只在出错的所属模块层补一条能复现原问题的回归，不顺带为同一文件的其他控件或分支补测试。

### 复用与职责范围

- **先查归属模块**：按行为和所属模块搜索已有用例、辅助函数与夹具，相同行为的新输入优先扩展现有场景（参数化用例须能独立定位失败）。
- **保持职责小**：每个用例验证一个明确行为或契约，不把无关流程塞进同一用例；测试文件与辅助模块围绕同一职责，不为复用而建立万能框架。
- **规则归属明确**：公共规则在所属模块层验证，调用方只验证自身接线与集成契约，不重复冻结被调方的内部结构。不同层确有独立失败风险的覆盖仍分别保留。
- **矩阵围绕分支**：共享字段校验器的输入边界在所属模块验证一次；各样式仅覆盖自身默认分支与代表性应用，不展开「所有样式 × 所有字段 × 所有非法值」。调用方预期可引用所属模块导出的默认值，但不能用待测算法计算预期答案。
- **复用保持隔离**：共享构造逻辑，不共享可变状态或依赖执行顺序；避免改动通用夹具迫使无关用例同步改断言，不为单次使用预先抽象。
- **按模块加载输入**：单页或单控件测试优先用 `readAdminFragmentHtml` / `readCssBundle` 读取所属片段，纯函数直接加载所属模块；整页组合与入口接线由独立集成测试承接。
- **检查连带影响**：局部改动引发大量测试失败时，先区分真实契约变更、重复断言与过宽夹具耦合，再在本次范围内修正，不通过批量改期望或删独立回归来掩盖问题。

### 断言的取舍

评审与重构已有测试时，检查「去掉这条断言会漏掉什么实际故障」「仅调整无关设计或内部结构是否会误报」：

| 处理 | 适用情况 |
| --- | --- |
| 删除 | 属于 [不新增的测试与断言](#不新增的测试与断言) 且不在例外栏内（如普通排版、装饰层级、文案顺序、静态清单检查）；直接删除，不改用截图替代 |
| 修改 | 意图有效但绑定了属性顺序、完整标签或内部实现；改写为可观察行为或与输入相关的边界断言 |
| 合并 | 公共组件、页面源码与运行时重复验证同一规则；在所属模块保留一次规范检查，并注明承接行为的现有用例 |
| 保留 | 权限、身份/来源隔离、数据完整性、协议/持久化、并发与重试、资源释放、可访问性，以及明确的导出尺寸和用户设置准确应用 |

- **重复与过时用例**：按业务行为归并多轮审计留下的同类用例（保留不同失败方式的独立覆盖）；真实页面交互已覆盖时，删除同一控件的静态清单检查与无风险源码扫描；确认功能或兼容范围取消后，连同不再引用的测试辅助代码一并移除（不以代码年久判定过时）。
- **压力与并发验证**：压力测试在峰值与结束处校验资源、总量与清理（必须全程成立的上界与顺序仍检查过程）；异步测试跟随业务事件推进，不复制装饰动画时长。
- **清理与治理验证**：清理混合用例时逐项保留有效覆盖并删除多余 `import`，不留空测试或吞错；涉及合并须确认等价性。跨领域治理除定向或全量回归外，可在隔离子进程中验证普通设计调整不误报、典型真实故障能检出。

以上是本项目按风险与维护成本采用的取舍，不规定单元/集成测试数量比例。参考：[Google：Change-Detector Tests Considered Harmful](https://testing.googleblog.com/2015/01/testing-on-toilet-change-detector-tests.html)、[Ham Vocke：The Practical Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html)、[Kent C. Dodds：Testing Implementation Details](https://kentcdodds.com/blog/testing-implementation-details)。
