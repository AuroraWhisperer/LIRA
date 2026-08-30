# Select Menu Overflow Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure every shared admin select menu can render beyond decorative card boundaries, including desktop lyric settings and the other cards found by the overflow audit.

**Architecture:** Keep the existing shared `enhanceSelects()` listbox implementation and preserve scroll containers. Add narrowly scoped open-state rules to the owning cards that currently clip an absolutely positioned menu; keep the existing game-card precedent and use static regression checks to prevent future omissions.

**Tech Stack:** Vanilla JavaScript ES modules, native CSS, Node.js `node:test`.

## Global Constraints

- Preserve the existing custom listbox semantics, keyboard behavior, page URLs, and persisted settings.
- Keep the Electron desktop layout as the primary target; do not add browser-only behavior or new dependencies.
- Make the smallest task-scoped CSS/test changes and preserve unrelated working-tree edits.
- Do not alter intentional scroll containers or remove their scrolling behavior.

---

### Task 1: Add open-state overflow escape rules for audited cards

**Files:**

- Modify: `public/css/admin/desktop-lyric-preview.css`
- Modify: `public/css/admin/other-features/ai-assistant.css`
- Modify: `public/css/admin/other-features/streamer-planner.css`

**Interfaces:**

- Consumes: the shared `.lira-select.is-open` state emitted by `public/js/shared/select-menu.js`.
- Produces: card-level `z-index` and `overflow: visible` while a select menu is open, without changing closed-card clipping or scroll containers.

- [x] **Step 1: Add the desktop lyric group rule**

Add a rule immediately after `.desktop-lyric-settings-group` that raises the active group and releases its rounded clipping only while it contains an open shared select:

```css
.desktop-lyric-settings-group:has(.lira-select.is-open) {
  z-index: 1;
  overflow: visible;
}
```

The group already has `position: relative`; the open-state rule only changes its stacking and clipping behavior.

- [x] **Step 2: Add equivalent rules to the AI and planner card owners**

Add the same open-state behavior to `.xiaomi-ai-section` and `.planner-notes-panel`, matching their existing formatting and keeping their closed-state `overflow: hidden` behavior unchanged.

- [x] **Step 3: Run the focused static checks**

Run: `node --test test/frontend-select-menu-overflow.test.js`

Expected: the new audit assertions pass for lyric settings, AI settings, planner notes, and the already-fixed games cards.

### Task 2: Lock the overflow audit into regression coverage

**Files:**

- Create: `test/frontend-select-menu-overflow.test.js`

**Interfaces:**

- Consumes: the four owning CSS files and the shared select-menu stylesheet.
- Produces: deterministic source-level coverage that each known clipping card has an open-state escape rule and that the shared menu remains absolutely positioned for the existing local stacking model.

- [x] **Step 1: Write assertions for all audited owners**

Read each CSS file and assert that the selector contains `z-index: 1` followed by `overflow: visible`; assert the games precedent remains present. Also assert that the shared menu still uses `position: absolute` so this fix does not silently change positioning semantics.

- [x] **Step 2: Run the test and inspect failures**

Run: `node --test test/frontend-select-menu-overflow.test.js`

Expected: PASS after Task 1; a missing rule or accidental removal reports the owning file.

### Task 3: Verify the affected frontend gates and final diff

**Files:**

- Modify: `specs/plans/2026-08-22-select-menu-overflow-audit.md` (record verification results)

- [x] **Step 1: Run syntax and focused admin tests**

Run: `npm run check` and `npm run test:admin`

Expected: PASS with no changes to public contracts.

- [x] **Step 2: Run the quick verification gate**

Run: `npm run verify:quick`

Expected: documentation, syntax, and module-boundary gates pass.

- [x] **Step 3: Review only task-owned changes**

Run: `git diff --check`, `git diff -- public/css/admin/desktop-lyric-preview.css public/css/admin/other-features/ai-assistant.css public/css/admin/other-features/streamer-planner.css test/frontend-select-menu-overflow.test.js specs/plans/2026-08-22-select-menu-overflow-audit.md`, and `git status --short`.

Expected: only the scoped CSS, regression test, and plan verification notes are changed; pre-existing user edits remain untouched.

Verification results: the focused overflow test, existing games/UI surface tests, `npm run check`, `npm run test:admin`, and `npm run verify:quick` passed. `npm test` ran 811 tests with 809 passing; two pre-existing `test/frontend-queue.test.js` assertions fail because the working tree already contains different cherry-ribbon and golden-lily `inset` values in the corresponding overlay CSS. Neither failure touches the select-menu files or this task's regression.

## Rollback Or Failure Handling

If a focused test or visual review fails, inspect the scoped diff and revert only the new rules/test/plan lines with `apply_patch`; do not use blanket checkout or reset. Keep the existing games fix intact unless a separate regression proves it is task-owned.

## Done When

- Desktop lyric, AI settings, planner notes, and games select menus are not clipped by their rounded card parents while open.
- Closed cards retain their original clipping and all intentional scroll containers still scroll.
- The focused regression, admin tests, syntax check, quick verification, diff check, and status review pass.
- No unrelated working-tree changes are modified or committed.
