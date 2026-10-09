# Packaged runtime dependencies implementation plan

Status: Completed

## Goal

修复 5.2.1 安装后因缺少 `pako` 无法启动的问题，阻止相同的生产依赖遗漏通过打包与最终安装包验收。

## Current behavior and ownership

- 已安装 `app.asar` 只有 6 个依赖包；缺少 `qrc-decoder -> pako`、`yauzl -> pend` 以及更新器依赖。
- 上轮发布日志报告 9 项 `cannot find path for dependency`，但 builder 继续生成安装器。
- 在 `tmp/startup-linked-modules-repro/` 复现：把 `node_modules` junction 指向主工作区后，builder 的 npm collector 只收集同样的 6 个包；当前工作区独立依赖目录能收集 22 个包。
- `scripts/after-pack.js` 负责打包后检查；`scripts/verify-client-installer.js` 负责最终安装器解包和哈希验证。哈希一致不代表运行依赖完整。
- 文档 owner 为 `docs/reference/engineering/build.md`；测试 owner 为 `test/engineering/packaging-scope.test.js`、`test/engineering/client-installer-integrity.test.js`。

## Constraints and non-goals

保持业务代码、依赖版本、认证、数据格式、Electron 安全边界及用户已有修改不变。不自动提交、发布、覆盖旧安装目录或控制用户正在运行的应用。验证及重建输出放在仓库 `tmp/`；不使用真实用户数据。

## Proposed changes

新增 `scripts/verify-packaged-dependencies.js`：只读取 ASAR 内 package.json，从应用生产依赖递归检查 Node 嵌套/提升查找路径；已安装的可选依赖也检查其子依赖。缺少必需包时抛错，绝不借用开发目录的模块。复用此检查于 afterPack 和最终安装器检查，后者继续先验证现有完整性清单。

更新两处已有验收测试和构建参考：记录独立安装依赖的要求、错误原因及新门禁。用户操作入口和音乐功能行为未改变，使用指南无需修改。

## Milestones and verification

- [x] 对比真实坏包和发布日志，复现共享 node_modules junction 导致的缺依赖。
- [x] 在现有测试中用真实 ASAR 夹具覆盖：缺失直接/间接依赖、嵌套与提升依赖、可选与开发依赖、哈希正确但依赖不完整的最终安装器。
- [x] 实现公共检查并接入两处门禁；用旧坏包验证拒绝，再运行定向测试。
- [x] 从独立依赖目录重建本地 NSIS 安装器，检查 22 个生产依赖、最终安装器门禁及真实 Electron 下的归档模块加载。
- [x] 同步构建参考，运行 `npm run verify:docs`、相关语法检查、`git diff --check`，审查变更与状态后归档计划。

定向测试命令：`node --test test/engineering/packaging-scope.test.js test/engineering/client-installer-integrity.test.js test/engineering/publish-release.test.js`。本次不改变业务或运行时架构，以实际安装器重建和依赖加载作为打包风险的验收，不扩展为无关全量功能测试。

## Failure handling and done when

检查失败应停止产物生成/发布，报告缺失依赖和所属包；需要在构建检出中独立安装锁定依赖，不能靠添加单个顶层依赖掩盖问题。失败时保留日志与旧安装目录，只撤回本任务自己的修改。完成条件为坏包被拒绝、相关回归通过、新本地产物通过检查及 Electron 模块加载，文档与最终 diff 已核对。

## Results

- 定向测试 37/37 通过；新增门禁前，坏包夹具在 afterPack 和最终安装器检查中均未被拒绝，回归确认缺口。
- 原已安装 app.asar 和原 `release/lira-setup-5.2.1.exe` 均被新检查拒绝，列出相同的 9 项缺失依赖引用。
- `node node_modules/electron-builder/cli.js --win nsis --x64 --publish never --config.electronDist=node_modules/electron/dist --config.directories.output=tmp/startup-dependency-fix` 成功，包括最终 NSIS 资源及依赖检查；新归档具有 22 个生产依赖包。
- 直接启动新生成的 `win-unpacked/LIRA.exe`（真实 `app.isPackaged=true`），空数据及 Partitions 目录预置在测试安装根以避免旧数据迁移，启动前确认 3000 端口空闲。进入 `/license` 登录页，全部 5 个顶层生产依赖从归档加载，QRC 加解密往返通过，未捕获 renderer 异常。
- 证据保存在 `tmp/startup-dependency-build.log`、`tmp/startup-dependency-fix/startup-verification.json`、`tmp/startup-dependency-fix/login-verified.png`。测试进程已退出，共享依赖复现用 junction 及隔离应用数据已清理；保留本地安装器供使用。
- 6 个相关 JS 文件语法检查、10 项文档检查及 `git diff --check` 通过；构建参考及发布指南已同步，用户功能和使用手册步骤未改变。没有运行全量业务测试或真实账号登录，没有提交、发布或改写原安装目录。

## Authorized 5.2.1 replacement

用户后续明确要求重新打包推送并覆盖 5.2.1；此要求授权本次提交、推送及替换既有标签/附件，不改变常规发布脚本的标签保护。使用独立 release worktree 和独立 npm ci，排除主工作区无关修改，保持版本号与安装文件名。

发布验收发现并修复三处阻塞：组件预览测试的错误状态定位匹配多个节点，改为定位画布状态 owner；历史报告引用未入库 tmp 证据，改为明确的历史路径文字；HTTP 超量请求暂停读取导致 Windows 关闭连接时偶发 ECONNRESET，改为清缓存并丢弃后续数据，保留 413、Connection: close 和 1 秒强制回收边界。HTTP owner 为 src/server/http-utils.js，直接测试为 transport/http-utils、http-server-errors 和 component-preview，技术契约同步至 backend/api.md 与 server-core.md，用户操作方式不变。

32 次完整 component-preview 文件的 8 路并发复现有 2 次原失败；新增大块 TCP 请求用例修改前稳定失败，修改后通过；相同并发组合修改后 32/32 通过。相关失败项合并定向验收后再执行统一 verify，期间冻结测试源码。构建一次并验证最终安装器、真实 packaged Electron 登录页及 QRC 依赖加载，然后冻结三份产物摘要；远端标签仅以旧标签对象精确 lease 更新，主分支正常快进。附件上传失败只重传既有已验证文件。核对 GitHub 附件摘要后完成发布；同版本需用户重新下载安装。

HTTP 验证进一步确认仅恢复读取仍可能提前关闭；最终响应写入准确 Content-Length 和完整 JSON 后等待请求 end，再关闭连接，未结束请求仍由原 1 秒上界回收。持续违规上传者可在完整响应后被重置；测试仍要求收到全部 JSON、准确长度和连接关闭，大块有限上传不允许连接错误。
