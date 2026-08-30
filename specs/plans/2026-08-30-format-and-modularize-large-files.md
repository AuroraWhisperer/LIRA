# 工作区格式化与大文件模块化计划

## Goal

在保留现有 HTTP、WebSocket、IPC、页面 URL、持久化格式和 Electron 安全边界的前提下，完成用户要求的全工作区 Prettier 格式化，并将确属生产代码、且超过 600 行的高内聚大文件按既有模块化标准拆分为职责清晰、依赖方向明确的模块。

## Non-goals

- 不改变业务规则、公开契约、数据库 schema、运行时资源所有权或认证语义。
- 不新增进程、服务、框架、运行时依赖或构建步骤。
- 不为了降低行数而拆分页面拼装片段、生成文件或只包含测试夹具的文件。
- 不回滚或覆盖工作区中其他并行改动，不提交分支或版本。

## Current Behavior

工作区存在多处并行修改，且若干源文件超过 600 行。仓库当前没有统一的 Prettier 配置；用户明确要求执行 `npx prettier . --write`。部分 CSS/HTML 文件是拼装片段，单独解析时不构成完整文档，不能把格式化工具无法解析误判为运行时错误。

## Ownership

- 后端/领域：按 `docs/architecture/engineering/ai-workflow.md` 路由到 `src/storage/`、`src/bilibili/`、`src/music/`、`src/overtime/`、`src/server/`。
- Electron：`src/electron/` 及 `docs/architecture/desktop/`，保持 context isolation、safeStorage、session 和 origin 校验。
- 管理端：`public/js/admin/` 及 `docs/architecture/frontend/app.md`，保持显式 ESM/既有兼容桥。
- 测试：`test/`；仅在拆分能清晰表达测试所有权且不改变 Node test 发现规则时拆分。
- 依赖与边界：遵循 `docs/architecture/engineering/modularity-standard.md` 的组合根→适配器→应用→领域→端口方向。

## Compatibility Constraints

- 保留所有 HTTP/WebSocket/IPC 参数和响应形状、页面入口、SQLite 数据与迁移行为。
- 生产模块不得反向导入组合入口，不得新增 `window.AdminApp` 依赖、直接 SQL 或跨域可变状态。
- 拆分后的公开导出、初始化顺序、清理顺序、错误语义和异步行为必须与拆分前一致。
- 格式化不应修改字符串内容、资源路径、选择器语义或 Markdown 代码示例。

## Proposed Changes

1. 对可解析文件执行 `npx prettier . --write`；记录并单独处理故意的片段文件和工具解析错误。
2. 对超过 600 行的生产文件按职责提取纯函数、协议/契约、UI 控制器、存储适配器或 provider 子模块；入口文件只保留组合和公开 API。
3. 只在必要时为测试建立主题化测试文件或共享夹具，避免把业务逻辑放进测试 helper。
4. 更新受影响的架构事实文档与测试入口，清理本次拆分产生的重复导出/死依赖。

## Milestones

1. 格式化与清单：运行 Prettier，确认失败项属于片段或可修复写入问题。
2. 后端/桌面模块化：逐组拆分并运行对应领域测试、`npm run check`。
3. 前端模块化：逐组拆分并运行前端/ESM 边界测试。
4. 依赖审查：检查导入图、循环依赖、重复实现和架构规则。
5. 全量验收：运行文档、语法、架构和完整测试门禁，检查最终 diff/status。

## Verification

- `npx prettier . --write`（可解析文件完成；片段文件列入结果说明）。
- `npm run verify:docs`
- `npm run check`
- `npm run verify:architecture`
- 受影响领域的 focused tests。
- `npm test`
- `git diff --check`、`git status --short`，并确认无生成物/敏感数据进入差异。

## Rollback Or Failure Handling

如果拆分导致契约或测试回归，停止该组工作，仅检查并反向修改本任务新增的文件和导入；不使用 `git reset --hard`、整目录 checkout 或宽泛删除。格式化差异与行为差异保持可区分，便于按文件审查。

## Decision Record

- 600 行门槛用于承载运行时行为与依赖的生产 JavaScript（`src/`、`public/js/`、`scripts/`、`tools/`）。CSS/HTML 是声明式资源或服务器拼装片段，测试文件是按领域组织的契约/夹具；仅按物理行数继续切分它们会增加样式加载顺序、DOM 拼装和测试夹具耦合，因此不纳入机械拆分门槛。
- Prettier 使用仓库默认单引号约定；运行时数据、生成目录、依赖目录、私有抓包数据以及四个故意不完整的 HTML 结尾片段由 `.prettierignore` 排除。
- 拆分以原入口作为门面/组合根：新模块只接收显式依赖或导出纯函数、适配器和视图控制器，不反向导入 `src/server.js`、`src/electron/main.js`，也不增加新的全局桥。

## Completion Record

- 377 个生产 JavaScript 文件中没有超过 600 行的文件；最大文件是 `public/js/overlays/games-drawing.js`（599 行），其后是 `src/server.js`（592 行）和 `src/electron/license/license-manager.js`（589 行）。
- 已按所有权拆分服务端组合、存储/迁移、Bilibili 礼物与用户证据、音乐 provider/WeSing、AI、加班机、Electron 生命周期与授权，以及管理端设置、桌面歌词、小游戏、队列、礼物特效和加班规则编辑器；公开 HTTP/WebSocket/IPC、页面 URL、设置键和持久化格式保持不变。
- 依赖审计覆盖 366 个模块、539 条内部边，未发现循环依赖、组合根反向依赖或跨层直接 SQL；65 个新增生产模块均有明确消费者。清除了本次拆分产生的未使用导入/导出，并合并了加班规则编辑器中重复的帮助控件创建逻辑。
- 回归审计额外修复了拆分时遗漏的服务端/AI helper 导入，以及开场上传按钮违反现有无彩色描边规范的问题；源码文本测试改为不依赖 Prettier 的换行、引号或属性布局。
- 验证记录：`npx prettier . --write` 成功；`npm run verify:quick` 完成文档 5/5、529 个 JavaScript 文件语法检查和架构边界 9/9；`npm test` 1037/1037；最终行数扫描为 377 个生产 JavaScript、超过 600 行为 0，`git diff --check` 返回 0。

## Done When

- 可解析的工作区代码已按指定命令格式化，片段文件的限制已记录。
- 需要拆分的生产文件均不超过 600 行，或有明确的片段/夹具例外并记录原因。
- 依赖方向符合模块化标准，无新增循环、重复功能或未使用导出。
- 所有相关文档、聚焦测试和完整验证通过，且最终差异范围可解释。
