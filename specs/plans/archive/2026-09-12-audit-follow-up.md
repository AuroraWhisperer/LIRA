# Audit follow-up fixes implementation plan

Status: completed. Executed in this task; no commits or deployment.

## Goal and current behavior

Fix the three independently reproduced review findings: unavailable variant catalog discards legacy private blind-box valuation; database clear-all resets the overtime revision below an attached OBS source; stale runtime PID metadata can authorize stopping an unrelated Node entry point.

## Ownership and boundaries

- Server `src/modules/bilibili/gift-detector.js` owns valuation; the real `MonitorManager` wiring and `REQ-GIFT-006` / `AC-GIFT-006` define compatibility. Only unavailable catalog handling for confirmed legacy blind-box events changes; valid catalog identity/ambiguity checks remain in force.
- Client `src/storage/database-maintenance.js` owns the transactional clear-all reset. Advance the persisted revision during the existing giftDb transaction. `overtime.reloadState()` and the existing overlay revision guard consume the result. Keep default disabled/zero state, rollback behavior and all wire/schema shapes.
- Client `src/server/lifecycle.js` owns previous-instance cleanup. Require exact owning executable or supported absolute runtime entry arguments, rather than generic suffix or root substring matching. Recheck identity before a forced stop; preserve authenticated/graceful shutdown behavior and legacy service health compatibility.
- Preserve all existing working-tree changes. No dependencies, processes, schema migrations, API additions, unrelated cleanup, commits or deployment.

## Milestones and verification

- [x] Add `test/monitor-legacy-valuation.test.js`, using the real manager, isolated in-memory tenant DB and catalog disabled/null/throwing fixtures. Confirm mapped value 9, cost 15, profit -6; retain explicit upstream cost and valid catalog ambiguity checks. Run before the fix to observe failure. Require a non-null variant snapshot before replacing the matched legacy valuation. Update the requirement, acceptance and protocol clarification with this condition.
- [x] Extend `test/overtime-service.test.js` and existing Chromium fixture in `test/ui-edit-state.test.js`. Use real isolated databases/service to clear an active state, then deliver its new snapshot and a subsequent operation on the same socket; delayed old HTTP state must remain ignored. Before replacing the singleton row, derive its next revision in the same INSERT statement: `COALESCE((SELECT revision + 1 FROM overtime_machine_state WHERE id = 1), 0)`. Update storage/overtime owner documentation.
- [x] Extend `test/server-lifecycle.test.js` with unrelated paths, sibling prefixes, exact owned entries and PID reuse during graceful waiting. Mock every process query/signal. Remove generic path ownership evidence, require exact normalized absolute entry arguments for Node/Electron, and obtain fresh process/health identity before any fallback termination. Update lifecycle owner documentation.
- [x] Run focused checks, then justified client/server full suites and governance gates. Inspect task-only diffs against the saved pre-edit baseline, `git diff --check` and status. Save a short Chinese final note covering the original audit work and these three fixes.

Focused commands:

```powershell
# D:\Work\Live
node --experimental-vm-modules --test test/overtime-service.test.js test/database-clear-all.test.js test/database-maintenance.test.js test/ui-edit-state.test.js test/server-lifecycle.test.js
# D:\Work\lira-server
node --test test/monitor-legacy-valuation.test.js test/gift-variant-valuation.test.js test/bilibili-gift-detector.test.js test/bilibili-blind-box-valuation.test.js test/monitor-login-gate.test.js
```

Final gates: client `npm.cmd run verify:quick` and `npm.cmd test`; server `npm.cmd run docs:check` and `node --test`. All tests must use temporary or in-memory state and no real platform calls or process signals.

Results: focused client 103/103, server 43/43; final client 1681/1681, server 1073/1073. Client quick gates and server documentation 33/33 passed. The client full command used the package test command with the TAP reporter; its earlier five selected regression tests failed before the fix, and the server's three unavailable-catalog cases failed before the fix. Evidence is under `D:/Work/lira-audit/recheck/2026-09-12-current-code/fixes`. The short user-facing outcome is `D:/Work/lira-audit/final-summary.md`; real packaged/platform/deployment acceptance remains pending.

## Completion and failure handling

Done when all three behaviors and existing relevant contracts pass their tests, the final diff is limited to these fixes/tests/contract notes, and the concise final explanation records results and outstanding real deployment/platform acceptance. Keep historical failing review probes as evidence; a synthetic revision-zero overlay probe is superseded by the real storage-to-overlay regression because the owning fix stops emitting a reset revision. On failure, inspect and reverse only this task's edits using the baseline under `D:/Work/lira-audit/recheck/2026-09-12-current-code/fixes/before`; never reset the repository or remove user changes.
