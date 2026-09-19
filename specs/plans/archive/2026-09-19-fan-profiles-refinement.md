# Fan profiles refinement implementation plan

**Goal:** Order profiles by the synchronized fan medal level, simplify the workspace, fill its available height, and restore the toolbox navigation arrow.

**Status:** Complete, 2026-09-19.

**Architecture:** Keep roster parsing in `src/bilibili/guard-roster.js`, import evidence in `src/fans/guard-roster-import.js`, and list ordering in `src/fans/profile-service.js`. Keep layout and copy in the existing fan frontend files. Vanilla ESM, native CSS, CommonJS backend; no dependencies.

## Boundaries and compatibility

- Current roster parsing drops medal levels; profile lists sort by interaction time. Fixed minimum and viewport-based panel heights cause nested outer scrolling and unused space.
- Store the optional medal level in the existing membership record's original evidence. Old evidence remains readable; no schema migration or backup-version change. Only medals belonging to the resolved room owner count.
- Missing levels sort after known levels; ties keep the existing recency ordering. Repeated imports must remain idempotent while allowing medal-level changes on the same day.
- Preserve private profile fields, membership decisions, tenant isolation, IPC actions, and existing backup/restore behavior. UID remains in details. Keep internal content scrolling accessible.
- Non-goals: other toolbox surfaces, membership inference, automatic-fact protocol changes, releases or commits.

## Delivery and verification

- [x] Add focused parser/import tests for owner-matched levels, descending ordering, legacy evidence, same-day changes, restart, and backup restore. Implement the parser, evidence, and comparator changes; update `specs/fan-profiles.md` with the requested ordering.
- [x] Remove duplicate heading and promotional empty-state copy, UID/recent-interaction rows; keep useful summaries and reminders. Add the existing navigation arrow. Replace fixed panel heights with a bounded flex/grid workspace.
- [x] Run `node --test test/bilibili-guard-roster.test.js test/fan-profiles-guard-roster.test.js test/fan-profiles-domain.test.js test/fan-profiles-transfer.test.js test/fan-profiles-ipc.test.js` and affected admin composition/style tests. Inspect the desktop renderer with fixture content, including long lists/details, reminders and the more menu.
- [x] Run changed-file syntax checks, `git diff --check`, inspect the final diff and `git status --short`. Record results and archive this plan.

## Results

- The targeted backend, IPC, backup and admin tests passed (75 tests). Documentation and architecture gates also passed (27 tests). Changed JavaScript passed syntax checks; the UI detector returned no findings.
- The final comparator uses immutable original observation timestamps, so editing a record's display date cannot select an older medal observation. The affected domain/import tests passed again after this refinement (32 tests).
- Isolated Electron 43 renderer inspection used the composed admin page and real fan frontend modules with fixture IPC data. The outer workspace had zero vertical overflow; list and detail bottom edges matched, and detail scrolling worked. UID remained in details. Navigation arrow, popover, reminder tab, empty-search recovery, and expand/collapse passed.
- No live Bilibili sync or user data was used for verification. Existing profiles acquire medal levels on their next manual sync in the updated application. No packaged application was rebuilt.

## Failure handling and done criteria

Use isolated test state. On failure inspect the task-owned diff and reverse only its changes if needed; never reset unrelated work or user data. Done when ordering survives restart/restore, no outer fan-workspace scroll or fixed-height bottom gap remains, requested copy and navigation changes are visible, and focused checks pass or limitations are recorded.
