# Runtime Correctness Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 核实并修复审计确认的八项云同步、盲盒配置、金额边界和退出生命周期问题，使本地与云端状态不会因竞态或重启被静默覆盖，并让两个进程都能在现有退出预算内排空。

**Architecture:** 保持现有模块化单体和公开接口不变。云同步控制器以每个 scope 的本地 mutation 代次保护上传与拉取；盲盒配置继续由既有规范化器拥有验证；Electron 组合根先停止 ingress、等待两个控制器 idle，再关闭 runtime；lira-server 在关闭存储前主动结束三类 SSE。金额仍规范化为两位小数，但所有要求为正的值在规范化后必须仍为正。

**Tech Stack:** Node.js 24+/20+、CommonJS/ES modules、Electron 43、原生 `node:test`、SQLite。

## Global Constraints

- 不新增依赖、服务、进程、IPC/API 路由、设置键或持久化格式。
- 保留两个脏工作区中所有无关修改与未跟踪文件；不提交、不清理、不做破坏性回滚。
- 测试只使用内存 fixture 或临时数据库，不读取真实用户数据。
- 既有空字符串与合法 `[]` 都解释为用户明确清空；新安装仍从 `DEFAULT_SETTINGS` 获得五个默认盲盒。
- `unitPrice` 可为零，`totalPrice` 和盲盒价格必须在两位小数规范化后仍大于零。
- Electron 与 lira-server 的公开 wire schema、租户边界、授权和 5 秒退出上限保持不变。

---

## Goal

八项报告逐项得到运行时或测试证据；确认项以最小 owner-layer 修改关闭，相关规范与事实文档保持一致。

## Non-goals

- 不处理 localhost overlay fallback、缓存容量、静默搜索错误、开发依赖审计或 ESM 审计器误报。
- 不引入字段级云合并、CRDT、跨进程队列、SSE replay 或新的配置版本系统。
- 不重构相邻设置路由、默认盲盒目录、Electron 主进程或 lira-server 路由结构。

## Current Behavior

- `cloud-sync-controller.js` 用一个 `Set` 表示 dirty，上传完成无条件删除；songs/Bilibili 在首次 dirty 检查后还等待远端读取。
- 本地设置路由只字符串化 `giftBlindBoxConfig`，Admin 删除最后一项和手工清空都会提交空字符串；启动迁移把空字符串和 `[]` 重新填入默认项。
- Electron `before-quit` dispose 两个控制器后立即关闭 runtime，没有等待其已有 operation 链。
- 四个金额入口在原始正数校验后四舍五入，`0.001` 可变成 `0`。
- lira-server 的三个 SSE handler 持有长期响应，进程关闭路径没有先结束这些响应。

## Ownership And Compatibility

- 云同步与 Electron 生命周期：`src/electron/cloud-sync-controller.js`、`src/electron/main.js`；消费者为本地 runtime、license manager 和远程礼物 controller。
- 盲盒配置：`src/bilibili/gift/blind-box-config.js` 是本地规范化 owner，`src/server/routes/settings-routes.js` 只编排，`src/storage/settings-migrations.js` 只做启动兼容迁移，Admin 只提交合法 JSON 字符串。
- 服务端 wire DTO 与盲盒验证：`D:/Work/lira-server/src/modules/bilibili/gift-event-service.js`、`src/lib/gift-blind-box-config.js`；当前 protocol 要求两位小数和正盲盒价格。
- 服务端 SSE 生命周期：三个现有 route cleanup 回调仍各自拥有 timer/unsubscribe；共享关闭入口只触发这些 cleanup，不改变事件或认证契约。

## Milestone 1: Cloud Sync Races

**Files:**
- Modify: `src/electron/cloud-sync-controller.js`
- Modify: `test/cloud-sync-controller.test.js`
- Modify: `docs/architecture/desktop/main.md`

**Interfaces:**
- Consumes: `markDirty(scope)`, `syncNow()`, runtime snapshot/apply methods and license-manager reads/writes.
- Produces: unchanged controller API; internal per-scope mutation generation prevents stale dirty deletion and stale pulls.

- [x] Add a deferred upload regression proving a second mutation during the first upload produces a second upload with the newer snapshot.
- [x] Add deferred songs and Bilibili pull regressions proving a local mutation after the first applicability check prevents the old cloud payload from being applied.
- [x] Capture the scope generation before upload and delete dirty only when it is unchanged; re-check dirty/revision after each awaited remote pull and immediately before applying locally.
- [x] Run `node --experimental-vm-modules --test test/cloud-sync-controller.test.js`; expect all cases to pass.

## Milestone 2: Blind-box Validation And Empty Persistence

**Files:**
- Modify: `src/server/routes/settings-routes.js`
- Modify: `public/js/admin/settings-blindbox.js`
- Modify: `src/storage/settings-migrations.js`
- Modify: `test/blind-box-defaults.test.js`
- Modify: one focused settings-route test and `test/frontend-gifts.test.js`
- Modify: `docs/architecture/backend/storage.md`

**Interfaces:**
- Consumes: `normalizeGiftBlindBoxConfig(input)` with arrays of `{name, price, outputs}`.
- Produces: the existing `giftBlindBoxConfig` setting as canonical JSON text, including canonical `[]` for an explicit empty list.

- [x] Add route cases for empty string, malformed JSON, empty outputs and a valid array; invalid values must return 400 without a settings write, valid input must persist normalized JSON.
- [x] Add Admin source/behavior coverage proving deletion of the final item and an empty advanced save submit `[]`.
- [x] Add migration cases proving both `''` and `'[]'` persist as `'[]'` across repeated bootstrap while non-empty legacy configs still upgrade and append missing historical defaults.
- [x] Route `giftBlindBoxConfig` through the existing normalizer; serialize only the accepted normalized array. Change the Admin empty representation to `[]` and make the migration return before default merging for an explicit empty list.
- [x] Run the directly affected settings, frontend and migration tests; expect invalid payloads rejected and empty lists stable across restart.

## Milestone 3: Electron Shutdown Drain

**Files:**
- Modify: `src/electron/main.js`
- Modify: `test/electron-main-modules.test.js`
- Modify: `docs/architecture/desktop/main.md`

**Interfaces:**
- Consumes: both controllers' existing `dispose()` and `whenIdle()` methods.
- Produces: unchanged app shutdown behavior, ordered as dispose/abort -> await controller operations -> runtime shutdown -> DB close.

- [x] Add a composition assertion for both controllers being drained before `lifecycleState.shutdown` starts.
- [x] Retain controller references, dispose them, await both `whenIdle()` promises, then invoke runtime shutdown under the existing 5-second force timer.
- [x] Run the Electron module/controller focused tests; expect shutdown ordering and existing cleanup cases to pass.

## Milestone 4: Two-decimal Positive Money Boundary

**Files:**
- Modify: `src/bilibili/gift/blind-box-config.js`
- Modify: `src/shared/processed-gift-contract.js`
- Modify: relevant Live gift contract tests
- Modify: `D:/Work/lira-server/src/lib/gift-blind-box-config.js`
- Modify: `D:/Work/lira-server/src/modules/bilibili/gift-event-service.js`
- Modify: relevant lira-server gift tests
- Modify: lira-server normative requirement/acceptance text required by its repository instructions

**Interfaces:**
- Consumes/produces: unchanged JSON numeric fields and error codes.
- Rule: compute the two-decimal value, then reject it when a positive contract would emit zero; zero `unitPrice` remains legal.

- [x] Add `0.001` regressions for blind-box price normalization and processed gift `totalPrice` projection in both repositories.
- [x] Validate positivity after rounding without changing maximums, signed profit semantics or nullable fields.
- [x] Run the focused gift tests in both repositories; expect `0.001` rejected wherever the contract requires a positive emitted value.

## Milestone 5: lira-server SSE Shutdown

**Files:**
- Modify: the three SSE route cleanup owners and/or one shared lifecycle registry under `D:/Work/lira-server/src/`
- Modify: `D:/Work/lira-server/src/app.js`
- Modify: focused SSE/shutdown tests
- Modify: lira-server requirement and acceptance-criteria documents

**Interfaces:**
- Consumes: each SSE handler's existing idempotent cleanup callback.
- Produces: one internal `closeAll` operation invoked before storage closes; HTTP routes and event payloads remain unchanged.

- [x] Add a test opening cloud-state, gift and public overlay streams, invoke the shutdown close operation, and prove all responses end and listener/timer cleanup is idempotent.
- [x] Register each live SSE cleanup with a process-owned close registry and unregister it on normal disconnect.
- [x] Stop new ingress, close registered SSE responses, then close stores and let `server.close()` complete within the existing timeout.
- [x] Run focused SSE tests and lira-server `npm test`; expect all connections to close without the forced exit path.

## Verification

- Live focused: cloud sync, blind-box defaults/settings/frontend, processed gift, remote gift, Electron module tests.
- Live static/full: `npm run check`, `npm test`, `npm run verify:architecture`; record the known unrelated ESM-auditor result rather than changing `danmaku-feed.js` unless the task-owned diff affects it.
- lira-server focused gift/SSE tests, `npm run docs:check`, then `npm test`.
- Both repositories: `git diff --check`, `git status --short`, scoped diff review, and secret/generated/runtime-material inspection.

## Results

- All eight reported runtime findings were reproduced and confirmed.
- Live focused regressions, `npm run check` (543 files), `npm run verify:docs` (5/5), `npm run verify:architecture` (9/9), and `npm test` (1098/1098) passed.
- lira-server focused SSE/gift regressions, `npm run docs:check` (27/27), and `npm test` (233/233) passed.
- Existing untracked `.codex-review-diff.txt` and `catalog/` entries were preserved; no commit or cleanup was performed.

## Rollback Or Failure Handling

Stop on a normative conflict or failing focused reproduction. Reverse only task-owned hunks with `apply_patch`; never reset, checkout, delete broad paths, touch real databases, or remove the pre-existing `.codex-review-diff.txt` and `catalog/` entries.

## Done When

- All eight findings have a recorded confirmed/not-confirmed conclusion.
- Confirmed cloud races cannot erase a newer dirty mark or apply a stale songs/Bilibili pull over a local mutation.
- Invalid blind-box settings return 400, every empty UI save is canonical `[]`, and empty config survives repeated startup.
- Electron waits for both controller operation chains before closing runtime storage.
- Positive prices/totals cannot normalize to zero in either repository.
- All three lira-server SSE types close through graceful shutdown before storage close.
- Focused tests and justified full gates pass or any unrelated pre-existing limitation is stated precisely; final diffs contain only task-owned source/test/doc/plan changes.
