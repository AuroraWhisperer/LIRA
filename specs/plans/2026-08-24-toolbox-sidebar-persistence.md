# Toolbox Navigation Persistence Implementation Plan

> **For agentic workers:** Execute this plan inline and review the scoped diff after each milestone. The optional `superpowers:executing-plans` skill referenced by the planning workflow is not installed in this workspace.

**Goal:** Preserve both the toolbox sidebar width and every toolbox feature group's final collapsed or expanded state across a full LIRA desktop exit and restart.

**Architecture:** Keep immediate `localStorage` updates as a renderer-side cache, and use allowlisted application settings as the durable source for both navigation layers. Store collapsed feature-group IDs as a bounded JSON array; on startup, restore group visibility before selecting the initial panel, without automatically reopening a group merely because its previously selected panel belongs to it.

**Tech Stack:** Electron 43, Vanilla JavaScript ES modules, existing settings database and HTTP API, `node:test`.

## Global Constraints

- Both the full sidebar and every feature group remain expanded by default when neither durable nor cached state exists.
- Preserve the existing toolbox DOM, CSS, tab selection, group folding, accessibility labels, keyboard navigation, and public API surface.
- Reuse `/api/settings`; do not add an IPC channel, database table, schema migration, dependency, process, or service.
- Preserve existing user changes in the dirty worktree and touch only task-owned hunks.
- Do not create commits.

---

## Goal

When the user exits LIRA, the next desktop launch restores both the full left sidebar state and the independent state of the four feature groups: `live-interaction`, `live-scene`, `streamer-work`, and `software-help`.

## Non-goals

- Changing which toolbox feature tab is selected; the existing `admin.toolboxSelectedFeature` behavior remains intact.
- Changing the layout, animation, icons, or responsive behavior of the toolbox sidebar.
- Moving other renderer-only preferences into the database.

## Current Behavior

`public/js/admin/other.js` now durably restores the full sidebar width. Feature-group headings currently call `setFeatureGroupExpanded()` only in memory, so groups such as “直播互动” and “直播画面” return to expanded after a complete desktop restart. Deep-link selection also intentionally opens a hidden group, so startup selection must avoid using that deep-link behavior while restoring the saved navigation layout.

## Ownership

- Durable setting definitions and defaults: `src/storage/settings-store.js`.
- Existing settings write contract: `POST /api/settings` in `src/server/routes/settings-routes.js`; its allowlist is derived from `DEFAULT_SETTINGS`, so no route change is required.
- Toolbox renderer state and legacy-cache compatibility: `public/js/admin/other.js`.
- Dependency injection from the ES-module composition root: `public/js/admin/app.js` using the existing shared `api()` helper.
- Focused regression coverage: `test/toolbox-sidebar.test.js`.

## Compatibility Constraints

- `toolboxSidebarCollapsed` is stored as `'true'`, `'false'`, or the initial empty string used to distinguish an uninitialized upgraded installation.
- `toolboxCollapsedFeatureGroups` is stored as a JSON array containing only IDs declared by current `data-other-feature-group` headings; malformed or stale values are ignored.
- The renderer cache key for groups is `admin.toolboxCollapsedFeatureGroups` and uses the same normalized JSON array.
- A valid legacy `localStorage` value wins during one-time startup reconciliation and is copied to the durable setting when the two disagree.
- A valid durable value is restored and copied into `localStorage` when the legacy cache is absent.
- The toggle remains responsive if the save request fails; the current in-memory and local cache state are not rolled back.
- Existing API authentication continues through `public/js/shared/utils.js#api`.

## Proposed Changes

- Modify `src/storage/settings-store.js` to retain `toolboxSidebarCollapsed: ''` and add `toolboxCollapsedFeatureGroups: ''` in `DEFAULT_SETTINGS`.
- Modify `public/js/admin/app.js` to inject narrowly scoped persistence callbacks for the sidebar and feature groups.
- Modify `public/js/admin/other.js` to reconcile durable and cached values for both navigation layers, save after each user toggle, and preserve restored group visibility during initial panel selection.
- Modify `test/toolbox-sidebar.test.js` to cover full restart restoration for both layers, cached-state migration, malformed group data, toggle saves, and initial selection behavior.

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

## Milestone 3: Persist Independent Feature Groups

- [x] Add failing tests that collapse `live-interaction` and `live-scene`, recreate the toolbox runtime, and verify both groups remain collapsed.
- [x] Add failing tests for durable restore, cached-state migration, malformed JSON fallback, and persistence callback payloads.
- [x] Add `toolboxCollapsedFeatureGroups: ''` to application settings and inject `persistCollapsedFeatureGroups(groupIds)` through the Admin composition root.
- [x] Normalize persisted IDs against the headings present in the current page, apply them before initial feature selection, and save the normalized array after group clicks.
- [x] Ensure initial selected-panel restoration does not reopen a saved collapsed group; explicit deep links and direct feature selection continue to reopen the target group.
- [x] Run the persistence-specific toolbox tests, module-boundary tests, Admin shell tests, and focused server smoke test.

## Verification

- `node --test test/toolbox-sidebar.test.js` — expected: all tests pass.
- `node --test test/frontend-admin-shell.test.js` — expected: all tests pass because the Admin composition root and settings defaults remain consistent.
- `git diff --check` — expected: no whitespace errors.
- Inspect `git diff -- public/js/admin/app.js public/js/admin/other.js src/storage/settings-store.js test/toolbox-sidebar.test.js specs/plans/2026-08-24-toolbox-sidebar-persistence.md` — expected: only the persistence contract, focused wiring, tests, and plan.
- Inspect `git status --short` and distinguish the task-owned files from pre-existing user changes.

## Rollback Or Failure Handling

If focused verification fails, inspect and reverse only the task-owned hunks with `apply_patch`; do not reset or check out whole files. The empty default and existing `localStorage` path make the change backward compatible, so an interrupted save leaves the current renderer behavior available.

## Done When

- Full-sidebar and per-group collapsed/expanded states survive a simulated application restart through durable settings.
- Existing local-only users keep their current state on first launch after the change.
- The toolbox still updates immediately and remains usable when durable saving is unavailable.
- Focused tests and `git diff --check` pass.
- Final diff review shows no unrelated or generated changes from this task.

## Verification Results

- `node --check public/js/admin/other.js`, `node --check public/js/admin/app.js`, and `node --check src/storage/settings-store.js`: passed.
- Full `test/toolbox-sidebar.test.js`, including full-restart coverage for “直播互动” and “直播画面”: 19 passed, 0 failed.
- `node --test test/module-boundaries.test.js`: 8 passed, 0 failed.
- `node --test test/frontend-admin-shell.test.js`: 45 passed, 0 failed.
- Focused core server smoke test: 1 passed, 0 failed.
- Scoped `git diff --check`: passed; only the repository's existing LF-to-CRLF warnings were emitted.
