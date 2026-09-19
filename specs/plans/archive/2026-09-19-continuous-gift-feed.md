# Continuous Gift Feed Implementation Plan

**Goal:** Scroll today's gifts continuously when the number of entries exceeds the visible rows, joining the last entry directly to the first. Speed 1–50 maps linearly to 2000–100 ms per row. Remove pause and low-power controls.

**Architecture:** Keep the existing local settings owner, HTTP routes, bounded overlay DOM, and eventId-based feed state. Use elapsed animation-frame time for continuous transform movement, retaining row nodes and applying refreshed data at row boundaries.

**Tech Stack:** Existing Node.js CommonJS backend, browser ES modules, native CSS, node:test and Playwright fixtures. Execute in this task without commits or branches.

**Status:** Complete, 2026-09-19.

## Boundaries and current evidence

- Current overlay waits `intervalSeconds`, animates one row over 400 ms, and recreates all rows. Refresh cancels motion; low-power and pause alter playback.
- Settings owner: `src/bilibili/gift/display-settings.js`; consumers: admin display form, `/api/gifts/display-settings`, OBS feed, PNG export (thresholds only).
- Contracts: `docs/architecture/backend/api.md` and `docs/architecture/frontend/overlays.md`.
- Preserve existing uncommitted banner/export/admin changes, gift ordering, source isolation, stale-request protection, midnight reset, artwork, and colors. No changes to Electron, storage schema, authentication, URLs, or export rendering.
- Keep `giftDisplayConfig`. Canonical settings replace the old playback fields with integer `scrollSpeed` (default 1). Read legacy saved settings without losing thresholds or visible rows; their unsupported old intervals become speed 1. Legacy valid POST payloads are normalized for compatibility. Obsolete pause/low-power values no longer control playback.

## Milestones

- [x] Settings: add strict speed validation, legacy normalization, speed input and explanatory copy; remove old controls and their now-unused CSS. Verify endpoints 1/50, invalid input, saving/cancelling/defaults, and preserved legacy settings.
- [x] Animation: use `2000 - (speed - 1) * 1900 / 49` milliseconds per row, render at most visible rows plus one buffer, reuse unchanged nodes, and keep fractional progress across refreshes. Static at/below capacity; cancel frame work on pagehide and resume hidden pages without catch-up jumps. Verify wraparound, row distances, intermediate speeds, updates, source resets, and disposal with synthetic data.
- [x] Update the two owning contract documents and review the task diff.

## Verification

Run `node --experimental-vm-modules --test test/gift-banner-feed.test.js test/gift-routes.test.js test/frontend-gift-display-settings.test.js test/frontend-gift-feed.test.js` for settings, routes, real DOM rendering, and deterministic frame progression. Run the existing governance gate `npm run verify:docs`, the mechanical UI detector on changed UI files, and syntax checks for touched JS. Finish with `git diff --check` and `git status --short`; preserve all pre-existing changes.

Results: the focused suite passed all 24 tests. After adding hidden-page coverage and strengthening active-animation disposal coverage, both affected tests passed (`--test-name-pattern='hidden feeds|source changes'`), covering 25 distinct tests in total. `npm run verify:docs` passed all five checks; `node --check` passed for all eight touched JavaScript files; the UI detector returned no findings. Frame tests use synthetic data with real Chromium DOM/layout and controlled timestamps, not a live OBS session or real user data.

## Failure handling and done conditions

Use isolated browser fixtures and in-memory settings only. Do not access real gift data. If verification fails, fix only this task's cause; reversal must remove only task-owned edits. Completion requires the requested timing/loop behavior, legacy settings preservation, passing focused checks, consistent contracts, and a reviewed diff. Archive this plan with verification results on completion.
