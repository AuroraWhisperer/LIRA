# Queue Style Settings Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the currently shared queue typography and vertical-scroll controls persist independently for song-board styles 1–6.

**Architecture:** Add explicit flat settings keys for styles 2–6, migrate existing shared values into them, and centralize the style-to-key mapping in one frontend ESM contract. The Admin form projects the active style into its shared controls, while the OBS renderer projects the selected style back into the existing rendering fields.

**Tech Stack:** Node.js 24+, SQLite `settings` key/value storage, Vanilla JavaScript ES modules, native HTML, `node:test`.

## Global Constraints

- Preserve `/api/settings`, WebSocket snapshot, page URL, authentication, and renderer-security contracts.
- Preserve existing style 1 keys, style 2 pins/rules, and style 3–6 artwork geometry.
- Use parameterized SQL and isolated in-memory/test databases only.
- Preserve unrelated working-tree changes and do not create a commit unless the user requests it.

---

### Task 1: Persisted per-style settings and migration

**Files:**

- Modify: `src/storage/settings-store.js`
- Modify: `src/server/settings-bootstrap.js`
- Modify: `src/storage/theme-store.js`
- Test: `test/frontend-queue.test.js`

**Interfaces:**

- Consumes: legacy `identityQueueFontSize`, `identityQueueScrollSpeed`, `queueScrollMode`, and `illustratedQueue*` values.
- Produces: `identityQueueScrollMode`; four illustrated style prefixes with `QueueFontSize`, `QueueFontFamily`, `QueueFontWeight`, `QueueUseCustomTextColor`, `QueueTextColor`, `QueueScrollMode`, and `QueueScrollSpeed`; `queueStyleSettingsVersion=1`.

- [x] Add a failing in-memory migration test that seeds distinct legacy values and expects every style-specific key to receive them.
- [x] Run `node --test test/frontend-queue.test.js` and confirm the new migration assertion fails because the keys/migration do not exist.
- [x] Add defaults, parameterized copy migration, bootstrap version lookup, and theme-preset key coverage.
- [x] Rerun the focused test and confirm the migration and existing queue assertions pass.

### Task 2: Shared frontend style-settings contract and OBS resolution

**Files:**

- Create: `public/js/shared/queue-style-settings.js`
- Modify: `public/js/overlays/queue.js`
- Test: `test/queue-overlay-esm.test.js`
- Test: `test/frontend-queue.test.js`

**Interfaces:**

- Produces: `normalizePersistedQueueStyle(style)`, `readQueueStyleSettings(settings, style)`, `queueStyleSettingsPayload(style, values)`, and `resolveQueueStyleSettings(settings, style)`.
- Consumes: the persisted flat keys from Task 1 and legacy shared keys as read-only fallback values.

- [x] Add failing tests where styles 4 and 5 have different font/scroll values and expect resolution to return only the selected style.
- [x] Implement the exact six-style key map and legacy fallback rules in the shared ESM contract.
- [x] Resolve settings before queue render, relayout, theme application, and state-key calculation.
- [x] Run `node --test test/queue-overlay-esm.test.js test/frontend-queue.test.js` and confirm the selected style controls rendering without changing other styles.

### Task 3: Admin active-style hydration and scoped saving

**Files:**

- Modify: `public/pages/admin/song/queue-theme.html`
- Modify: `public/js/admin/theme.js`
- Modify: `public/js/admin/forms.js`
- Test: `test/frontend-queue.test.js`

**Interfaces:**

- Consumes: `readQueueStyleSettings()` and `queueStyleSettingsPayload()` from Task 2.
- Produces: one shared style 2–6 form that hydrates from the selected style and posts only that style's mapped keys.

- [x] Add failing assertions for an identity/illustrated scroll-mode control and active-style-only payload construction.
- [x] Add the shared scroll-mode select beside scroll speed.
- [x] Hydrate common controls from the selected style, including saved local-font options and paired range/number inputs.
- [x] Split `collectTheme()` into classic, identity, and illustrated payloads so hidden styles are not overwritten by autosave.
- [x] Run `node --test test/frontend-queue.test.js` and confirm all Admin isolation assertions pass.

### Task 4: Contracts and verification

**Files:**

- Modify: `docs/architecture/backend/storage.md`
- Modify: `docs/architecture/frontend/app.md`
- Modify: `docs/architecture/frontend/overlays.md`
- Modify: `specs/README.md`
- Modify: `specs/queue-style-settings-isolation_design.md`
- Move after completion: `specs/plans/2026-08-23-queue-style-settings-isolation.md` to `specs/plans/archive/2026-08-23-queue-style-settings-isolation.md`

**Interfaces:**

- Consumes: implemented setting keys and verified runtime behavior from Tasks 1–3.
- Produces: owner-contract documentation and lifecycle evidence consistent with the code.

- [x] Update owner docs to name the per-style setting families, migration behavior, and active-style Admin/OBS projection.
- [x] Run `node --test test/frontend-queue.test.js test/queue-overlay-esm.test.js test/queue-overlay-responsive.test.js` and expect all tests to pass.
- [x] Run `npm run verify:quick`, then `npm test`; record any unrelated concurrent-work failure without changing its files.
- [x] Review `git diff`, `git diff --check`, `git status --short`, and staged diff if present; confirm every task-owned line traces to the request.
- [x] Mark the specification Implemented, complete the plan checkboxes, and archive the plan without committing.

## Rollback Or Failure Handling

Stop on any settings-owner or compatibility conflict. Inspect only the task-owned paths listed above and reverse individual task hunks with `apply_patch`; do not reset the repository or overwrite concurrent draw-guess work. The migration is additive and keeps legacy keys, so a partial implementation must not delete or rename existing rows.

## Done When

Changing the font size in style 4 leaves styles 1, 2, 3, 5, and 6 unchanged after style switches and reloads; every currently shared typography and vertical-scroll control is isolated per style; legacy values migrate without visual drift; focused and applicable repository gates pass; docs and diff scope are consistent.
