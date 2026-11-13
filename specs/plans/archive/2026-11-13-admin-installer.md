# 允许管理员启动安装器

**Status:** Completed — 2026-11-13，用户要求的管理员启动拦截已取消，源码、回归与文档同步完成。

**Goal:** LIRA 安装器以管理员权限启动时不再直接退出，仍安装给当前用户并执行既有目录与数据保护检查。

**Architecture:** 只修改 NSIS 当前用户安装校验的权限分支，不新增安装模式或启动进程。目录验证、升级备份与卸载职责保持原有归属。

**Tech Stack:** electron-builder 26.18.0、NSIS、Node.js 24 原生测试。

## 边界与现状

- 变更前，`build/installer-per-user.nsh` 的 `liraRequireUserInstall` 先检查 `${UAC_IsAdmin}`，管理员进程在目录检查前退出；入口来自 `build/installer.nsh` 的 `customInit` 和保留数据 section。
- 当前用户安装、`/allusers` 拒绝、旧全用户升级拒绝、安装注册信息归一、目录归属/链接/写入检查保持不变。
- 不修改 ACL、持久数据布局、Electron 主程序、自动更新协议、安装 manifest 或主动提权配置。不构建或发布发行安装包。
- 起始 `git status --short` 为空；仅修改本任务文件。

## Owner 与同步范围

- 实现：`build/installer-per-user.nsh`。
- 回归：`test/engineering/installer-directory.test.js`，复用原生 NSIS 隔离矩阵；保留全用户模式、ACL、链接与已有数据断言。
- 关联检查：`test/engineering/installer-update.test.js`、`test/engineering/installer-static.test.js`，验证生产 include、模式接线与更新流程。
- 当前契约：`docs/reference/engineering/build.md` 和 `docs/architecture/adr/0015-install-local-desktop-data.md`。
- 用户指导：`public/pages/admin/toolbox/usage-guide-getting-started.html`；已检索 README、发布指南、`docs/guides/` 和交互式引导，无其他禁止管理员安装的当前指引。

## 实施与验证

- [x] 修改已有 NSIS 矩阵：将原 `elevated` 拒绝场景改为已注册目录的 `elevated-update` 成功场景，保留模拟管理员判定；用下列命令确认原代码失败。

  ```powershell
  node --test --test-name-pattern "installer accepts" test/engineering/installer-directory.test.js
  ```

- [x] 删除管理员退出分支，直接从安装模式校验开始；保留当前用户模式和目录保护。调整函数注释及全用户模式提示，避免继续要求必须普通权限启动。
- [x] 同步 ADR、构建参考和安装指南，说明普通与管理员启动均可、仍按当前用户安装；目录写入检查基于安装进程权限，不自动赋予普通用户访问权。
- [x] 执行直接关联的 NSIS 回归、改动 JavaScript 语法和文档门禁。

  ```powershell
  node --test test/engineering/installer-directory.test.js test/engineering/installer-update.test.js test/engineering/installer-static.test.js
  node --check test/engineering/installer-directory.test.js
  npm run verify:docs
  ```

- [x] 检查最终 diff、`git diff --check` 和 `git status --short`；记录结果并归档计划。

## 失败处理

NSIS 测试仅在仓库 `tmp/` 中运行隔离夹具，不操作真实安装或用户数据库。失败时先检查退出码和具体场景，保留源数据；如需撤销，只反向恢复本任务差异，不重置仓库或改写其他用户内容。

## 完成条件

管理员场景不再被权限分支拒绝；普通安装、全用户拒绝与目录保护回归通过，生产 include 能编译，文档及使用指引一致，最终 diff 不含运行数据或生成产物。发行包及对方电脑的实际安装结果不计入源码任务验收，未验证时明确说明。

## 验证记录

- 本机 Node.js 24.21.0 和缓存的 NSIS 编译器、插件可用。
- 修改预期后先运行定向回归，原代码在 `elevated-update` 返回 2（期望 0），复现管理员启动被拒绝；其余先行目录场景通过。
- 实现修改后，三个关联安装器文件共 20 项通过，0 跳过；包括模拟管理员判定的当前用户更新、全用户模式拒绝、真实 ACL/目录链接、生产 include 预处理和更新进度原生夹具。
- 改动 JavaScript 的 `node --check` 通过；`npm run verify:docs` 10 项通过。
- ADR、技术参考及应用内安装指南已同步；交互式引导与其他用户指南不含此限制，无需修改。
- 只验证源码与隔离 NSIS 夹具，未执行真实提权安装、未操作用户应用或数据库，未构建或发布发行包，未提交。
