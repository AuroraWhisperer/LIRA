# S6-001 加班状态保存一致性实施计划

**Goal:** 手动状态保存失败时继续使用上次已提交的状态和计时锚点，允许原操作重试。

**Architecture:** 状态转换仍由 `src/overtime/overtime-service.js` 负责；构造候选状态，经现有同步 store 成功保存后才替换内存、更新锚点、调度计时器及广播。复用 SQLite 的单语句原子性及禁用时已有的状态/pending 事务。

**Tech Stack:** Node.js 24.15.0、CommonJS、现有 SQLite store、`node:test`、现有临时数据库与假时钟 fixture。

## 当前行为、依据与所有权

- 审计依据：`D:/Work/lira-audit/phase-six-findings.md` 的 S6-001。
- `setTime`、`enable/disable/start/pause/reset`、`setBackground` 先修改唯一活跃 state；`commit` 先增加 revision 再保存，异常不恢复。
- 禁用通过 `saveStateAndIgnorePending` 同事务修改状态与 pending；服务必须等待整个事务成功。
- 消费者：`src/server/routes/overtime-routes.js`、加班快照与礼物 consumer；合同为 `docs/architecture/backend/overtime.md`。
- 修改前 `node --test test/overtime-service.test.js`：24/24 通过，缺少手动保存失败回归。

## 边界和兼容约束

- 只调整加班状态提交及直接测试，补充 owning 文档和独立审计修复记录。
- 不改变 store 接口、数据库格式、HTTP/WebSocket DTO、epoch/修订号成功语义、规则格式或错误传播。
- 规则整表替换与状态保存的跨事务改造、启动恢复策略及归零失败自动重试不在本次范围。
- `materialize` 改为返回候选状态后，同步适配现有礼物、规则与归零调用，维持成功路径行为。
- 保留已有未提交的构造失败清理、清空后的重载、恢复暂停及测试。开始时三份目标文件已保存至独立审计目录的 `before/`，用于任务内差异审阅。
- 不提交、建分支或发布，不运行真实用户数据库或外部服务。

## 实施与验证

- [x] 在 `test/overtime-service.test.js` 增加保存故障回归：启用、开始、暂停、重置、初始时间、剩余时间/归零、背景。使用现有 fixture 和临时 trigger：

  ```sql
  CREATE TEMP TRIGGER fail_overtime_save
  BEFORE UPDATE ON overtime_machine_state
  BEGIN SELECT RAISE(ABORT, 'simulated state save failure'); END;
  ```

  断言异常、数据库行/快照/epoch/revision不变、未广播；移除 trigger 后原操作成功且只增加一次 revision。
- [x] 补充禁用事务第二步失败的 pending 回滚，以及失败后的倒计时和礼物补偿仍有效；检验保存成功后通知异常不撤销已提交状态。
- [x] 修改实现前运行 `node --test --test-name-pattern='save failure|disable transaction failure' test/overtime-service.test.js`，确认新测试能暴露旧状态分歧。
- [x] `materialize()` 返回当前有效时间的副本；所有手动转换只改副本；`commit(reason, nextState, options)` 在保存成功后才发布 state 与单调锚点：

  ```js
  const nextMonotonicAnchorMs = monotonicNow();
  if (options.ignorePending) store.saveStateAndIgnorePending(nextState);
  else store.saveState(nextState);
  state = nextState;
  monotonicAnchorMs = nextMonotonicAnchorMs;
  ```

  revision、updatedAt与剩余时间钳制均仅写候选对象。更新定时器和通知继续排在持久化之后。
- [x] 运行 `node --test test/overtime-service.test.js test/overtime-routes.test.js test/overtime-limits-roundtrip.test.js test/domain-services-initialization.test.js test/data-clear-all-runtime.test.js`，覆盖直接消费者与既有恢复集成。
- [x] 更新 owning 文档及审计修复记录；运行 `node --check src/overtime/overtime-service.js`、`node --check test/overtime-service.test.js`、`npm run verify:docs`。
- [x] 审阅相对本次基线的修改、`git diff --check`、`git status --short`，确认无运行数据或无关改动。完成后将计划归档。

## 失败处理及完成条件

存储错误继续抛给既有调用者，保留旧状态和计时器；保存后的通知失败不伪装成存储回滚。若实现检查不通过，只按独立基线反向修改本次拥有的差异，禁止整文件回退已有用户修改。

完成须满足：故障用例先失败后通过；重试真正落库；原倒计时、禁用 pending 与恢复集成通过；文件范围和兼容性核对完成。

## 完成结果

2026-09-12 已完成。基线 24/24；新故障回归在原实现 11/11 失败，修复后服务 36/36、最终相关组合 63/63、文档 5/5 通过，语法与差异检查通过。实际实现使用独立的 committedState 对象保存 revision/updatedAt，保存成功后发布。测试初版遇到既有 progress pending 即时重试调度问题，已拆开输入时序并记录于独立审计 README，未扩展修复。一次中断测试的临时目录清理被自动审批拒绝，路径已记录，未绕过审批。
