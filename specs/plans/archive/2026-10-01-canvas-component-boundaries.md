# Canvas component boundaries (S01–S03)

**Status:** Completed. Implemented and verified on 2026-10-01.

## Goal

Complete the structural recommendations in the [canvas audit](../../../docs/reports/2026-10-01-canvas-function-dependency-audit.md), preserving the A01–A09 fixes and the four existing production components.

## Non-goals

No fifth component, schema change, plugin engine, framework, service, public protocol change, or revival of legacy editing entry points. Preserve all unrelated working-tree changes.

## Current behavior and ownership

The passive desktop registry, browser factories, picker, scene geometry/renderer and backend adapters repeated component knowledge. Browser factories imported desktop owners, and stage had a desktop-state fallback. Scene state mixed HTTP, session and pure item adaptation. The first correctness batch is recorded in [its completion plan](2026-10-01-canvas-audit-fixes.md).

Frontend stable capabilities belong in a pure shared definition; browser factories and picker adapters belong in an explicit frontend assembly table. Backend identifiers, configuration/display ports and HTML fragments remain backend-owned. SQL v9 is historical and unchanged. Desktop owners inject data; stage consumes the factory provider. Canvas publication and legacy scene editing retain their distinct save contracts.

## Compatibility constraints

Preserve four type identifiers/order, URLs and query flags, configuration projections, shared/independent behavior, auto-height, subscriptions, undo, relay limits/lease lifecycle, authentication and source capabilities. No real account data or running desktop process is used in tests.

## Proposed changes and milestones

1. S01: declare explicit per-environment definitions; derive type consumers and picker/geometry/renderer capabilities; reject unknown registry registrations. Verify cross-environment keys, relay/cached types, actual SQLite type constraints and existing rendering/configuration tests.
2. S02: extract clock/danmaku/overtime pure factories with compatibility exports at desktop boundaries; inject layer providers; remove stage desktop fallback. Verify shared-provider start/stop behavior and no dependency path to desktop owners/state.
3. S03: separate scene HTTP port and pure item controller; replace canvas method mutation with an explicit local controller wrapper. Reuse the already-adopted save batch. Verify publication conflicts, notifications and scene editor tests.
4. Integrate and document extension ownership. Run focused suites, browser checks, syntax/architecture/docs gates and dependency graph; review final scoped diff.

Backend adapter and factory extraction work may run in separate agents with disjoint files. Frontend definitions, consumers, S03 and integration are owned by the primary agent.

## Verification

Use `node --experimental-vm-modules --test --test-reporter=spec` on affected admin/scenes/transport test files, including definition and provider regressions. Run relevant browser fixtures, `npm run check`, `npm run verify:architecture`, `npm run verify:docs`, the audit AST dependency script and `git diff --check`. Record actual commands/results below. Tests use synthetic owners, isolated databases and owned browser contexts.

## Rollback or failure handling

Snapshot second-batch inputs under repository `tmp/canvas-boundaries-2026-10-01/` before editing. On failure, inspect the scoped diff and fix or reverse only owned changes, preserving earlier repairs and concurrent work. Do not use blanket checkout/reset or alter the historical v9 migration.

## Done when

S01–S03 have an explicit completion audit; pure factories/stage have no desktop-state dependency; provider lifetimes balance; type consistency and directly affected checks pass; current contracts and docs agree; no generated/sensitive files enter the diff. Archive this plan only after verification.

## Progress

- S01–S03 implementation, integrated verification and scoped review complete.
- Existing Electron integration exposed a publication-status race also reproduced with the second-batch baseline: the canvas result can arrive before a component poll clears its dirty flag. The status now derives from the existing state subscriptions until another message replaces it. No extra polling/subscription or publication is added; a browser regression preserves real unrelated drafts then checks clean-state convergence.

## Completion audit

| Report item | Implementation and evidence |
| --- | --- |
| A01–A09 | First batch retained. Publication/concurrency, relay size, offline recovery, renderer data retention/reset and notification regressions passed again in the directly affected suites. A08 is the structural notification finding, so the report totals eight behavior defects plus four structural suggestions. |
| S01 registry / browser | Shared frontend capabilities derive stable ordering and allowed types; unknown registrations fail explicitly. Browser factories/maximum count derive from the explicit preview definitions. Registry remains passive. |
| S01 picker | Definitions provide style attributes/config conversion or an explicit default style; missing metadata no longer silently means overtime. Real browser tests cover all four types. |
| S01 backend / template / relay / recovery | Backend identifiers, ports and HTML fragment allowlist remain separate environment responsibilities. Frontend template/cache and backend contract/relay agree; `canvas` is a control session only. Tests cover prototype keys and strict type rejection. |
| S01 renderer / source / geometry | Explicit routes retain existing query flags; definitions own disconnect reset capability, resize axes and content height. Real source/output, canvas geometry and renderer state tests pass. Renderer rejects non-string types as the prior Set check did. |
| S01 storage | No production type or migration changed. An isolated SQLite test inserts every declared type through publish, rejects control/unknown types via the actual CHECK, and verifies transaction rollback. Future type additions require an appended migration; this is documented. |
| S01 legacy entry points | Scoped caller search found only compatibility exports/tests for `openComponentWorkspace` and `openSceneEditor`; no product caller. Their legacy four-type readiness checks remain intentionally unchanged, and their existing regression suites pass. |
| S02 factories / assembly | Pure clock/danmaku/overtime modules extracted; existing owner exports preserved. Queue was already pure. Browser assembly imports pure factories. Stage no longer imports desktop state; the unused desktop fallback module is removed. Desktop, browser relay and offline recovery inject providers. |
| S02 lifecycle / graph | Multiple overtime layers share one provider, stop only on last unsubscribe, tolerate repeated disposal/remount and do not start on zero-subscriber mode changes. Static VM linking rejects transitive desktop owner/state/event-bus/registry dependencies from factories, definitions, stage and item controller. |
| S03 | Existing save batch remains reused. `scene-api.js`, `scene-item-controller.js` and legacy session now have separate responsibilities. Canvas uses an explicit facade rather than mutating base controller methods; subscriptions retain stale conflict through edits, and discard reloads the correct revision. Different save interactions remain separate. |

## Verification evidence

All logs and probe scripts are in ignored `tmp/canvas-boundaries-2026-10-01/`. Counts are separate batches, not summed unique coverage.

- Final focused batch: **203/203** across 20 files (`focused-final.log`). This includes config/save-batch, registry/contracts/providers, remote/drafts/publication, frontend/backend type contracts, model/notifications, scene display/service/store/runtime/HTTP/renderer state, relay and server-danmaku settings. A stale fake DOM fixture lacked `ownerDocument`; only the fixture was updated to represent the existing field-focus contract, and all 12 owner tests passed.
- Final review additionally tested strict renderer type rejection: **8/8** in `scene-renderer-state.test.js`. S03 peer review ran **32/32** across publication, canvas-controller, item-notification and save-batch tests.
- Browser integration: **40/40** across preview browser/recovery/output, canvas editing, legacy workspace/editor and scene renderer (`browser.log`). After the final status fix, the affected preview/output/draft-browser batch passed **14/14** (`browser-final.log`), including the new late-state convergence regression.
- Existing isolated Electron integration: **1/1** (`electron-final.log`). Uses its own user/session/crash directory, in-memory database, random port, hidden window, real preload/IPC/request authorization and sandboxed child; verifies failed save/retry, successful publication, persisted size, draft refresh and reopen. It never launches the normal user profile or takes its single-instance lock.
- `npm run check`: **1,162 JavaScript files passed** (`check-final.log`); final renderer/test edits also passed direct syntax checks.
- `npm run verify:architecture`: **22/22** (`architecture-final.log`). Export syntax follows the repository scope checker's supported import/export pattern; no checker weakening.
- AST graph: **55 seeds / 135 reachable files**, no parse errors, static cycles or literal dynamic cycles. The graph is regenerated after final edits. Source/dependency snapshots and integration diff are retained in the scratch directory.
- Documentation links/status checked with `npm run verify:docs` after archive. Final `git diff --check`, task-owned source/test diff review and `git status --short` confirm no generated material or staged changes were introduced.

Focused command:

```powershell
node --experimental-vm-modules --test --test-concurrency=4 --test-reporter=spec test/admin/component-config-controller.test.js test/admin/component-save-batch.test.js test/admin/component-preview-contracts.test.js test/admin/component-preview-registry.test.js test/admin/component-preview-providers.test.js test/admin/component-preview-remote.test.js test/admin/component-preview-drafts.test.js test/admin/canvas-publication.test.js test/admin/scene-component-definitions.test.js test/admin/scene-document-model.test.js test/admin/scene-item-notifications.test.js test/scenes/scene-component-contract.test.js test/scenes/scene-display.test.js test/scenes/scene-service.test.js test/scenes/scene-store.test.js test/scenes/scene-runtime.test.js test/scenes/scene-http.test.js test/scenes/scene-renderer-state.test.js test/transport/component-preview.test.js test/danmaku/server-danmaku-settings.test.js
node --experimental-vm-modules --test --test-reporter=spec test/desktop/danmaku-canvas-electron.test.js
node --expose-internals tmp/canvas-boundaries-2026-10-01/dependencies.cjs final
```

No commits, account access, real live-stream endurance test or fifth production component. Existing working-tree changes, refresh-session lifecycle, data formats and source authorization remain intact. No unresolved report recommendation remains in this batch; future component implementation and its migration are separate work when actually requested.
