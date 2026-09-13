# 模块化审查收尾实施计划

## Goal

完成审查指出的两项格式差异和三项职责整理，配置本机已有 NSIS 工具并补跑两项此前跳过的安装器集成测试。

## Current Behavior And Ownership

- `public/pages/overlays/lyric-window.html` 和 `test/desktop-lyric-surface-ownership.test.js` 有 Prettier 3.7.4 换行差异。
- `public/css/admin/other-features/streamer-planner.css` 为 746 行；规划器视图已拆分，样式尚未配套。
- `test/database-clear-all.test.js` 的配置保留场景为 451 行，`test/server-smoke.test.js` 的完整 HTTP 场景为 243 行。
- `test/installer-directory.test.js`、`test/installer-migration.test.js` 缺少测试进程所需的编译器和插件环境变量；本机 electron-builder 缓存已有工具。
- 测试命令归 `docs/architecture/engineering/test.md`，规模登记归 `modularity-baseline.json`，完成记录归本轮模块化复评报告。

## Compatibility Constraints And Non-goals

保留当前工作区的其他修改，不提交或发布。保留规划器入口 URL、选择器、声明和级联顺序；不改变生产业务、安装行为、数据格式或认证契约。测试继续使用临时数据，不安装真实产品，不设置系统级环境变量。

## Proposed Changes And Milestones

- [x] 修正两个文件的格式。验证：使用 VS Code 插件附带的 Prettier 3.7.4 检查。
- [x] 按共享外观、日历、笔记、任务、事件弹窗及响应布局拆分规划器 CSS；稳定入口显式按原顺序导入。直接读入口的溢出测试改用已有 `readCssBundle`。验证：展开 CSS 与当前快照等价，相关布局、规划器和侧栏测试通过。
- [x] 新增 `test/helpers/database-clear-fixture.js`：按领域准备种子数据、断言配置保留和业务清理、核验结果计数；主测试保留一个完整清理流程。新增 `test/helpers/server-smoke-scenarios.js`：集中 HTTP/快照辅助方法及健康、页面下载、歌词、歌曲设置、队列清理阶段；主测试继续拥有服务启停和临时状态。验证：原 SQL/断言逐项保留，两个测试通过。
- [x] 移除已低于 601 行的三条规模登记；在测试文档中记录 NSIS 配置和运行命令，在复评报告记录结果。
- [x] 在测试进程设置 `LIRA_TEST_MAKENSIS`、`LIRA_TEST_NSIS_PLUGINS`，运行 `node --test test/installer-directory.test.js test/installer-migration.test.js`，要求实际执行且无跳过。

## Verification And Done When

定向回归：`node --experimental-vm-modules --test test/database-clear-all.test.js test/server-smoke.test.js test/desktop-lyric-surface-ownership.test.js test/frontend-select-menu-overflow.test.js test/toolbox-todo.test.js test/toolbox-sidebar.test.js test/frontend-admin-toolbox.test.js`。

最终执行 `npm run verify:quick`，在配置 NSIS 的进程执行 `npm test`，检查本轮文件 Prettier、差异和 `git diff --check`、`git status --short`。五项收尾完成、安装器场景真实执行且通过、文档记录一致后归档计划。

## Failure Handling

修改前已把目标文件和状态保存到工作区外的临时审查目录。出现失败时先定位本轮责任范围，仅修正本轮引入的问题；不以忽略断言、提高规模预算或覆盖其他工作区修改消除失败。安装器编译和执行失败保留日志供诊断。

## Execution Record

本任务在当前会话逐项执行，遵循仓库 `PLANS.md` 的位置和验证要求。

完成记录：五项收尾已完成。两个场景分别从 451/243 行缩短为 21/49 行，新辅助函数最大 59/61 行。158 处断言、68 条 SQL、15 处 HTTP 请求与测试注册表达式保持完整；110 条 CSS 规则与级联顺序一致。定向回归 43 项及独立 NSIS 回归 16 项通过。快速门禁通过（文档 5 项、708 个 JS 文件、架构/规模 22 项）；配置 NSIS 后全量测试 1816 项通过，0 失败、0 跳过。配置步骤和当前结果已写入测试策略与复评报告。代码差异按修改前快照逐项核对，未修改业务或安装逻辑。
