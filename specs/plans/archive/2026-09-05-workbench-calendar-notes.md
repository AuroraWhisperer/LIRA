# Streamer Calendar And Notes Implementation Plan

> For agentic workers: execute the bounded model task with `luna_worker`; the primary agent owns UI direction, integration, and acceptance. Do not commit.

**Goal:** Replace beginner-oriented cue templates with a working calendar, editable memos, and a compact personal task list for experienced streamers.

**Architecture:** Keep the existing frontend-only workbench owner and no-build ESM loading. Store the new format in `admin.streamerWorkbench.v3`, importing earlier data without overwriting either older key. No backend, IPC, dependencies, cloud sync, recurrence, or notification changes.

**Tech Stack:** Vanilla JavaScript, native CSS and HTML, localStorage, node:test, existing Playwright/Electron tooling.

## Current Behavior And Ownership

- `public/js/admin/todo-model.js` normalizes the v2 session, task, and note format and supplies six beginner cue templates.
- `public/js/admin/todo.js` owns storage, event handling, rendering, and the existing initialization facade.
- `public/pages/admin/toolbox/planner.html` and `public/css/admin/other-features/streamer-planner.css` own the visible workbench.
- `public/pages/admin/toolbox/shell-start.html` owns its navigation description.
- Contracts: `docs/architecture/frontend/app.md` and `docs/architecture/frontend/pages.md`.
- Tests: `test/toolbox-todo.test.js`, the new focused model test, admin composition and module boundary checks.

## Global Constraints

- Preserve existing page/panel IDs, initialization entry, task API behavior and old storage keys.
- Keep user-written tasks, task completion, note contents and links. Remove only exact known built-in ID/title pairs during import; retain customized starter entries.
- Import a nonempty old session as a calendar entry once. Never recreate a deleted event on later v3 reads.
- Keep an empty new account empty, without fictional events, example memos or starter tasks.
- User content is rendered through DOM text APIs, never HTML interpolation.
- Do not touch existing unrelated edits, production data, authentication, Electron lifecycle, dependencies or runtime configuration.

## Interfaces And Data

Retain `session`, `tasks`, and `notes` for compatibility; add `events` and set `version: 3`.

```js
const event = {
  id: 'event-id', title: 'Live session', date: '2026-09-05',
  time: '20:00', type: 'live', detail: '', createdAt: 'ISO timestamp',
};
// type: live | work | personal; empty time means all-day.
// Notes retain their original type keys; body limit becomes 2000; pinned is boolean.
```

Model exports: `STORAGE_KEY`, `PREVIOUS_STORAGE_KEY`, `LEGACY_STORAGE_KEY`, `STAGES`, `NOTE_LABELS`, `NOTE_STAGE`, `EVENT_LABELS`, `createItemId`, `toDateValue`, `getCalendarDays`, `shiftMonth`, `normalizeEvent`, `normalizeTask`, `normalizeTasks`, `normalizeNote`, `createDefaultState`, `normalizeState`.

- `getCalendarDays('YYYY-MM')` returns 42 Monday-first `{ date, isCurrentMonth }` entries using local calendar dates.
- `shiftMonth('YYYY-MM', offset)` shifts from day one and returns `YYYY-MM`.
- `normalizeEvent(value, fallbackId)` rejects empty titles, nonexistent dates and invalid times; caps title at 80 and detail at 500.
- `normalizeTasks(values, prefix, removeStarters = false)` only removes exact built-in entries when explicitly importing.
- `normalizeState(value)` imports a populated v2 session only if not already v3; v3 events never derive from retained session metadata.

## Milestones

### 1. Model And Migration (Luna)

Files: `public/js/admin/todo-model.js`, `test/toolbox-todo-model.test.js` only.

- [x] Implement the named interfaces and conservative v1/v2 migration.
- [x] Test empty initialization, custom records and original IDs/completion, exact starter filtering, one-time session import, note links/pins, event normalization, leap days and cross-year calendar navigation.
- [x] Run `node --experimental-vm-modules --test test/toolbox-todo-model.test.js`.

### 2. Usable Workbench (Primary)

Files: `todo.js`, `planner.html`, `streamer-planner.css`, the navigation description, and `test/toolbox-todo.test.js`.

- [x] Replace cue stages and template chips with a month calendar, selected-day agenda, memo composer/list and compact task list.
- [x] Implement calendar navigation/today, event creation/edit/delete, memo editing/pinning/deleting/conversion to task, task completion/deletion, and reload persistence.
- [x] Use a native dialog for event editing; preserve meaningful empty states and clear local-save failure status. Never overwrite unreadable current storage.
- [x] Update the focused tests to the new UI contract while retaining legacy task API tests.

### 3. Acceptance And Contract Update (Primary)

- [x] Update only the owning workbench descriptions in architecture docs and the already-modified usage guide, preserving other edits.
- [x] Run focused model/facade tests, admin composition, select overflow and module boundary tests; run affected JavaScript syntax checks and documentation governance.
- [x] Exercise the new controls in an isolated runtime: empty and populated calendar, edit/cancel/delete, month/today navigation, notes/tasks and reload; check invalid/blank input and dense content.
- [x] Capture desktop and narrow-window screenshots; check key region geometry and clipping. State any visual inspection limitation honestly.
- [x] Inspect the touched diff, `git diff --check`, and `git status --short`; confirm no generated or sensitive data is included.

## Failure Handling And Done When

Prior storage remains untouched. Failed reads disable writes to the new key; failed writes must be visible and keep current in-memory entries. No blanket reset, checkout, delete or commit is used for rollback. Review only this plan's files to reverse task-owned changes if necessary.

Done when calendar/memo/task workflows work and persist, legacy personal data survives import, focused checks pass, UI evidence is recorded, and unrelated edits remain intact.

## Verification Record

Completed 2026-09-05. Focused workbench/model, admin composition, select overflow,
ESM/module boundary, JavaScript syntax, documentation governance, and diff checks
passed. Isolated runtime checks covered empty, populated, invalid-input, dense,
reload, month navigation, event, memo, and task states at 1280x722 and 1024x680.
No page errors, horizontal overflow, or overlapping workbench regions were found.
Screenshots were captured, but the active model could not inspect image pixels, so
visual acceptance used DOM geometry and overflow evidence. A mixed toolbox-sidebar
run had one concurrently changing, unrelated danmaku-style assertion failure; the
same test passed before that external change, and it was not modified for this plan.
