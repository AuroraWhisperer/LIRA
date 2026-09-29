# Gift Ledger Projection Sync Implementation Plan

**Status:** Awaiting Verification.

**复核日期：** 2026-09-28。完整投影实现由规格索引标记 Implemented；原计划要求的最大租户脱敏数据集性能证据未提供，本次不把源码测试当作该发布验收。

当前依据：[所属规格或参考](../gift-ledger-projection-sync_design.md)。状态索引见 [计划入口](README.md)。

## 原始计划与执行记录

以下保留原计划时点的行为、命令和验证记录；它们不覆盖上述状态或当前契约，历史未勾选项不直接等同于当前缺陷。

- Status: Active
- Date: 2026-09-01
- Owner specification: `specs/gift-ledger-projection-sync_design.md`

## Goal

Deliver a complete, source-partitioned local projection of server-authoritative
paid final gifts, including transactional bootstrap/catch-up, stale-work fences,
active-source history/statistics, and an honest partial-state gift UI.

## Non-goals

- Server ledger/outbox deletion, tombstones, export-all, or retention pruning.
- Super Chat integration or unique supporter counts.
- Redis, workers, pre-aggregation, or runtime directory rearrangement.
- Refactoring unrelated gift, danmaku, authorization, or frontend code.

## Current Behavior

- `gift_events` has no source partition and remote identity is globally unique.
- `remote-gift-cursor.json` is outside the ledger transaction and its source key
  includes subdomain/device inputs.
- A missing cursor establishes a latest no-replay baseline.
- The live importer dispatches final consumers and cannot safely import history.
- Gift history uses a recent-3000/OFFSET path and sprint eligibility, and has no
  active-source statistics endpoint.
- Gift clearing and retention can invalidate a complete remote projection.

## Ownership

- Product/contract owner:
  `specs/gift-ledger-projection-sync_design.md`.
- Server protocol evidence:
  `D:/Work/lira-server/docs/audits/2026-09-01-gift-ledger-sync-audit.md` and the
  future `docs/protocol/fixtures/gift-sync-v1.json`.
- Storage owners: `src/storage/schema.js`, `database-migrations.js`,
  `gift-sync-store.js`, maintenance and retention modules.
- Contract/import owners: `src/shared/processed-gift-contract.js` and
  `src/bilibili/gift/detection-service.js`.
- Runtime owners: remote license client/operations,
  `src/electron/remote-gift-controller.js`, `desktop-runtime.js`, and `main.js`.
- Query/UI owners: gift query service/routes and `public/.../gifts` modules.

## Compatibility Constraints

- Preserve all non-gift Bilibili features and existing live gift DTO behavior.
- Do not assign a source to legacy rows or trust the old JSON cursor.
- The Device token/source choice remain unavailable to renderer code.
- Preserve unrelated worktree changes, especially current danmaku work, and do
  not touch `.codex-review-diff.txt`.
- All SQL remains parameterized and all remote DTOs use explicit allowlists.

## Milestones

### 1. Normative contract and architecture

Add the Accepted specification, prior-spec relationship, ADR, architecture fact
updates, and this plan.

Verification: governance/spec index tests and `git diff --check` for docs.

### 2. Storage and canonical contract

Write failing migration/source-key/store/canonical/history-import tests. Append
the gift migration, enable foreign keys/UDFs, add `gift-sync-store.js`, and add
history contracts/import without live side effects.

Verification:

```text
node --test test/gifts/gift-sync-store.test.js
node --test test/gifts/processed-gift-import.test.js
node --test test/storage/database-maintenance.test.js test/gifts/gift-maintenance.test.js
```

### 3. Remote synchronization and fences

Write failing remote-client/controller tests for capability discovery, bootstrap,
epoch errors, token expiry, SSE dirty hints, four-field stale fences, and idle
drain. Implement external abort signals, SQLite state, the controller state
machine, and principal-switch freeze/abort/await/open ordering.

Verification:

```text
node --test test/license/remote-license-client.test.js
node --test test/gifts/remote-gift-controller.test.js
node --test test/desktop/electron-main-modules.test.js test/server/server-lifecycle.test.js
```

### 4. Active-source query, API, maintenance, and retention

Write failing tests for literal canonical search, composite keyset pages beyond
3000 rows, integer-cent statistics/partial status, renderer source rejection,
projection reset, and remote retention exemption. Implement the minimum storage,
query, route, and runtime active-source boundary.

Verification:

```text
node --test test/gifts/gift-query-service.test.js test/gifts/gift-routes.test.js
node --test test/storage/database-clear-all.test.js test/storage/data-clear-all-recovery.test.js
node --test test/gifts/gift-maintenance.test.js
```

### 5. Gift page

Write/extend frontend tests, then add search, range controls, summary/top/trend,
sync state, keyset navigation, and loading/error/empty states. Change clear
display into filter reset using named ESM boundaries.

Verification:

```text
node --test test/gifts/frontend-gifts.test.js test/admin/admin-page-composition.test.js
node --test test/engineering/esm-module-boundaries.test.js test/ui/ui-surface.test.js
```

### 6. Integration and release gates

Align to the shared fixture if it appears, run focused suites, then the full
repository gate. Inspect status/diff to ensure only task-owned lines changed.

Verification:

```text
npm run check
git diff --check
git status --short
git diff --stat
```

Measured production-data performance gates remain a release prerequisite but
cannot be fabricated from this source-only workspace. Record the unavailable
dataset gate explicitly if no sanitized maximum-tenant fixture exists.

## Rollback Or Failure Handling

Stop at a failing milestone and inspect only the scoped diff. Revert task-owned
changes with targeted patches; never reset the worktree or remove unrelated
files. Schema migration is append-only, so a released rollback keeps the new
nullable column/tables and disables the new controller path rather than trying
to downgrade a user database.

## Done When

All specification acceptance criteria have automated evidence, capable and
legacy server modes are both explicit, focused/full checks pass, documentation
describes the implemented runtime, and the final diff contains no unrelated
cleanup or generated review-file changes.
