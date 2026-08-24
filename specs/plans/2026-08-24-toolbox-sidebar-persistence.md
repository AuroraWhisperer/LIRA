# Toolbox Sidebar Persistence Implementation Plan

> **For agentic workers:** Execute this plan inline and review the scoped diff after each milestone. The optional `superpowers:executing-plans` skill referenced by the planning workflow is not installed in this workspace.

**Goal:** Preserve the toolbox left sidebar's final collapsed or expanded state across a full LIRA desktop exit and restart.

**Architecture:** Keep the current immediate `localStorage` behavior as a renderer-side cache, and add one allowlisted application setting as the durable source. On startup, reconcile the database value with the legacy cache so existing users retain their current preference; on each toggle, update the UI/cache synchronously and save the same value through the existing `/api/settings` route.

**Tech Stack:** Electron 43, Vanilla JavaScript ES modules, existing settings database and HTTP API, `node:test`.

## Global Constraints

- Default behavior remains expanded when neither durable nor legacy state exists.
- Preserve the existing toolbox DOM, CSS, tab selection, group folding, accessibility labels, keyboard navigation, and public API surface.
- Reuse `/api/settings`; do not add an IPC channel, database table, schema migration, dependency, process, or service.
- Preserve existing user changes in the dirty worktree and touch only task-owned hunks.
- Do not create commits.

---

## Goal

When the user exits LIRA while the toolbox's left feature sidebar is collapsed, the next desktop launch restores it collapsed. Exiting while expanded likewise restores it expanded.

## Non-goals

- Persisting the individual toolbox feature-group headings.
- Changing which toolbox feature tab is selected; the existing `admin.toolboxSelectedFeature` behavior remains intact.
- Changing the layout, animation, icons, or responsive behavior of the toolbox sidebar.
- Moving other renderer-only preferences into the database.

## Current Behavior

`public/js/admin/other.js` writes `admin.toolboxSidebarCollapsed` to `window.localStorage` and reads it during `initOtherPage()`. The focused test verifies the write but does not verify restore or a full application-owned persistence path. Because the preference is only owned by Chromium page storage, there is no application setting to restore when that cache is absent or unavailable.

## Ownership

- Durable setting definition and default: `src/storage/settings-store.js`.
- Existing settings write contract: `POST /api/settings` in `src/server/routes/settings-routes.js`; its allowlist is derived from `DEFAULT_SETTINGS`, so no route change is required.
- Toolbox renderer state and legacy-cache compatibility: `public/js/admin/other.js`.
- Dependency injection from the ES-module composition root: `public/js/admin/app.js` using the existing shared `api()` helper.
- Focused regression coverage: `test/toolbox-sidebar.test.js`.

## Compatibility Constraints

- The new setting is `toolboxSidebarCollapsed`, stored as `'true'`, `'false'`, or the initial empty string used to distinguish an uninitialized upgraded installation.
- A valid legacy `localStorage` value wins during one-time startup reconciliation and is copied to the durable setting when the two disagree.
- A valid durable value is restored and copied into `localStorage` when the legacy cache is absent.
- The toggle remains responsive if the save request fails; the current in-memory and local cache state are not rolled back.
- Existing API authentication continues through `public/js/shared/utils.js#api`.

## Proposed Changes

- Modify `src/storage/settings-store.js` to declare `toolboxSidebarCollapsed: ''` in `DEFAULT_SETTINGS`.
- Modify `public/js/admin/app.js` to inject a narrowly scoped `persistSidebarCollapsed(collapsed)` callback into toolbox initialization.
- Modify `public/js/admin/other.js` to reconcile durable and legacy values once, and call the injected persistence callback after each user toggle.
- Modify `test/toolbox-sidebar.test.js` to cover startup restore, legacy migration, durable fallback, and toggle saves.

## Milestone 1: Lock The Persistence Contract With Tests

- [x] Add assertions that the default setting exposes an uninitialized `toolboxSidebarCollapsed` value.
- [x] Extend the toolbox runtime fixture with window-event dispatch and injectable initial local storage.
- [x] Add a failing test where durable `'true'` restores a collapsed sidebar when local storage is absent.
- [x] Add a failing test where legacy local state is retained and sent to the durable persistence callback.
- [x] Add a failing test where clicking the toggle sends the final boolean state to the persistence callback.
- [x] Run `node --test test/toolbox-sidebar.test.js` and confirm the new persistence assertions fail for the missing durable integration.

## Milestone 2: Implement The Smallest Durable Integration

- [x] Add the new default setting key without changing the settings route or database schema.
- [x] Inject the existing authenticated settings API through `initOtherPage({ persistSidebarCollapsed })`.
- [x] Reconcile startup state once: prefer a valid legacy value, otherwise use a valid durable value, otherwise remain expanded.
- [x] Save after every explicit sidebar toggle while keeping local UI/cache updates synchronous.
- [x] Run the four persistence-specific cases in `test/toolbox-sidebar.test.js`; all pass. The full file has one unrelated failure from the pre-existing `start-animation.html`/toolbox-title work in the dirty worktree.

## Verification

- `node --test test/toolbox-sidebar.test.js` — expected: all tests pass.
- `node --test test/frontend-admin-shell.test.js` — expected: all tests pass because the Admin composition root and settings defaults remain consistent.
- `git diff --check` — expected: no whitespace errors.
- Inspect `git diff -- public/js/admin/app.js public/js/admin/other.js src/storage/settings-store.js test/toolbox-sidebar.test.js specs/plans/2026-08-24-toolbox-sidebar-persistence.md` — expected: only the persistence contract, focused wiring, tests, and plan.
- Inspect `git status --short` and distinguish the task-owned files from pre-existing user changes.

## Rollback Or Failure Handling

If focused verification fails, inspect and reverse only the task-owned hunks with `apply_patch`; do not reset or check out whole files. The empty default and existing `localStorage` path make the change backward compatible, so an interrupted save leaves the current renderer behavior available.

## Done When

- Collapsed and expanded states both survive a simulated application restart through the durable setting.
- Existing local-only users keep their current state on first launch after the change.
- The toolbox still updates immediately and remains usable when durable saving is unavailable.
- Focused tests and `git diff --check` pass.
- Final diff review shows no unrelated or generated changes from this task.

## Verification Results

- `node --check public/js/admin/other.js`, `node --check public/js/admin/app.js`, and `node --check src/storage/settings-store.js`: passed.
- Four persistence-specific toolbox tests: 4 passed, 0 failed.
- `node --test test/module-boundaries.test.js`: 8 passed, 0 failed.
- `node --test test/frontend-admin-shell.test.js`: 45 passed, 0 failed.
- Focused core server smoke test: 1 passed, 0 failed.
- Full `test/toolbox-sidebar.test.js`: 15 passed, 1 unrelated failure because the user-owned `public/pages/admin/toolbox/start-animation.html` currently contains an `<h2>` while another user-owned test change expects toolbox tabs not to repeat page headers.
