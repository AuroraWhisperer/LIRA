# 客户端资源完整性检查实施计划

状态：In Progress。2026-09-26。实现和自动化门禁已完成，正式签名安装验收待完成；本任务不提交、不发布、不操作真实安装和业务数据。

## Goal

在版本更新页支持区提供离线、只读、手动的安装资源检查，以随包清单核对 app.asar 和实际随包外置文件，并提供有界、脱敏的结果。

## Non-goals

不修改授权/buildId、不自动修复、不扫描用户数据、不改变更新状态枚举或增加服务/运行时依赖；不提供防篡改认证。

## Initial Behavior / Ownership

- `scripts/after-pack.js` 只清理 default_app.asar；`scripts/publish-release.js` 当前构建并上传，重试会重新构建。
- `src/electron/ipc/main-window-ipc.js` 负责主窗口、主 frame、origin 和页面路径校验；新增诊断不能复用允许 license 页的注册器配置。
- `src/electron/main.js` 负责组合和退出；`desktop-update-controller.js`/`update-manager.js` 负责安装。
- `src/electron/preload.js`、`public/js/desktop.js` 和现有更新页是展示消费者。
- 契约事实源为 `docs/architecture/desktop/preload.md`、`desktop/update.md`、`engineering/build.md`。

## Compatibility Constraints

- 仅打包 win32/x64；开发模式直接 unavailable。
- 清单 schemaVersion=1、scope=packaged-app-resources、algorithm=sha256，4 MiB/10000 条；扫描 256 KiB 块、120 秒上限、进度最多每 250 ms。
- renderer 不得指定文件、路径或清单；资源检查不改变已有授权及更新契约。
- 保持播放保存、授权释放和退出/安装顺序；不触及既有歌迷档案及使用指南改动。

## Proposed Changes / Milestones

### 1. 清单与检查引擎
- [x] 共享纯 Node 资源完整性模块：固定路径/schema 校验、原始文件流式摘要、边界/句柄复核。
- [x] 构建清单函数从实际 resources 枚举，在 afterPack 和 afterSign 生成；保留原清理。
- [x] 独立 manager 暴露 `getState()`、`check()`、`cancel()`、`stop()`，单任务、revision、取消和有界诊断。
- [x] 临时目录测试：正常、缺失/大小/摘要不符、非法清单/路径/链接、超限、文件变化、取消/超时及重复检查。

### 2. IPC、生命周期和更新页
- [x] 两个无参数请求通道和一个状态事件按设计接入；仅主窗口管理页面；preload 订阅返回 disposer。
- [x] 主进程创建单例，退出/安装前 stop；新检查被拒绝，取消不复活，不向已销毁窗口发送。
- [x] 现有支持区增加唯一入口，独立 revision 状态渲染；textContent 展示最多 20 条相对路径和中文原因。
- [x] 覆盖来源拒绝、安装/退出、UI 顺序/订阅/状态；原更新和授权测试仍通过。

### 3. 最终安装产物门禁
- [x] 核对安装构建器钩子时序，接入最终安装产物校验钩子并禁止构建器直接上传。
- [x] 从最终 NSIS 安装器内嵌载荷提取资源到隔离目录并校验，不能仅验证 win-unpacked。
- [x] 发布只构建一次（publish never），验证后重试上传同一组资产；每次上传前后复核资产摘要。
- [x] 保留 tag/源码/凭据保护、重试、远端摘要核验；失败用临时伪产物测试，不做真实发布。

## Verification

阶段检查优先使用 `node --test` 运行新增资源完整性、打包和 IPC 测试，以及既有 packaging-scope、build-integrity、update-manager、publish-release、frontend-desktop-update 测试。

跨安全/打包契约实现后运行 `npm run verify:quick`、`npm run test:desktop`、`npm run test:installer`；必要时按实际失败扩大。正式打包/签名/安装及交互响应性只在可隔离且无真实数据风险时执行，否则明确列为剩余验收，不标规格 Implemented。

最终检查：`git diff --check`、逐一查看任务 diff、`git status --short`；确保没有生成产物、秘密、用户数据进入变更。

## Rollback / Failure Handling

生成或验证失败立即阻止发布；扫描失败收敛到未完成并清理句柄/计时器。不通过重新生成运行期基准或联网掩盖错误。需要撤回时仅逐项回退本任务 diff，不使用 reset/checkout/广泛删除。

## Done When

实现和针对性测试一致；安全边界、退出/更新和非目标行为保持；唯一契约文档同步。只有正式隔离安装及 AC01–AC15 证据齐备后才标 Implemented，未完成环境验收需明确保留。

## Evidence / Discoveries

- 初始工作区存在歌迷档案、使用指南、规格索引和审计文档改动；保持原样。设计文件也是既有未跟踪文件，不覆盖其他内容。
- 运行时职责落在 `resource-integrity-files.js`、`resource-integrity-manager.js`；`desktop-resource-integrity.js` 只负责 Electron 依赖与状态事件接线。`main.js` 仅新增 12 行组合/生命周期接入，对应模块体积审查记录已说明。
- 已核对本地 electron-builder 26.15.3 时序：blockmap 在安装器 artifactBuildCompleted 之前生成并可能发布，因此不能只依赖安装器钩子阻止自动上传。两条 Windows 构建命令使用 `--publish never`；发布流程构建一次、验证后才创建/复用 release 并上传，重试不重建。
- Windows 自带 libarchive `tar.exe` 能读取本项目真实 NSIS 安装器内嵌 7z 载荷；builder 自带 7za 不支持该 NSIS 格式。提取前验证成员路径/类型，仅提取固定资源范围；提取失败不放行，不执行安装器。
- 隔离 Electron 测试使用真实 preload、IPC 注册器及 128 MiB ASAR，验证正常检查、修改后重检、license 页调用拒绝，以及扫描时主进程和 renderer 计时器仍运行；不启动生产 LIRA 主进程，不接触真实业务数据。此证据不替代正式安装客户端上的交互验收。
- 2026-09-26 `npm run verify:quick` 通过：文档 7 项、1031 个 JavaScript 文件语法检查、架构 22 项。
- 2026-09-26 `npm test` 通过：2963 项中 2959 通过、4 跳过、0 失败；包含 desktop、installer 和新增完整性测试文件。分组专用命令无需重复执行相同用例。
- 2026-09-26 使用最终代码再次完成隔离 Windows x64 NSIS 构建（5.0.6，Electron 43.2.0，`--publish never`）；构建钩子及独立复验均通过。最终安装器内清单包含 1 项 app.asar，37179291 字节，平台/架构/版本匹配。Authenticode 检查为 NotSigned；没有执行安装器或上传产物。
- 最终任务差异已审查；按仓库现有换行配置执行 `git diff --check` 通过。没有把本任务构建产物、日志或用户数据写入仓库。清理临时构建目录与测试日志的命令被环境安全策略拒绝，未尝试绕过；文件仍留在仓库外。

## Remaining Acceptance

- [x] 用最终代码再次构建隔离无签名 Windows x64 NSIS 安装包，并记录最终载荷门禁结果。
- [ ] 使用正式签名构建，在隔离安装环境完成安装后资源检查、断网场景与真实桌面交互验收；在此之前不把设计规格标记为 Implemented。
- [x] 最终检查任务 diff、`git diff --check` 和工作区状态。
- [ ] 临时产物清理受环境策略阻止：构建目录 `C:/Users/Tom/AppData/Local/Temp/lira-integrity-build-83f3a62960474f7a8614f93694868674`，测试日志 `C:/Users/Tom/AppData/Local/Temp/lira-resource-integrity-final-tests-20260926.log`。未重新尝试删除。
