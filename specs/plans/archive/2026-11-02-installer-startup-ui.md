# 安装版启动与完成页修复

**Status:** Completed

## Goal / Current Behavior

修复 Windows 安装版启动时 `Cannot read properties of undefined (reading 'publish')`，并使安装完成页紧凑、对齐、主操作清晰。已检查本地 5.7.6 `app.asar`：其 package.json 没有 build，resources/app-update.yml 已正确包含 CDN generic provider；update-manager.js 却在启动时访问 build.publish[0]。

## Ownership / Compatibility

- 更新初始化：src/electron/update-manager.js；消费者为 desktop-update-controller.js 和主进程；契约 docs/reference/desktop/update.md；回归 test/desktop/update-manager.test.js。
- 安装界面：build/installer-ui.nsh；入口 build/installer.nsh；契约 docs/reference/engineering/build.md。
- 保留更新源、自动下载/退出安装、缓存位置、安装路径选择、协议同意、数据保留、重启选项及启动方式。既有 IPC、存储、权限与安全边界不变。
- 不修改正式版本、不提交或发布；本地验证产物与临时脚本均留在根 tmp/，不操作用户正在运行的实例或真实数据。

## Changes / Milestones

1. 在既有更新器回归中模拟没有 build 的安装版 package.json，通过真实 electron-updater 读取临时 app-update.yml，拦截 HTTP 请求验证 CDN 地址与摘要、安装目录缓存。先确认原实现失败，再移除运行时代码对构建配置的依赖。
2. 保留原生向导与图标，收紧完成页尺寸、间距和标题字体，隐藏完成后不可用的按钮；复用已有 NSIS 预览夹具检查协议、路径、进度与完成页。
3. 同步两份 owner 文档，构建本地安装包并运行其隔离副本，确认主窗口到达登录/授权页、无启动错误。用 playwright-interactive 检查 Electron，原生安装向导用 screenshot 技能检查。

## Verification / QA Inventory

- `node --test test/desktop/update-manager.test.js test/desktop/desktop-update-controller.test.js test/desktop/electron-startup.test.js test/desktop/electron-shutdown.test.js`：安装配置缺少 build、自动更新状态/错误、退出路径。
- `node --test test/engineering/installer-static.test.js test/engineering/packaging-scope.test.js test/engineering/client-installer-integrity.test.js`：安装流程与打包门禁。
- 本地 electron-builder NSIS 构建，保留项目 afterPack/afterSign/artifactBuildCompleted 门禁，使用 `--publish never` 和 tmp/ 下输出。
- 原生向导预览：协议初始不同意、页面内容可读、完成页无大块多余留白；运行复选框可切换，完成退出；需重启与隐藏启动选项的编译分支保留。
- 安装包隔离启动：独立空 data、应用目录及 Chromium 路径；验证单实例与端口行为后启动；真实主窗口与 preload 存在。更新器缺失清单/网络错误已有测试，确认仍报告更新错误。
- `npm run verify:docs`、`npm run check`、`npm run verify:architecture`；最终 diff、`git diff --check`、`git status --short`。
- 用户指南与应用内引导核对：操作入口和安装步骤未变，若无不实描述则无需修改。

## Rollback / Done When

仅回退本任务 diff；不使用破坏性 Git 命令，不覆盖已有 release 产物。完成条件：回归通过、实际打包版启动通过、原生界面可读且操作正常、相关契约同步、无生成文件或敏感数据进入差异。未实测项目明确记录，不以源码测试替代。

## Results

- 已在原实现复现同一 `publish` 异常：6 项更新器用例均因模拟的安装版 package.json 没有 build 而失败。移除运行时 build 依赖后，原有真实更新器回归从临时 app-update.yml 读取 CDN，保留摘要解析、Electron HTTP executor 与安装目录缓存，6 项全部通过。
- 更新、启动退出、安装静态和打包资源共 68 项聚焦检查通过；`npm run check`（1673 文件）、`npm run verify:architecture`（28 项）、`npm run verify:docs`（10 项）通过。
- 原生预览在本机 150% DPI 下确认：协议默认拒绝、同意后才能继续、原生滚动正常；完成页 840 × 420 实际像素（560 × 280 逻辑像素），标题与正文/启动选项不重叠，“上一步”和“取消”隐藏，启动复选框可切换，点击“完成”退出。`HIDE_RUN_AFTER_FINISH` 分支编译通过；需重启分支保留，未触发系统重启验收。
- 本地 NSIS 构建和既有最终安装器门禁通过；输出 `tmp/installer-startup-ui/artifacts/lira-setup-5.7.6.exe`，172384082 字节。保持版本 5.7.6，仅本地修复包，没有提交、签名或发布。
- 直接解出最终安装器内的完整应用，在预先创建的独立空 data 目录启动真实 LIRA.exe：`app.isPackaged === true`、版本 5.7.6，打开 `/license` 登录窗口，两份桌面桥存在，登录页签可交互，日志没有 startup-error。已核对单实例锁、独立数据/Chromium 路径及启动前空闲的 3000 端口，验证后关闭实例。没有覆盖用户现有安装或使用真实账号数据。
- 清理 `tmp/installer-startup-ui/installed-app/` 的递归删除被工具安全策略拒绝（`blocked by policy`）；未更换工具或命令绕过，保留该隔离测试目录。没有测试进程留在后台。
- 截图和启动证据保留在 `tmp/installer-startup-ui/`。owner 文档已同步；README、指南、应用内使用说明与交互式引导的入口和步骤未变，无需改动。没有新增视觉自动化用例，延伸既有更新器覆盖以防打包配置回归。
