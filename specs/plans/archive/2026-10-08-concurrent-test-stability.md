# 并发测试稳定性修复计划

**Status:** Completed

**目标：** 修复排除 DSH 正在处理的六个文件后发现的五项间歇性失败，保留业务、权限、发布和事务断言，并按用户最终确认的并发 8 验证。

**架构：** 保持现有 Node 测试运行器与生产模块边界；三个子任务分别负责界面就绪、认证探针退出、导入重试断言。主任务统一检查差异、同步测试参考和运行最终并发回归。

**技术栈：** Node.js 24.21.0、node:test、Playwright、Electron 43、Windows。

## 当前证据与边界

- `tmp/test-results/run-FPXXvL/results.json`：532 文件、3960 项，3955 通过、4 失败、1 因超时取消；默认文件并发 12。
- `tmp/test-results/run-fBJI9B/results.json`：失败的五个文件定向复测 41 项全部通过；两轮期间源码指纹不变，因此不能用定向通过消除并发失败。
- DSH 已有范围：`canvas-browser-source`、`canvas-gift-components`、`component-style-library`、`background-filters-electron`、`guard-nautical-player`、`run-tests` 六个测试文件及其导入流程、运行器修改。本任务不修改这些文件，也不调整全局并发。
- 不提交、分支、发布；保留当前工作区全部既有修改。临时探针、日志和编辑前副本仅放仓库 `tmp/parallel-test-fixes/`。
- 不改变生产认证、IPC、持久化格式、权限、产品交互或用户操作说明。若诊断发现必须改生产行为，先更新本计划的证据与范围。
- 测试观察同一版本：修改涉及 DSH 浏览器组的文件前先等待该进程结束；最终验证前停止所有子任务编辑。

## 拥有者与文档

| 子任务 | 拥有文件 | 保留的验收语义 |
| --- | --- | --- |
| 界面就绪 | `test/admin/component-preview-output.test.js`、`test/desktop/danmaku-canvas-electron.test.js`，必要时专属 `test/fixtures/danmaku-canvas-editor.cjs` | 未加载的无关 owner 不阻塞发布；真实未保存草稿不能被清除；柔彩样式保存、预览、重载一致 |
| 认证探针清理 | `test/desktop/desktop-auth-race-electron.test.js`、`test/desktop/desktop-request-auth-electron.test.js` 和两个同名 `test/fixtures/*-probe.cjs` | 账号竞态、主进程凭据和沙箱隔离检查不变；仅在被测进程完成后清理专属目录 |
| 导入重试断言 | `test/scenes/component-web-import.test.js` | 临时包移动锁可重试；索引提交失败不得重新安装；错误与空库断言仍有效 |
| 统一收尾 | 本计划、计划索引、`docs/reference/engineering/test.md` | 测试规则只在所属参考维护；生产和用户行为不变时不修改用户指南 |

只读核对的生产拥有者：`src/server/component-style-install.js`、`src/server/component-web-library.js`、`src/storage/component-style-store.js`、画布自动高度与发布状态模块。

## 实施与验证

### 1. 界面就绪与异步尺寸

- [x] 用现有 fixture 和仓库 tmp 探针区分时钟自动高度晚到导致的发布状态变化、Electron 首次加载耗时和真实初始化错误。
- [x] 对确认的因果关系等待明确就绪条件，保留业务断言；不以扩大超时或移除断言代替诊断。
- [x] 定向运行两个文件，必要时注入受控加载延迟验证等待条件。

### 2. Electron 认证探针资源释放

- [x] 核对 `app.exit()`、父进程 `exit` 事件与文件锁释放之间的顺序，对照已有 graceful shutdown 探针。
- [x] 成功路径正常退出，父测试等待完成并有序清理；失败路径仍有终止保障和诊断。复用仓库 scratch helper，不使用用户数据目录。
- [x] 在多个并行隔离实例下运行两类探针，确认权限断言通过、进程退出且临时目录可清理。

### 3. 导入移动与索引失败

- [x] 在原有用例内注入首个包移动的暂态 `EPERM`，区分尝试次数与成功次数。
- [x] 保留索引失败的原错误、五次原子替换尝试和空库检查；明确断言索引失败后不重放包安装。
- [x] 运行组件网页导入 suite；不改生产重试策略。

### 4. 汇总回归

- [x] 汇总三个子任务的根因、最小差异和定向结果；停止编辑后再执行并发回归。
- [x] 同步 `docs/reference/engineering/test.md` 中实际改变的测试约定；用户指南因产品行为未变而无需修改。
- [x] 运行五文件合并定向测试及 `npm run verify:docs`，检查实际修改 JavaScript 的语法。
- [x] 运行原失败范围，按用户最新确认的并发 8 验收：

```powershell
node scripts/run-tests.js all --test-concurrency=8 '--file=test/**/!(background-filters-electron|canvas-browser-source|canvas-gift-components|component-style-library|guard-nautical-player|run-tests).test.js'
```

- [x] 前后校验源码指纹；若发现新失败，先收集并定向定位，不循环盲跑整组。
- [x] 检查本次相对编辑前副本的差异、`git diff --check` 与 `git status --short`，确认无生成物或真实数据入差异。

## 失败处理与完成条件

任一验证失败保留诊断，不削弱有效断言，不把单独通过当并发问题已修复。只撤销本任务可识别的修改，不使用整体 checkout/reset。完成要求为根因有证据、定向测试通过、同一稳定版本上原 532 文件范围按用户确认的并发 8 回归通过、文档与差异审查完成。完成后移入 archive 并更新索引。

## 进展记录

- 2026-10-08：用户授权并行修复。三个子任务已分工；DSH 先前 browser 组进程已结束，可以开始定向实施。

- 2026-10-08：三个分支已完成：时钟尺寸晚到会真实改脏已发布草稿，入口模块未加载会使首窗口的六秒状态等待提前耗尽；分别增加明确就绪等待（原业务预算不变）。认证旧实现 12 探针复现 3 个清理 EPERM，正常退出与有序清理后 12/12 通过。导入用例注入首次包移动锁稳定复现旧计数失败，改为成功计数并禁止索引失败后的再安装后 27/27 通过。两个 UI 文件 12/12 通过。
- DSH 同时将默认并发改为 8，用户随后确认按当前并发 8 运行，本任务保留该修改并按 8 验收。12 个认证探针的受控并行复现与验证保留为原始证据。另一轮并发 8 全量期间曾与子任务编辑重叠，不采用该轮作为本任务验收。
- 自动审批以 `blocked by policy` 拒绝清理旧版认证复现残留的三个本轮临时目录；已保留、不绕过，修复后的探针清理正常。
- 合并五文件回归 41/41 通过（`tmp/test-results/run-FFx9ae/results.json`）；七个修改的 JS/CJS 文件语法通过。文档检查先发现新计划状态标签使用中文未被规则识别，改为标准 `Status` 后 10/10 通过。
- 最终按并发 8 验证原范围：532 文件、3960 项全部通过，0 失败、0 取消、0 跳过（`tmp/test-results/run-gol1KW/results.json`）。指纹变化仅为明确排除且未被其他模块导入的 `test/admin/component-style-library.test.js`，纳入验证的源码与依赖未变。用户指南和生产契约因没有产品行为变更而无需修改。
