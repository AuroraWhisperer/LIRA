# Client efficiency and ownership implementation plan

**Status:** Complete — 2026-09-16.

**Goal:** Address the seven findings from the September 16 client review: state ordering, form drafts, repeated snapshot work, Admin dependencies, playback state writes, gift persistence ownership, and eager tool initialization.

**Architecture:** Keep the Electron embedded modular monolith, existing ESM frontend, and existing wire/storage contracts. Consolidate state acceptance and domain writes; initialize optional editing surfaces on first use while preserving background behavior.

**Tech stack:** Electron 43, Node.js 24+, vanilla JavaScript, native CSS, SQLite, node:test.

## Constraints and scope

- Preserve HTTP/WebSocket/IPC shapes, persisted formats, settings keys, auth and shutdown behavior.
- No new dependencies, processes, framework, schema changes, commits, or branch changes.
- Tests use stubs or isolated temporary databases, never user data.
- Migrate the reviewed Admin queue/state slice; other legacy modules remain incremental debt.
- Preserve gift finalization, cursor and consumer idempotency semantics and transaction ordering.

## Current behavior and ownership

The review reproduced an older HTTP state response replacing a newer WebSocket snapshot and a settings event replacing an unsaved gift-frame threshold. Full snapshots repeatedly query song metadata and drive unrelated Admin rendering. Playback distributes one mutable state object. Gift projection and statistics issue SQL inside the domain. Hidden tool editors initialize during startup.

| Area | Owners | Consumers/contracts | Protection |
| --- | --- | --- | --- |
| Admin state/drafts | `public/js/admin/state.js`, `gift-frame.js` | Admin events, `docs/architecture/frontend/comms.md` | new state-ordering and draft behavior tests |
| Snapshot/rendering | `src/storage/song-store.js`, `src/server/domain-services.js`, Admin state/queue/app | unchanged `/api/state` and snapshot fields | song-store, Admin runtime and new render tests |
| Playback writes | `public/js/playback/state/`, `features/`, `operations/`, `controller.js` | `docs/architecture/frontend/playback.md` | playback controller, queue, persistence and provider tests |
| Gift persistence | `src/bilibili/gift/`, `src/storage/` | `docs/architecture/backend/bilibili/gift.md` | projection/import/sync tests, module boundaries |
| Optional editors | `public/js/admin/app.js`, `other.js`, tool modules | toolbox navigation and `docs/architecture/frontend/app.md` | toolbox, opening, clock and lifecycle tests |

## Milestones

- [x] **1. State acceptance and drafts.** Route HTTP and WS snapshots through one acceptance function. Track HTTP request generations and realtime field changes so an older response cannot regress fields updated after it started. Preserve lyric/overtime ordering. Emit settings updates only on actual changes. Track gift-frame drafts and preserve edits made while saving. Add failing behavioral reproductions, then make them pass.
- [x] **2. Domain-specific rendering and song metadata reuse.** Supply changed snapshot fields to an Admin rendering coordinator; settings, gift, queue, live and song metadata rendering run only for their inputs. Queue uses named imports/exports and owns queue/SC rendering only, with existing compatibility publishing centralized in the bridge. Cache song category/tag/count reads at the owning store with invalidation for every write and external database changes. Add behavior tests for unchanged snapshots and metadata invalidation.
- [x] **3. Playback state ownership.** Establish meaningful state write operations, migrate queue/track/provider changes through their owner, and centralize persistence/render notifications where a completed state action requires them. Preserve object identity for existing readers and preserve async request invalidation. Verify existing playback behavior and add tests for notification/save ordering.
- [x] **4. Gift persistence ports.** Extract projection reads/writes and statistics transaction into `src/storage/` adapters. Domain projection retains validation, finalization decisions and retry lifecycle; existing facade supports current consumers. Use the original transaction semantics and extend structural coverage. Run projection, processed import and sync regressions.
- [x] **5. Optional editor activation.** Activate low-frequency toolbox editors on first navigation, including remembered selection and programmatic navigation. Preserve essential background subscriptions; hydrate current state on activation. Avoid duplicate initialization. Verify first entry, repeated entry and cleanup.
- [x] **6. Final documentation and gates.** Update owner docs, debt records and exact-file baselines for changed responsibilities. Format touched files, run relevant behavior tests and the full repository gate, inspect final diff, `git diff --check` and `git status --short`.

## Verification commands

Focused commands use `node --experimental-vm-modules --test <affected test files>`; exact file lists and outcomes are recorded below as each milestone finishes. Final checks: `npm run verify:quick`, `npm test`, `git diff --check`, `git status --short`.

## Failure handling

Keep each milestone independently inspectable. If a behavior regression occurs, use its focused reproduction to repair the owning change before proceeding. Reverse only task-owned hunks if a design must be abandoned; never reset or overwrite unrelated work. Do not optimize by weakening ordering, atomicity, or cleanup guarantees.

## Done when

All seven findings have concrete scoped implementations and behavioral evidence. Wire/storage/security contracts remain compatible, the touched diff contains no user/runtime data, relevant docs agree with the implementation, and the final gate passes or any genuinely external limitation is explicitly recorded.

## Execution notes

- Initial working tree clean. Prior review: 22 architecture checks and 21 Admin/WebSocket checks passed; two bugs reproduced with isolated mocks.

- State/draft reproductions passed; Admin rendering and metadata suites passed. Playback queue, persistence, provider and recovery checks: 66 passed. Gift projection/import/sync/domain checks: 42 passed.
- Optional activation covers four editor surfaces. Overtime initialization receives the current snapshot through the composition root; no extra StateService dependency is introduced. Toolbox/state action focused checks passed.
- Full-gate first pass exposed old global overtime initialization in VM/browser fixtures and an ESM alias audit limitation. Migrated fixtures to the actual named initializer; all 58 related browser/editor/ESM tests passed. Kept the existing VM module cache but linked each graph once, matching the shared test helper, so shared state-action imports resolve correctly.
- Review added a reconnect regression: a connect snapshot can accept a restarted overtime revision, while in-flight older HTTP cannot restore the previous server state. Focused state/draft/gift/queue/toolbox run: 28 passed.
- Final `npm run verify:quick`: passed (5 documentation checks, syntax checks for 774 JavaScript files, 22 architecture checks). Final `npm test`: 1,950 passed, 4 skipped, 0 failures across 1,954 tests. Browser editing/save tests use the existing isolated Playwright fixtures.
- Final diff reviewed, `git diff --check` clean, and status contains only implementation, tests, architecture documentation and this plan. No runtime data, dependencies, generated artifacts, commits or branches were added. Unrelated formatter changes were removed after the gate; the final focused playback check confirms that cleanup.
- Limits: no real livestream load test or measured startup/CPU benchmark. Admin global migration covers queue/state rendering and the lazy overtime entry; other registered legacy modules remain tracked debt.
