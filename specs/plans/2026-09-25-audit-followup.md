# Audit follow-up implementation plan

**Goal:** Close the explicitly requested audit items with bounded input handling, existing desktop trust boundaries and verified production evidence.

**Architecture:** Keep the modular monolith, current encrypted Cookie stores, catalog replacement owner and SQLite settlement transaction. Execute in this task without commits, releases or unrelated refactors. The user's current single official server model supersedes speculative multi-server migration work.

**Current behavior:** Plaintext export has no source/script consumer in D:/Work and the user confirmed external capture scripts are retired. The official schema-v3 catalog measured 1,689,296 bytes on 2026-09-25. Catalog reads use Infinity. Random item settlement accepts positive safe integers and loops once per item inside the existing transaction. Old IPC handlers omit caller checks. Ordinary login/logout/cloud replacement share sessions without an operation owner.

## Compatibility and ownership

- Authentication: src/electron/bilibili-auth.js, desktop-auth-controller.js, auth-manager.js and the existing login windows; docs/architecture/desktop/auth.md.
- Catalog: src/electron/license/remote-license-client.js and src/bilibili/gift/remote-catalog-cache.js; catalog/auth contracts and tests. Preserve schema, ETag and the last complete memory/disk snapshot.
- Settlement: src/overtime/overtime-service.js and overtime-store.js; specs/overtime-rule-quantity-mode_design.md and docs/architecture/backend/overtime.md. Preserve original gift quantity/value, per-item random order, transaction rollback and settle-once behavior.
- IPC: music-ipc.js, update-ipc.js, bilibili-ipc.js and main.js wiring; docs/architecture/desktop/preload.md. Retain legitimate admin/license window capabilities and return only a fixed error for unauthorized callers.
- Production: inspect the existing lira-server SSH target. Read process/configuration metadata and aggregate sensitive-log findings; never print secrets, user rows or Cookie values. Do not restart or change correct services.

## Milestones and checks

- [x] OPEN-C01: remove plaintext writes and the export environment switch; retain encrypted persistence/restoration and cleanup of obsolete plaintext files. Add regression cases for normal login/restore/logout and an old environment switch/file.
- [x] OPEN-C02: set a 32 MiB decoded-response budget (about 19.9 times today's catalog); reject before retaining excess chunks. Verify exact-limit/over-limit/cancellation, >8 MiB compatibility, ETag and unchanged prior memory/disk catalog after failure.
- [x] OPEN-E01: limit automatic random-item settlement to 100,000 applications, a tested capacity rather than a claimed Bilibili platform maximum. Exceeding it leaves the complete gift and pending settlement with an explicit error, performs zero draws and changes no countdown/revision. Reuse the existing capped-backoff retry flow; retries only repeat the constant-time boundary check. Surface pending over-limit count in the existing overview. Verify boundary, maximum safe integer, replay, restart, failure rollback and unrelated gift processing.
- [x] M-E01: reuse the existing sender/main-frame/exact-origin pattern for the three old IPC modules; keep current-window session ownership and admin/license paths as appropriate. Add caller-matrix unit tests and isolated Electron bridge checks.
- [x] M-E02: first reproduce login/logout/account switch/cloud import overlap using actual isolated Electron sessions and production auth code. Only after a failing assertion, add minimal cancellation/drain/generation handling to the existing owner and verify stale writes cannot replace the winning account.
- [x] M-E03: verify different same-server streamer IDs use distinct stores and stale authorization results are rejected. Record cross-server migration as not applicable to the current model.
- [x] Production: record actual Nginx/PM2/Node/TLS/Host/SSE/log/backup evidence. Correct only proven issues and validate each change. An actual restore rehearsal is separate from read-only backup validation; report any missing evidence explicitly.

## Verification and completion

Run focused node --test cases first, then npm run check, npm run verify:docs, npm run verify:architecture, npm run verify:modularity and npm test for these authentication/IPC changes. Real Electron fixtures use unique temporary profile/data paths, ephemeral test servers, no real accounts, and owned process cleanup. Inspect task-only deltas against saved working-tree baselines and git diff --check.

Deliver a per-item record containing the issue decision, smallest change and reason, test files and results. Final states are restricted to 已确认并修复 / 已验证，无需修改 / 当前业务条件下不适用 / 仍缺证据. Historical audit reports remain historical; create a follow-up report rather than rewriting prior test results.

## Failure handling

Preserve all pre-existing uncommitted audit work. Save each touched existing file before its first edit; if a change fails, inspect and reverse only this task's delta. Do not use a blanket Git reset/checkout. Do not operate the user's running desktop app. Production verification uses read-only checks until a concrete fault is identified.

## Evidence log

- 2026-09-25: SSH BatchMode connected to the configured production host; expected project directory exists.
- 2026-09-25: official catalog HTTPS GET returned 200, TLS verification 0, 1,689,296 bytes.
- 2026-09-25: user confirmed external plaintext Cookie consumers are retired.

## Completion evidence

- Client final full run: 2,883 passed, 0 failed, 4 existing NSIS skips (2,887 total); pinned server fixtures remain at 5ea7b01c8fc7b1cec34a43b01f99c403fd9d1577. Syntax 1,013 files, documentation 5/5, architecture 22/22, modularity 1,284 files / 0 errors.
- Real isolated Electron reproduced six authentication races before repair; final probe also covers real preload caller boundaries and shutdown during a debounced music snapshot.
- Same-server dynamic lottery identity/isolation tests pass; multi-server migration remains outside the supported business model.
- Production caller investigation found no legitimate cross-Host Admin API consumer. User authorized deciding from that evidence; REQ-SEC-002 page-only exception is superseded. Three existing Admin API mounts now use the existing Host guard. Server full run: 1,799/1,799; documentation 35/35.
- Production received only those three mount changes, not the unrelated prior audit working-tree changes. Protected rollback copy: /root/lira-audit-host-boundary-20260925/app-before.js. PM2 reload succeeded; wrong Host 404, management Host anonymous 401, health 200. Nginx and runtime configuration unchanged.
- Production SSE configuration and anonymous refusal checks pass, but authenticated sustained delivery lacks evidence. Six backup databases pass read-only integrity/FK checks, but complete production restore and independently archived keys lack evidence. These remain 仍缺证据.
- Initial full runs and their failures are retained: missing pinned-fixture environment and updated source-shape assertions were corrected; Windows native lookup timeouts and two isolated test-process exits passed targeted/final reruns without unrelated code edits. Their intermittent causes were not established.
- The reviewed main.js ceiling moves from 710 to 712 solely for three required IPC dependency lines minus one obsolete injection; control logic stays in its existing owners. No line compression or unrelated extraction.
- All modified existing files were compared against task-start copies. Final report: D:/Work/lira-audit/05-第五次两端三轮审计-2026-09-25/followup-audit-status.md.
