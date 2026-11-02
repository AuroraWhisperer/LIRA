# 更新安装进度 Implementation Plan

**Status:** Awaiting Verification

实现及隔离原生验收已完成；剩余重新打包后，从旧版客户端触发真实更新的发布验收。不操作当前用户安装或发布安装包。

**Goal:** 客户端退出后，由现有 NSIS 安装器显示真实安装进度和当前阶段，成功后自动关闭；显式重启更新会重新启动 LIRA。

**Architecture:** 安装器拥有退出后的界面；`--updated` 更新切换到可见的自动安装流程。沿用 electron-updater、NSIS、原生进度条及数据保护，不新增程序或运行时依赖。

**Tech Stack:** electron-updater 6.x、electron-builder 26.x、NSIS、Node 原生测试。

## 当前行为与边界

- `src/electron/update-manager.js` 使用 `quitAndInstall(true, true)`；普通退出由 updater 使用静默安装且不重新启动。两种路径都会传递 `--updated`。
- `build/installer-ui.nsh` 已有真实进度页和手动安装完成页；更新目前以 `/S` 隐藏全部界面。
- `build/installer-process.nsh` 静默模式只等待 Electron 自行清理。显示更新窗口后仍须保留此等待，避免重复确认或提前关闭。
- 数据备份、恢复、错误报告、安装权限、路径与 SHA-512 校验保持既有契约。普通手动安装和独立 `/S` 安装保持现状。
- 工作区已有下载清单与错误提示相关修改；保留全部既有修改。

## Ownership 与同步

- 安装初始化：`build/installer.nsh`；界面和完成页：`build/installer-ui.nsh`。
- 退出等待：`build/installer-process.nsh`；备份提示：`build/installer-data.nsh`。
- 回归：新增 `test/engineering/installer-update.test.js`，扩展现有 `installer-app-exit.test.js` 的可见更新用例，登记 `scripts/run-tests.js` installer 组。
- 技术事实：`docs/reference/desktop/update.md`、`docs/reference/desktop/main.md`、`docs/reference/engineering/build.md`。
- 用户说明：更新页和 `usage-guide-toolbox-software.html`；交互引导没有相关更新步骤，无需修改。

## 实施与验证

- [x] 可见自动安装：`customInit` 仅对 `--updated` 执行 `SetSilent normal`、`SetAutoClose true`；进度页显示更新标题，完成页 pre 回调按 `--force-run` 决定启动并跳过完成页。
- [x] 保留受控退出：可见更新直接进入现有等待；备份使用进度页阶段提示，避免再叠加备份 Banner。
- [x] 原生测试：编译并运行隔离 NSIS 夹具，覆盖显式重启更新、普通退出更新、手动完成页和独立静默安装；验证可见进度、自动关闭、启动次数、失败不启动，以及等待退出后才备份。
- [x] 同步技术文档和用户说明，记录测试与实际打包验收边界。

命令：

```powershell
node --test test/engineering/installer-update.test.js test/engineering/installer-app-exit.test.js test/engineering/installer-migration.test.js test/engineering/installer-static.test.js test/desktop/update-manager.test.js test/desktop/desktop-update-controller.test.js test/desktop/electron-shutdown.test.js
npm run verify:docs
git diff --check
git status --short
```

原生测试必须实际执行，不以 skip 作为通过。测试只操作仓库 `tmp/` 下的隔离夹具，不启动、关闭或更新用户的 LIRA。涉及安装器模板时补充实际 NSIS 编译验证，不发布安装包。

## 失败处理与完成条件

失败仍走原有安全停止和错误报告，不能因自动关闭而吞掉错误或启动未完成版本。只回退本任务修改，不覆盖工作区既有差异。

可见进度、无需点击完成、启动规则、数据保护回归及文档门禁通过后完成实现；真实发布包的端到端更新如未执行必须明确记录，不标为已验收。

## 执行记录

- 2026-11-02：确认 updater 两条路径均带 `--updated`，可在新安装器端修复并覆盖旧客户端触发的更新。
- 可见更新必须通过 `customInstallMode` 沿用原安装范围并跳页，否则 builder 会停在范围选择页；原生测试覆盖当前用户及所有用户范围（夹具不执行真实提权或注册表写入）。
- 原生进度回归 8 项通过，包含实际 `liraInstallerUi` DPI/布局回调的编译与执行；退出/卸载回归 38 项通过；数据迁移 16 项通过；既有更新状态、控制器、受控退出及静态回归 47 项通过。原生场景无 skip。
- 2026-11-02：5.7.8 正式安装包已构建并通过完整资源验包。首次构建暴露 `StartApp` 宏重复声明 `startAppArgs`，已改为调用现有函数，修复及对应原生回归进入发布提交 `ded2f0eb`；相关 39 项定向检查及全量统一验证通过。尚未在隔离旧版客户端中触发并观察完整自动升级流程，不能将构建与原生夹具验收视为该端到端验收。
