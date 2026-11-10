# 场景房主资料读取的职责与清理

Status: Completed

归档记录：资料缓存的职责归位及销毁回归已完成，保留复现与验收证据。全仓文档门禁的独立失败见下方；现行合同以 reference 文档为准。

## Goal

在继续复核模块粒度时，将场景房主资料的缓存、请求与销毁归到同一拥有者，防止场景运行时销毁后仍启动排队的资料读取或处理迟到结果。

## Current Behavior

`src/server/scene-runtime.js` 的组合逻辑中嵌有房主资料缓存：按账号 scope/epoch 和房间去重，30 秒后重读，异步投影四个公共字段并通知场景。`dispose()` 清理榜单和显示通知，却没有清理资料读取。`Promise.resolve().then(getRoomProfile)` 因此可以在同一轮销毁之后才启动。

现有 `test/scenes/scene-runtime-events.test.js` 基线 16/16 通过，已覆盖非阻塞读取、请求去重、公共字段投影及账号/房间不匹配；尚未覆盖资料读取的销毁。先加回归确认该缺口，再改实现。

## Ownership And Proposed Changes

- 新建 `src/server/scene-room-profile.js`，通过 `getOwner`、`getRoomId`、`loadProfile`、`onUpdate` 窄能力持有完整缓存与异步工作。提供 `getSnapshot(roomId)` 和幂等 `dispose()`。
- `scene-runtime.js` 只装配该拥有者，把结果补入已有 cloud snapshot，并在统一销毁中清理它。资料读取不接受完整 displayPorts 或 runtime。
- 保留现有场景集成测试；用其隔离 SQLite 夹具补销毁前尚未启动与已在途读取的回归。缓存规则保持原样，沿用已有非阻塞、去重、字段隔离及账号/房间切换覆盖。
- 技术归属更新 `docs/reference/backend/server-core.md`、`docs/reference/frontend/overlays.md`，在原职责审查报告追加复核结论。

## Non-goals And Compatibility Constraints

不改 HTTP/WS/IPC、持久化、凭据或授权规则；不把资料读取改为第二条上游订阅。保留请求去重、30 秒结果缓存、失败返回 null、房间及账号检查、公共字段过滤和不阻断消息交付。

底层 `getRoomProfile()` 没有取消参数：销毁将阻止尚未启动的调用、失效在途结果，不声称能中断已开始的网络请求。用户界面、操作步骤及指南无需改变。

继续检查的 `shared/utils.js`、`ws.js`、预览工厂和短模块中暂未确认值得合并的对象。保留有明确消费者、纯预览边界、独立状态或兼容合同的模块，不为减少文件数合并。

不修改相邻服务器仓库，不接管其他工作区修改，不提交、分支、打包或发布。

## Milestones And Verification

- [x] 以已有集成夹具复现销毁后启动资料读取，保留失败证据。
- [x] 迁移完整资料缓存并接入销毁，运行场景与 B 站房主资料回归。
- [x] 同步技术文档与审查结论，执行架构/文档门禁、语法与差异检查；明确记录独立文档门禁失败。

定向命令：

```powershell
node --experimental-vm-modules --test test/scenes/scene-runtime-events.test.js test/scenes/scene-display.test.js test/bilibili/bilibili-room-profile.test.js
npm run verify:architecture
npm run verify:docs
node --check src/server/scene-room-profile.js
node --check src/server/scene-runtime.js
node --check test/scenes/scene-runtime-events.test.js
git diff --check
git status --short
```

不运行全仓业务套件或 UI 自动化：变化限于后端资料读取拥有者，现有输出集成覆盖其消费者，不改变渲染。

## Rollback Or Failure Handling

`tmp/module-responsibility-followup-2026-11-10/before/` 保存本轮相关文件基线；只对照并撤回本任务行，不回退整个文件或工作区。发现行为差异时在该拥有者修复，不放宽既有断言。保留异步失败与最终验证日志。

## Done When

销毁回归通过，资料读取合同及现有场景集成保持；技术归属和报告同步，最终任务差异及工作区检查完成，并如实记录未运行的检查。

## Execution Evidence

- 修改前 `scene-runtime-events.test.js`：16/16 通过，见 `tmp/module-responsibility-followup-2026-11-10/baseline.log`。
- 新增销毁回归在旧实现下两分支均失败：排队读取在销毁后仍调用 provider 一次；在途完成仍调用已销毁的通知能力一次。见同目录 `reproduction.log`。
- 迁移并接入清理后，三文件定向回归 40/40 通过，见同目录 `focused.log`。
- `npm run verify:architecture`：29/29 通过，见 `architecture.log`。三个变更 JavaScript 文件的 `node --check` 通过。
- `npm run verify:docs`：9/10 通过，链接、路由及本任务材料均通过；唯一失败为并行新增的 `specs/plans/2026-11-10-advanced-lyric-expressions.md` 使用 `状态：In Progress`，现有校验器只接受 `Status:` 标签。未改动该计划，见 `docs.log`；归档后复核见 `docs-final.log`。
- 已对照本轮基线复核源码、测试、技术说明和报告差异，保留其他任务改动；`git diff --check` 通过，检查了最终 `git status --short`。未加入生成物、运行时数据或凭据。
- 用户指南不变：页面、操作、设置和公开响应未改变。未运行完整业务套件、Electron 或真实 B 站请求；测试使用内存 SQLite 和合成资料 provider。未提交、打包或发布。
