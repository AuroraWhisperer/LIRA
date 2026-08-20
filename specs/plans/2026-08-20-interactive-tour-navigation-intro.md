# Interactive Tour Navigation Intro Implementation Plan

> **For agentic workers:** Execute inline in the current worktree. Do not create commits unless the user explicitly requests one.

**Goal:** Make the desktop first-run tour explain LIRA and its four primary navigation buttons before setup begins, highlight both the live-room status and refresh button during connection setup, and replace the disabled Back button's busy cursor.

**Architecture:** Keep the existing data-driven `TOUR_STEPS` controller and CSS spotlight system. Add one informational step, renumber the existing actions, allow a step selector to resolve adjacent targets into one spotlight rectangle, and adjust only the disabled tour-button cursor. No process, dependency, page URL, HTTP, WebSocket, IPC, or persisted-data contract changes.

**Tech Stack:** Vanilla JavaScript ES modules, native CSS, `node:test`, Electron desktop renderer.

## Global Constraints

- Treat the Electron desktop top bar as the visual source of truth.
- Preserve the existing no-build ESM model, page navigation, completion checks, authentication behavior, and public contracts.
- Keep the current teal spotlight, rounded white tour card, progress dots, and accessible focus behavior.
- Make only task-scoped changes; do not refactor adjacent onboarding code.

## Non-goals

- Do not change the separate legacy onboarding dialog or its persisted settings.
- Do not redesign the top bar or the four navigation buttons.
- Do not change Bilibili connection logic or completion semantics.

## Current Behavior

- The welcome card does not define the LIRA acronym and is not numbered as step 0.
- The first action immediately starts Bilibili login without explaining the four top-level buttons.
- The refresh step spotlights only `#reconnectBtn`, although its copy uses the adjacent `#liveStatus` green indicator as the success signal.
- `.lira-tour-actions button:disabled` uses `cursor: wait`, so the disabled Back button looks busy on the first card.

## Ownership

- Owner: `public/js/admin/interactive-tour.js`.
- Styles: `public/css/admin/other-features/interactive-tour.css`.
- Top-bar consumer DOM: `public/pages/admin/shell-start.html`.
- Contract/design guide: `docs/interactive-tour-demo.md`.
- Focused regression: `test/interactive-tour.test.js`.
- Architecture route: `ROUTE-ADMIN` in `docs/architecture/engineering/ai-workflow.md`.

## Proposed Changes

1. Update `TOUR_VERSION` to `6`, label welcome as `第 0 步`, and explain `LIRA = Live Interactive Request Assistant` with the plain-language Chinese meaning `直播互动点歌助手`.
2. Insert `main-navigation` as `第 1 步`, target `.main-page-tabs`, and describe `点歌` as song requests/song library, `播放` as music playback, `礼物` as gift data, and `百宝箱` as auxiliary tools/help.
3. Renumber the existing action kickers to steps 2 through 7 without changing their target pages or completion gates.
4. Set the refresh step target to `#liveStatus, #reconnectBtn`; resolve all matching elements and merge their rectangles before drawing the spotlight and positioning the tooltip.
5. Change the disabled tour-action cursor from `wait` to `not-allowed`.
6. Update the focused assertions and design guide flow to match the runtime behavior.

## Milestones

- [x] Add focused assertions for version 6, step 0, the navigation introduction, sequential steps 1–7, the two-element live target, and the disabled cursor; verify the old implementation fails them.
- [x] Implement the minimum step-data and multi-target spotlight changes; verify `node --experimental-vm-modules --test test/interactive-tour.test.js` passes.
- [x] Align `docs/interactive-tour-demo.md`, run syntax and quick gates, then review `git diff`, `git diff --check`, and `git status --short`.

## Verification

- `node --test test/interactive-tour.test.js`
- `npm run check`
- `npm run verify:quick`
- `git diff --check`
- `git status --short`

Expected result: all commands pass; the diff is limited to this plan, the tour controller, its CSS, its focused test, and its design guide.

## Rollback Or Failure Handling

Inspect the scoped diff and reverse only task-owned hunks with `apply_patch` if a focused regression fails. Do not reset, broadly restore, or alter unrelated worktree content.

## Done When

- The first card names the full LIRA acronym and is visibly step 0.
- The next card spotlights and explains all four top-level buttons before any setup action.
- Existing setup actions are uniquely numbered 2–7.
- The connection card frames both the live-room status and `刷新直播`, and still waits on the existing green/connected state.
- Hovering the disabled `上一步` shows an unavailable cursor rather than a busy cursor.
- Focused, syntax, and quick verification pass, documentation matches, and no unrelated files change.

## Verification Results

- `node --experimental-vm-modules --test test/interactive-tour.test.js test/frontend-admin-shell.test.js`: 46 passed.
- `npm run verify:quick`: documentation, syntax, and architecture gates passed.
- `npm test`: 706 passed, 1 skipped, 0 failed.
- Desktop-style visual QA at 1280×720 verified the step 0 copy, the four-button spotlight, the combined live-status/refresh spotlight, disabled Back cursor, tooltip fit, and absence of clipping.
- `git diff --check` passed. Pre-existing unrelated changes in `public/css/overlays/base/storybook.css` and `test/frontend-queue.test.js` were preserved.
