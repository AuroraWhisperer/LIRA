# 安装被启动失败残留进程阻塞

Status: Completed

## Goal

修复依赖加载失败后 Electron 无窗口驻留、阻塞下一次安装的问题，验证完整安装包，并为当前故障提供恢复结果。

## Current Behavior

- 当前安装于 `D:/Work/live-exe/LIRA` 的 5.2.1 缺少 `electron-updater` 的 `fs-extra` 等九项直接传递依赖；已有 `verifyPackagedDependencies` 实际校验失败。
- 15:28:58 和 15:29:02 启动的两个主进程及四个子进程仍在运行，均无主窗口。主进程依赖加载早于实例锁、日志与异步启动错误处理。
- 安装器在备份前等待进程退出，仅发送正常窗口关闭请求，无法关闭没有应用窗口的失败启动进程。
- 16:08 生成的 `release/lira-setup-5.2.1.exe` 已通过实际安装包资源摘要及生产依赖校验，原打包漏依赖已有门禁，不重复实现。

## Ownership And Constraints

- `src/electron/main.js` 保持 Electron 组合根；新增仅依赖 Electron 的入口错误边界，拥有同步加载失败的报告和退出。
- `package.json` 指向该入口；`build/installer-data.nsh` 只修正后台进程提示，不改变退出确认、数据备份、静默安装和非强杀契约。
- 测试归属 `test/desktop/`、已有安装器和打包套件；原生 Electron 测试登记到 `scripts/run-tests.js` 的 desktop 组。
- 契约归属 `docs/reference/desktop/main.md`、`docs/reference/engineering/build.md`；用户指导归属 `public/pages/admin/toolbox/usage-guide-faq-setup.html`。
- 不改变存储布局、认证、更新源、正常关闭冲刷；不提交、发布或改版本。不处理安装目录名称匹配这一旁支，因为本次残留进程确实属于当前安装目录。
- 保留已有文档整理和其他用户修改；隔离验证、构建及临时状态放在仓库 `tmp/`。不使用真实业务资料进行测试。

## Milestones

- [x] 新增真实 Electron 隔离回归：入口加载遇到缺失依赖时只报告一次并以非零码退出；成功加载继续正常入口。以现有直接加载入口复现未退出，再验证错误边界。
- [x] 实现入口 `try { require('./main'); } catch (error) { try { dialog.showErrorBox(...); } finally { app.exit(1); } }`；更新入口说明、后台残留提示及恢复指导。
- [x] 运行桌面启动/关闭、安装器、打包和文档检查；构建本地安装包，验证实际 EXE。对本机已确认的旧故障进程，重查 PID、路径、启动时间及无窗口状态后恢复，操作与隔离测试分开。

## Verification

- `node --test test/desktop/electron-startup.test.js test/desktop/electron-shutdown.test.js test/desktop/electron-main-modules.test.js`：加载失败确定退出，正常关闭冲刷仍通过。
- `npm run test:installer`：安装退出等待、迁移和卸载数据保护通过，零跳过。
- `node --test test/engineering/packaging-scope.test.js test/engineering/installer-static.test.js`：生产依赖门禁与安装顺序通过。
- `npm run verify:docs`、`npm run verify:architecture`：入口契约与文档链接一致。
- 使用 `electron-builder --win nsis --x64 --publish never` 的本地 Electron 分发构建到 `tmp/installer-startup-recovery/build`，由现有产物钩子验证完整安装包。
- 最后审阅任务 diff、`git diff --check` 和 `git status --short`。

## Failure Handling And Done When

构建或依赖验证失败即停止交付该产物。加载失败使用非零退出且不继续启动业务；安装数据保护保持原顺序。任何撤回只修改本任务文件和变更段落。完成条件为复现被回归保护、原有关闭与安装测试通过、说明同步、产物校验通过及最终 diff 已审阅；当前安装恢复和发布状态单独记录。

## Results

- 原入口的缺依赖与报告异常场景都在 8 秒后仍未退出，测试必须终止自己的隔离进程；修复后两个场景均以退出码 1 结束，正常加载以 0 结束。
- 启动/关闭相关 43 项、原生安装器 42 项、打包/安装静态/使用指南 31 项、架构 26 项、文档 10 项全部通过，零跳过。重用 scratch helper 及保留原 FAQ 内容后，受影响的 19 项重验通过；入口与分组脚本语法通过。
- 实际打包的 Electron 在隔离目录打开可见的 1280×722 登录窗口，`/license` 返回 200，`userData` 和 `sessionData` 均在临时构建目录。使用窗口“退出 LIRA”按钮退出码为 0；未登录真实账号。截图在 `tmp/installer-startup-recovery/packaged-startup.png`。
- 交付文件：`tmp/installer-startup-recovery/build/lira-setup-5.2.1.exe`，SHA-256：`23ea98082e51e953d39b96cbad9969c6b03f488a9c374b484f27a201b36f6c64`。现有构建钩子已验证最终 EXE 资源摘要和完整生产依赖。第二次构建仅同步 FAQ 文案，启动实现相同。
- 本机恢复操作与隔离测试分开：重新确认原六个进程的 PID、创建时间、父进程、精确可执行路径、无主窗口且无监听端口后终止，确认受影响安装目录剩余进程为 0；业务文件未修改。没有自动覆盖实际安装目录，也没有提交、发布或改版本。
- 测试、技术参考、模块边界和应用内恢复指导已同步；现有 README 安装入口和交互引导步骤未改变，无需重复添加同一故障说明。
- 最终 diff、`git diff --check` 与状态已审阅，通过。测试进程全部退出；最后清理 `tmp/installer-startup-recovery` 内测试 profile 等目录的 PowerShell 操作被自动审批以 `blocked by policy` 拒绝，未换工具重试，临时目录保留。此限制不影响安装包与验证结果。
