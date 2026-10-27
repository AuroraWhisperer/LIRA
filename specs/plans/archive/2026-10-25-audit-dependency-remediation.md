# Audit Electron And Build Dependency Remediation Implementation Plan

Status: Completed

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 处理 F-01/F-04/F-07，升级实际 Electron 运行时、消除安装/构建链已知受影响版本，并显式声明项目直接消费的构建工具依赖。

**Architecture:** 保持现有 Electron 43 major、electron-builder 打包体系及 CommonJS 脚本，不引入新框架。以受支持父依赖和最小 lockfile 解析更新传递包；对 `app-builder-lib/out/*` 的既有测试耦合采用直接版本声明和 focused packaging 验证，不做无关 API 重写。

**Tech Stack:** Electron 43.8.3、electron-builder 26.x、npm lockfile v3、现有 Node/desktop/installer tests。

## Global Constraints

- 不改变 contextIsolation、nodeIntegration、session partition、safeStorage、local-media canonical path/origin 检查、认证或 updater 合同。
- 不使用 `npm audit fix --force`，不全局安装工具；npm cache/日志放在 `tmp/code-audit/` 或既有临时目录。
- 只更新任务相关依赖，检查 lockfile 是否出现无关漂移；不发布、不上传、不部署。
- 公告数量不等于 LIRA 可利用漏洞数；验证必须区分桌面运行时和 dev/build 链。

## Ownership And Current Behavior

- 清单：`package.json`、`package-lock.json`；实际运行时：`node_modules/electron`。
- 直接消费面：`scripts/verify-packaged-dependencies.js`、`scripts/client-integrity-manifest.js`、`scripts/verify-client-installer.js`、`test/helpers/packaged-app.js`、`test/engineering/packaging-scope.test.js`、`test/engineering/installer-uninstall.test.js`、`test/desktop/bundled-fonts-electron.test.js`、`test/desktop/resource-integrity-electron.test.js`。
- 当前基线：Electron 43.2.0；builder 26.15.3；fast-uri 3.1.8、http-cache-semantics 4.2.0、undici 7.29.0/6.28.0。直接构建引用未在 package.json 声明。
- 参考：`docs/reference/engineering/build.md`、`docs/reference/desktop/main.md`、`src/electron/AGENTS.md`。

## Proposed Changes And Tasks

### Task 1: 更新清单与锁文件

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [x] 将 Electron 固定为 `43.8.3`，builder 更新到兼容的 `26.18.0` 线；将当前直接使用的 `@electron/asar` `3.4.1`、`builder-util` `26.16.0`、`app-builder-lib` `26.18.0` 添加为 devDependencies。保留生产 dependencies 分类和现有 overrides，不把 `original-fs` 当 npm 包添加。
- [x] 用 npm 正常锁文件流程更新并安装（先 `--package-lock-only --ignore-scripts` 检查清单，再正常安装以取得 Electron 二进制）；不手工伪造 integrity。若父依赖仍约束受影响版本，优先更新相应受支持父依赖，停止并检查而不是加 override 或 `--force`。
- [x] 运行 `npm ls --depth=0 --offline`、`npm ls fast-uri http-cache-semantics undici --all --offline` 和 `npm audit --json`；确认 Electron 为 43.8.3，fast-uri >=3.1.9、http-cache-semantics >4.2.0、undici 7.x >=7.30.1 与 6.x >=6.29.1。若出现新公告，按实际链分诊并记录，不谎称零风险。

### Task 2: 构建/桌面 focused 回归

**Files:**
- Test: 现有 `test/engineering/packaging-scope.test.js`、`test/engineering/installer-uninstall.test.js`
- Test: 现有 `test/desktop/bundled-fonts-electron.test.js`、`test/desktop/resource-integrity-electron.test.js`
- Modify: `docs/reference/engineering/build.md`

- [x] 先运行 `node --test test/engineering/packaging-scope.test.js` 和可直接执行的 builder 相关 focused tests；若内部路径在新版改变，只在对应测试中做最小兼容修正并保留原覆盖。
- [x] 使用既有隔离 Electron 测试入口运行窗口/导航、请求认证/重定向、local-media、播放关闭 flush、屏幕取色器和资源完整性检查；不使用真实 profile、Cookie 或账号。记录无法执行的外设/安装器条件，而不以单元测试冒充端到端。
- [x] 执行 `npm run dist:win:local` 或仓库现有等价的本地 `--publish never` 打包验证（不发布），检查 ASAR、资源完整性和安装器 hook；需要本机 NSIS/原生资源的步骤若缺前置，明确列为限制。
- [x] 更新 build.md 的 Electron/builder/直接 devDependency 版本及内部 builder 路径耦合说明；不改用户操作指南，因为安装/启动步骤和公开设置未变。

### Task 3: 最终依赖与差异审计

- [x] 检查 `git diff -- package.json package-lock.json`，确认没有无关生产依赖、脚本、发布配置或秘密变化；确认 `node_modules/electron/dist/version` 与清单一致。
- [x] 运行 `node scripts/check-js.js`、`npm run verify:docs`、`git diff --check` 和 `git status --short --untracked-files=all`。构建输出仅留在既有 ignored `release/`/`build/`/`tmp/`，不纳入交付 diff。

## Completion Evidence

2026-10-25 完成 F-01/F-04/F-07。实际 Electron 二进制为 43.8.3；锁文件解析 fast-uri 3.1.9、http-cache-semantics 4.3.0、undici 7.30.1/6.29.1，执行时 `npm audit --json` 为 0 vulnerabilities。builder/packaging focused 30/30、安装器 57/57、隔离 Electron 安全/生命周期/资源 104/104 通过；`npm run dist:win:local` 以 `--publish never` 成功并核对安装产物。JavaScript 语法检查 1,656 文件、文档门禁 10/10 通过。未发布、上传或部署；0 公告是本次解析结果，不代表永久零风险。

## Verification / Rollback / Done When

最低验证为依赖树/audit、packaging-scope、语法和文档门禁；Electron 升级另需实际隔离桌面与本地打包证据，缺失时不能标为完整验收。回滚仅恢复本任务拥有的清单/锁文件和文档行，再按同一 npm 流程还原依赖，禁止 destructive reset。

完成条件：F-01/F-04 的版本目标达成，F-07 直接依赖声明与实际引用一致；桌面安全不变量和打包 focused 检查通过，所有未执行的真实硬件/安装条件已记录。
