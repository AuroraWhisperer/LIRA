# Dynamic Lottery UI Implementation Plan

**Goal:** Implement the approved compact lottery layout without losing controls, progress, rules or history, and show each winner's real nickname, UID and participating comment in a separate result panel.

**Architecture:** Keep the current Electron account bridge, authenticated routes and lottery services. Persist optional comment-author names with existing evidence, and join the frozen member's exact evidence when reading results. UI renders server state using native DOM and existing CSS tokens.

**Tech Stack:** Node.js 24+, SQLite migrations, native HTML/CSS and named JavaScript ESM.

## Non-goals

No changes to eligibility, cutoff, random order, digest, rate limits, identity/authentication or recovery. No export, publishing, extra upstream profile requests, new dependencies or commits. Preserve unrelated working-tree edits.

## Current Behavior And Ownership

- `provider-parsers.js` reads comments but omits `member.uname`; `dynamic-lottery-store.js` already persists full comment text.
- `dynamic-lottery-migrations.js` currently has one migration; append a nullable `display_name` column without changing v1 DDL.
- `dynamic-lottery-draw-store.js` freezes the selected evidence source/record ID but results only expose UID and verification.
- `public/pages/admin/toolbox/dynamic-lottery.html`, its CSS, `dynamic-lottery.js` and `dynamic-lottery-workflow.js` own the existing UI. Preserve async cancellation, license resets and every existing operation.
- Contract owners: `docs/architecture/backend/api.md`, `storage.md`, `frontend/app.md`. Existing provider/store/collection/auth frontend tests are the focused checks.

## Compatibility And Security

Keep all existing result fields; add nullable `displayName` and `commentText` to winners. Old evidence has a null name; UI falls back to UID. Only expose the selected round's comment by joining round scan + member source/record ID + winner UID. Existing authenticated streamer ownership remains authoritative. Use parameterized SQL and DOM textContent, not HTML interpolation; no cookie or raw upstream response is exposed. GET state makes no upstream calls. Metadata does not enter the candidate digest or order.

## Milestones

- [x] **Result evidence.** Test v1 → v2 migration twice with old evidence intact; preserve selected comment identity across duplicate comments and scans, return null for absent old metadata, and verify unchanged round order/digest. Add parser coverage for real and missing names. Append migration, persist bounded optional `displayName`, and return result metadata with a scoped evidence join. Use a count-only award query inside `recordCheck` so displaying comments does not load their bodies on every verification.
- [x] **Approved interface.** Compact account row with management disclosure; header history entry showing local last 50 activities; single-column inputs and checkbox conditions; frozen settings summary with target URL, description, author and exact cutoff; per-source progress and all pause/resume/draw/refresh actions; always accessible rules; separate result panel with full comment text, profile links, verification, counts, shortage, five-row pagination and proof disclosure. Preserve errors when no task was created, saved partial results and lifecycle handling.
- [x] **Verification and docs.** Cover state visibility, actions during collection and verification, safe comment rendering, pagination, old-result fallback, account switching and request cancellation. Inspect rendered production markup with synthetic state where practical; update the owning contracts and review the scoped diff.

## Verification

- `node --experimental-vm-modules --test test/dynamic-lottery-provider.test.js test/dynamic-lottery-store.test.js test/dynamic-lottery-results.test.js test/dynamic-lottery-collection.test.js test/frontend-dynamic-lottery.test.js test/frontend-dynamic-lottery-workflow.test.js` — isolated fixtures, no real accounts or databases.
- `node --experimental-vm-modules --test test/admin-page-composition.test.js test/admin-style-ownership.test.js test/governance-docs.test.js` — composition and changed contract consistency.
- Syntax-check touched JavaScript; `git diff --check`; inspect touched diff and `git status --short`.

## Rollback Or Failure Handling

On failure keep original data intact and inspect only task-owned changes. Migration v2 adds one nullable column in the migration runner's transaction; do not roll back by dropping data. Earlier code ignores the extra column. Reverse only this task's source edits when needed; never reset unrelated changes.

## Done When

All approved content and controls remain accessible in their relevant states, real result metadata is wired end to end with an honest legacy fallback, migrations preserve old records, focused checks pass, owner docs match behavior, and final diff is limited to the task. No real Bilibili draw is required for this UI change.

## Results

Completed 2026-09-16.

- All 69 focused tests passed: every `test/dynamic-lottery-*.test.js` and `test/frontend-dynamic-lottery*.test.js`, plus admin page composition, stylesheet ownership and governance checks. Migration tests used an in-memory v1 database and repeated v2 migration; result tests verify exact selected evidence, legacy name fallback and preserved order/digest across pause/resume.
- All six touched production JavaScript files passed `node --check`; `git diff --check` passed.
- Inspected production HTML/CSS/ESM with the desktop theme in an isolated local browser fixture at 1280×720. Verified setup, collecting, drawing, paused and pre-task error states; account/history/details expansion, result pagination and proof. Full comments wrap without horizontal overflow; no browser console errors.
- Rendering adjustment: collection details remain expanded before results and default to collapsed after results appear, bringing winners into view. Manual expansion survives polling; refresh and pause/resume remain outside the disclosure.
- No actual Electron account login, Bilibili request or real draw was performed. No real user database was opened. Temporary preview tooling lives outside the repository and was stopped after inspection.
- Only lottery-owned source/tests and the lottery paragraphs of shared contract documents were changed; unrelated concurrent edits were preserved. No commit or dependency changes.
