# 安装、启动与更新可靠性复核

Status: Completed

## Goal

按用户要求复核此前缺依赖、无窗口残留和安装阻塞同一链路的完整情况：打包、首次安装、覆盖升级、数据保护、首次及重复启动、失败退出、正常退出、再次更新及卸载。发现的问题必须复现、修复并有对应证据；全仓验证用于发现消费者回归，不能代替实际产物检查。

## Current Behavior And Ownership

- 上一轮已在 `src/electron/entry.js` 捕获同步依赖加载异常，完整依赖图门禁由 `scripts/verify-packaged-dependencies.js`、`after-pack.js`、`verify-client-installer.js` 拥有。
- `build/installer-data.nsh` 等待所有同名进程，但仅关闭旧/新安装路径对应窗口；现有 `other-directory` 用例反而期望安装失败，未覆盖正确的路径隔离要求。
- `src/electron/main.js` 拥有异步启动与正常关停；继续检查异常报告及每个退出阶段是否可能绕过最终退出。
- 安装目录/数据/卸载套件在 `test/engineering/installer-*.test.js`；启动/关闭/更新/数据布局/产物完整性已有所属套件。优先补入已有测试。
- 契约归属 `docs/reference/engineering/build.md`、`test.md`、`docs/reference/desktop/main.md`、`update.md`，数据规则由 ADR-0015/0016 约束。

## Constraints

保留用户已有修改、现有数据格式、授权、实例锁与退出冲刷；正常运行实例不能被按名称误杀，退出未确认不能开始数据备份。测试只用仓库 `tmp/` 下隔离目录、唯一进程名和测试注册表身份。之前被拒绝的临时目录清理不重试。不提交、发布、改版本或替换用户当前安装。无需借此增加框架、服务或第三方依赖。

## Verification Matrix

| 范围 | 需要证明的情况 | 权威证据 |
| --- | --- | --- |
| 产物 | 主入口/生产依赖完整；错误产物被拒绝；发布前校验及产物变更检测 | 打包、安装包完整性、发布脚本测试 + 新 EXE 校验及真实打包启动 |
| 安装范围 | 首装、原目录覆盖、换目录、中文/空格/特殊字符路径、显式路径优先 | 目录测试 + 原生 NSIS + 隔离完整安装流程 |
| 进程 | 无运行实例、旧/新目录实例、其他目录同名实例、无窗口进程、取消、重试、静默退出与超时 | 原生退出测试 + 完整安装流程 |
| 数据 | 退出前最终写入、旧数据迁回、备份恢复/冲突、复制/报告失败、锁定文件、升级保留、卸载默认保留/确认清理 | 原生迁移和卸载套件 |
| 启动 | 同步缺依赖、错误提示失败、异步失败、二次实例、迁移错误、正常打包首启 | 原生启动/数据布局 + 生命周期测试 + 隔离产物检查 |
| 退出/更新 | 冲刷、重复退出、超时、资源释放错误、更新前停止检查、失败不残留 | 生命周期/更新/完整性套件及真实窗口关闭 |
| 全仓消费者 | 当前完整客户端契约、语法、Node/浏览器/Electron/NSIS 回归、架构、文档 | `npm run verify`、`npm run verify:architecture`、`npm run verify:docs` |

## Milestones

- [x] 审阅上述 owner 和现有用例，为实际缺口添加失败复现；不把通过的错误预期当作正确行为。
- [x] 在所属模块修复确认缺陷，同步直接契约和用户操作指导，逐个运行受影响测试。
- [x] 用隔离的完整 NSIS 安装身份验证首次安装、覆盖升级、退出及卸载保留；实际打包应用验证首启和关闭。
- [x] 停止修改受测源后运行 `npm run verify`，收集全部失败并定位；只有修复及对应条件通过后才重复全量。运行架构、文档检查及最终 diff/status 审阅。
- [x] 记录每项验证结果、产物哈希与仍未覆盖的环境限制，完成审计后再标记目标完成。

## Failure Handling

任何未确认退出、路径身份不明、数据冲突或产物校验失败均停止相应操作并保留资料。只修改本任务差异；不做破坏性回滚。测试进程仅按自己持有的句柄结束，实际用户进程不作为测试对象。全仓失败保留日志到 `tmp/installation-lifecycle-audit/`，不重复碰运气运行。

## Findings And Evidence

- 已复现并修复：异步启动失败时错误提示再次抛错会跳过关闭；请求认证 disposer 抛错会绕过最终退出。49 项直接生命周期检查通过。启动失败进入有界清理，退出码为 1；退出意图仍由首次请求拥有。
- 已复现并修复：同名进程检查阻塞其他安装目录。`installer-process.nsh` 用原生进程快照及完整路径检查承接安装/卸载，保持正常关闭、不强杀；扩展的 13 项原生退出检查通过。完整 builder 编译确认宏展开顺序有效；新源文件已加入 `.gitignore` 例外。
- 已复现并修复：残留 `.partial` 为目录链接时，NSIS `RMDir /r` 删除外部目标内容。改用已有 `liraRemoveTree`；原生回归证明链接目标保留。退出与迁移共 29 项通过，0 跳过。
- 唯一测试身份 `com.lira.audit.lira-audit-01a11fe0`，安装器源快照的 AppData/LocalAppData/TEMP 全部指向本任务 `tmp/`。完整安装包实际执行首装迁回旧数据、从 `updates` 缓存原目录升级、换目录升级，路径包含中文、空格、`&` 和单引号；都返回 0，测试资料完整保留。脚本和证据位于 `tmp/installation-lifecycle-audit/`。
- 安装后的真实 Electron `/license` 返回 200，登录界面可见。运行中静默卸载约 10 秒后返回 2，应用仍运行且数据未动；点击“退出 LIRA”后返回 0、无残留测试进程。退出后卸载返回 0，只保留 `data/`。卸载夹具最初直接以 `_?=` 执行安装目录内的 EXE，因该参数禁用 NSIS 自复制而无法删除自身；修正为从隔离临时副本执行后完成，此为夹具调用错误，不修改产品以掩盖。
- 依赖图、最终 EXE 资源校验和发布入口已有归属门禁；本轮完整构建及真实启动均通过，未增加推测性的第二套模块解析器。用户指南只收紧残留进程的目录范围；更新 IPC、认证和持久化格式未改变。

## Final Verification

- Node.js `24.21.0`、Electron `43.2.0`、electron-builder `26.15.3`，本机 Windows `10.0.26300`。
- 初次 `npm run verify` 在契约前置检查停止：工作中的服务端是 `6cdc6c0`，客户端锁定 `01fb2b47d5e081f5dd559933991ade4819eb3428`。在 `tmp/installation-lifecycle-audit/server-contract` 建立该提交的 detached 检出，通过 `LIRA_SERVER_ROOT` 仅为验证指定它；10 份 fixture 哈希全部通过，未重置服务端工作区或修改契约锁。
- 固定上述输入后 `npm run verify` 完整通过：**4,052 项，0 失败、0 跳过**；包含 Windows 原生安装/卸载、真实 Electron、浏览器、完整依赖图、最终安装包校验、发布脚本、更新和全仓消费者。结果文件 `tmp/test-results/run-H9Nhrj/results.json` 为 `scope: full`、`complete: true`；日志 `tmp/installation-lifecycle-audit/verify-pinned.log`。运行期间没有编辑受测源文件。
- 独立 `npm run verify:architecture` 26 项通过；最终归档后 `npm run verify:docs` 10 项通过。检查本任务差异、`git diff --check` 与 `git status --short`，保留其他任务已有的文档/素材修改及历史计划删除。
- 最终修复包：`tmp/installation-lifecycle-audit/final-build/lira-setup-5.2.1.exe`，**124,344,580 bytes**，SHA-256 **`e6fe2edb39c162d835051a11cdc9325a83709f624d65598174cd78f388d7aa3d`**。构建的最终 EXE 校验 hook 成功；旧的 `installer-startup-recovery` 修复包不包含本轮后续修复，以本包为准。
- 最终正式身份 `win-unpacked/LIRA.exe` 的真实运行确认 `isPackaged: true`、版本 `5.2.1`、`/license` HTTP 200、退出按钮可见，点击后进程退出码 0。证据 `tmp/installation-lifecycle-audit/final-runtime-evidence.json`。完整安装流程使用前述唯一测试身份，退出后验证测试进程及卸载注册表项均已清除。

## Coverage Limits

这次验证覆盖本机当前用户安装、隔离数据和故障注入，没有替换用户实际安装、清理真实数据、发布或修改版本。全用户提升权限、其他 Windows 版本、第三方安全软件拦截、线上下载及所有历史卸载器版本未逐机实测；不能把本机结果扩展成所有环境永不失败。旧版已发布卸载器无法通过源码修改追溯修复。源问题、处理策略及测试入口已同步到构建/桌面参考和用户 FAQ。

## Done When

矩阵逐项有直接证据，确认缺陷被回归覆盖并修复，完整验证通过或外部环境限制被明确证明和陈述，实际产物启动/安装链通过，最终变更和文档一致。不能承诺未来所有机器永不失败；此次目标是消除可复现的同类错误并将关键失败路径纳入验证。
