# Canvas audit correctness fixes

**Status:** Completed. Authorized on 2026-10-01 after checking the audit against the current working tree.

## Goal and current evidence

Resolve A01–A09 in [the audit](../../../docs/reports/2026-10-01-canvas-function-dependency-audit.md). All ten original defect probes reproduced on the current working tree before implementation. Preserve the existing configuration controllers, scene service/store, relay and sandbox renderer boundaries.

## Scope and ownership

- Publication: `component-preview-canvas-controller.js` and `component-preview-canvas-output.js`; reuse `component-save-batch.js`. Target the canvas and only its shared appearance owners, synchronously prepare saves, then recheck every participant before publishing.
- Recovery: `component-preview-page.js` supplies an explicit offline data provider; `component-preview-drafts.js` preserves valid snapshots per connection and handles delayed readiness without replacing cached work with defaults.
- Relay limits: `component-preview-sessions.js` owns snapshot/action limits; the HTTP route admits two maximum scene documents plus bounded metadata. Scene validation remains authoritative at its existing owner.
- Output: `scene-renderer.js` separates replaceable snapshots from a bounded 200-event pending buffer. Disconnect resets pending events and the connection state used by staging. Already consumed events are not replayed to replacements.
- Old-version projection: scene service issues a signed projection receipt bound to owner scope/epoch, scene, capability, item selection, version and a fixed allowed type list. The parent polls with the active receipt until successful commit. Only the current and authenticated active types are projected. No history database or unbounded server cache; receipts become invalid after service restart, owner change or capability rotation and cause output revocation. Old clients may omit the new optional parameter and retain existing behavior.
- Notification scope: `createSceneItemController` selects immutable model snapshots and deduplicates appearance state; independent instances ignore default-owner notifications. Canvas layers rebuild only when displayed fields change; preview config delivery is deduplicated.
- Contracts: `docs/reference/backend/api.md` and `docs/reference/frontend/overlays.md` describe the changed publication, relay and output boundaries.

## Non-goals and compatibility

S01/S02 remain recommendations before adding a fifth component, not a prerequisite for these fixes. S03 save-helper reuse is included; unrelated module extraction is excluded. No schema migration, dependency, new framework, account access, real user data, commits or changes to Electron protections. Preserve pre-existing edits; task-start copies are under `tmp/canvas-fixes-2026-10-01/baseline/`.

## Milestones and focused verification

- [x] A01/A02: regression tests for independent-only scenes, unavailable shared owners, untouched unrelated drafts, partial save failures, concurrent owner/canvas edits and owner generation changes. Browser flush and desktop publication must select the same dependencies.
- [x] A06/A07: unit tests for partial readiness, preservation, delayed restore and storage failure; existing real-browser recovery fixture expanded to all four types and mixed scenes. No pageerror, invalid-session subscription, write or publish from offline recovery.
- [x] A03: real HTTP tests for distinct UTF-8 saved/draft documents, open/edit/exchange, oversized documents and oversized envelopes.
- [x] A04/A05/A09: deterministic renderer state-machine tests plus service/renderer integration for removed queue/overtime/danmaku types, bounded events, reset/epoch/gap, staging failures, successful release and invalid projection receipts. Run the real browser scene renderer test.
- [x] A08: count notifications for 32 instances, appearance/default changes and gesture/undo; retain existing canvas/browser sizing checks.
- [x] Run focused admin/scene/relay suites with `node --experimental-vm-modules --test --test-reporter=spec <affected tests>`. Run `npm run check`, `npm run verify:docs`, `npm run verify:architecture`, and `node --expose-internals tmp/canvas-fixes-2026-10-01/dependencies.cjs final` for the changed protocol and dependencies.
- [x] Review task-owned changes against the baseline, `git diff --check`, and `git status --short`; record exact outcomes and archive this plan only after verification.

## Failure handling and done conditions

Keep partial successful owner saves; never roll them back across domains. Stop publication if a participant is unavailable, conflicting or has new work. Preserve drafts on any save/network/storage failure and retain old output only while its authority remains valid. Revert only task-owned hunks if needed. Completion requires inverse regression assertions for each defect, consistent contracts, no dependency cycles and proportional verification; live accounts and OBS/Livehime endurance testing are outside the isolated fixtures.

## Completion evidence — 2026-10-01

- Original audit probes: 10/10 reproduced before editing. The report counts eight behavioral defects plus four structural suggestions; A08 is the measured structural item. This plan resolves A01–A09 and reuses the S03 save helper; S01/S02 and unrelated API/adapter extraction remain future recommendations.
- Focused final batch: 219 passed, 0 failed across 18 admin/scene/transport files; invocation is recorded in the task session, results in `tmp/canvas-fixes-2026-10-01/focused.log`. One more normalization/concurrent clean-replacement regression was then added; `test/admin/canvas-publication.test.js` passed 7/7. Counts describe batches, not summed unique coverage.
- Browser final batch: 34 passed, 0 failed across preview browser/recovery/output, canvas editing, scene editor and real scene output tests. Results: `tmp/canvas-fixes-2026-10-01/browser.log`. Includes real HTTP/service polling through failed removed-type replacement, subsequent commit and source rotation, and mixed offline recovery with an incomplete owner cache.
- `npm run check`: 1,152 JavaScript files passed. `npm run verify:architecture`: 22/22 passed. `npm run verify:docs`: 9/9 passed both before and after archive.
- Dependency graph: 53 seeds / 132 reachable modules; zero parse errors, static cycles or literal-dynamic-import cycles. The audit's original artifacts were preserved; the updated graph is in the task scratch directory.
- A08 measurement: moving one of 32 independent instances produces zero appearance notifications (previously 32); appearance edits, shared defaults, gesture and undo assertions pass. No FPS or Electron endurance claim.
- A03 real HTTP fixture uses distinct valid UTF-8 saved/draft scene documents near the per-document limit. Open/edit/exchange succeed; oversized document and envelope return 413 without ending the valid session.
- Normalization was found to add legitimate queue defaults. Publication captures the first canvas save's normalized content/revision and rejects later clean replacement as well as dirty changes.
- Concurrent refresh-session changes were preserved, including detach/attach semantics, lease behavior, related tests and documentation. They are not attributed to this audit fix.
- Source diff reviewed against the task-start baseline; whitespace/status checks passed. No commits, generated runtime data, credentials or test artifacts added to the product diff. Test servers, browsers and in-memory databases were fixture-owned and closed.
- Limits: no real live account, user Electron process, OBS/Livehime endurance run or new fifth component was exercised. Projection receipts are optional for old clients; new clients clear the active receipt and reload the current publication after service restart. Persisted scene documents and source tokens keep their prior formats.
