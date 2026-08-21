# Song Board Local Font Library Implementation Plan

> **For agentic workers:** Execute this plan inline in the current task and track each step with the checkboxes below. Do not create commits unless the user explicitly requests one.

**Goal:** Let point-song board styles 3–6 choose from LIRA's built-in font presets and the same automatically discovered local font families used by desktop lyrics, while retaining the existing Microsoft YaHei-led multilingual fallback.

**Architecture:** Extract local-font discovery, normalization, deduplication, option rendering, and saved-option preservation from `desktop-lyric.js` into one named ESM module owned by the Admin frontend. Both the illustrated queue font selector and desktop lyric selector register with that module, so Chromium is queried once and each selector retains its own built-in options and selected value. The existing exact-origin Electron permission boundary remains unchanged; only its user-facing purpose copy expands to mention the point-song board.

**Tech Stack:** Electron 43, Chromium Local Font Access API, Vanilla JavaScript ES modules, native HTML selects enhanced by the existing custom select component, `node:test`.

## Global Constraints

- Preserve the existing `illustratedQueueFontFamily` and `desktopLyricFontFamily` settings keys and stored values.
- Keep styles 1–2 and every style 3–6 asset, layout, color, weight, and scroll behavior unchanged.
- Keep the built-in illustrated-font options before a trailing `本机字体` group.
- Query local font family names only; do not read font files, paths, or binary content.
- Preserve exact LIRA-origin permission checks and deny all unrelated permissions.
- Keep `withMultilingualFallback()` as the render-time fallback owner, led by Microsoft YaHei.
- Add no dependency, IPC channel, process, service, port, or database migration.

---

## Current Behavior

The illustrated queue selector in `public/pages/admin/song/queue-theme.html` contains five built-in choices but never receives local font options. `public/js/admin/desktop-lyric.js` independently owns automatic `window.queryLocalFonts()` discovery and appends a deduplicated `本机字体` optgroup only to the desktop lyric selector. The queue renderer already passes selected illustrated fonts through `withMultilingualFallback()`, whose first fallback is Microsoft YaHei.

## Ownership

- Admin owner: `public/js/admin/theme.js`, `public/js/admin/desktop-lyric.js`, and the new `public/js/admin/local-font-library.js` (`ROUTE-ADMIN`).
- Electron permission owner: `src/electron/desktop-permissions.js` (`ROUTE-ELECTRON`).
- Contracts: `docs/architecture/frontend/app.md` and `docs/architecture/desktop/main.md`.
- Consumers: the styles 3–6 font selector, the desktop lyric font selector, and the existing custom select `MutationObserver`.
- Focused tests: `test/local-font-library.test.js`, `test/frontend-queue.test.js`, `test/desktop-lyrics.test.js`, and `test/electron-main-modules.test.js`.

## Non-goals

- Do not add local fonts to style 1, the display-board selector, or unrelated theme controls.
- Do not persist the full local font inventory.
- Do not change the default per-style illustrated font or rewrite existing saved font choices.
- Do not add a manual permission button or redesign the settings panel.

## Proposed Changes

- Create `public/js/admin/local-font-library.js` with `registerLocalFontSelect(select)` and `ensureSavedFontOption(select, value)` named exports.
- Update `theme.js` and `desktop-lyric.js` to register their selectors with the shared library; remove the duplicated desktop-lyric discovery implementation.
- Update `forms.js` to install a missing saved illustrated font option before assigning the persisted value.
- Update the permission dialog and architecture docs to disclose both desktop lyric and point-song board usage.
- Add focused unit and contract coverage for one shared query, two populated selectors, deduplication, selection preservation, saved local values, and the permission copy.

## Task 1: Establish local-font sharing regressions

**Files:**
- Create: `test/local-font-library.test.js`
- Modify: `test/frontend-queue.test.js`
- Modify: `test/electron-main-modules.test.js`

**Interfaces:**
- Consumes: `window.queryLocalFonts(): Promise<Array<{ family: string }>>`.
- Produces: failing coverage for `registerLocalFontSelect(select)` and `ensureSavedFontOption(select, value)`.

- [x] Add a unit test that registers two fake selects, returns duplicate and blank font descriptors, and expects one browser query plus the same sorted `本机字体` group on both selects.
- [x] Assert built-in values and each current selection remain unchanged after population.
- [x] Assert an unavailable persisted illustrated font can be inserted as `（当前设置）` before form assignment.
- [x] Assert `theme.js` registers `illustratedQueueFontFamily` and the Electron prompt names both point-song board and desktop lyric usage.
- [x] Run `node --experimental-vm-modules --test test/local-font-library.test.js test/frontend-queue.test.js test/desktop-lyrics.test.js test/electron-main-modules.test.js`; the new assertions failed before implementation and passed afterward.

## Task 2: Share automatic local-font discovery

**Files:**
- Create: `public/js/admin/local-font-library.js`
- Modify: `public/js/admin/theme.js`
- Modify: `public/js/admin/desktop-lyric.js`
- Modify: `public/js/admin/forms.js`

**Interfaces:**
- `registerLocalFontSelect(select: HTMLSelectElement | null): void` registers a consumer and populates all registered consumers from one memoized local-font query.
- `ensureSavedFontOption(select: HTMLSelectElement | null, value: string): void` preserves a stored selection that is absent from current built-ins and discovered options.

- [x] Move the control-character stripping, 200-character cap, case-insensitive deduplication, locale sorting, CSS quoting, and `本机字体` optgroup rendering into the shared module.
- [x] Keep one module-level query promise and one registered-select set; on successful discovery, populate every registered selector without dispatching `input` or `change`.
- [x] On a `SecurityError`, clear the pending query and install one-shot pointer/keyboard retries; on denial or other failures, retain all current options and selections.
- [x] Import and call `registerLocalFontSelect(document.getElementById('illustratedQueueFontFamily'))` from `initThemeForm()`.
- [x] Replace desktop lyric's private discovery functions with the shared exports, preserving its existing saved-font behavior.
- [x] In `formsService.fillForm(values)`, call `ensureSavedFontOption()` for `illustratedQueueFontFamily` before assigning form values.
- [x] Run the focused test command until every focused regression passes.

## Task 3: Keep permission disclosure and contracts accurate

**Files:**
- Modify: `src/electron/desktop-permissions.js`
- Modify: `docs/architecture/desktop/main.md`
- Modify: `docs/architecture/frontend/app.md`

**Interfaces:**
- Consumes: the existing exact-origin `localFonts` permission handler.
- Produces: accurate user disclosure and owner documentation; no permission or IPC shape changes.

- [x] Change the native dialog detail to state that font family names are used by desktop lyrics and point-song board styles 3–6.
- [x] Document that both Admin selectors share one normalized local font inventory and keep their built-ins/current values.
- [x] Run `node --test test/governance-docs.test.js` and the focused Electron test.

## Verification

- `node --experimental-vm-modules --test test/local-font-library.test.js test/frontend-queue.test.js test/desktop-lyrics.test.js test/electron-main-modules.test.js` — expected PASS.
- `npm run check` — expected PASS.
- `npm run verify:quick` — expected PASS.
- `npm test` — expected PASS.
- Electron visual check at 1280×720 — styles 3–6 font menu shows built-ins first and a scrollable `本机字体` group; choosing a local family preserves the value after state reload.
- `git diff --check`, `git diff`, `git diff --cached`, and `git status --short` — expected no unrelated or generated changes.

## Rollback Or Failure Handling

Stop after a failed focused test, inspect only the files listed above, and reverse task-owned hunks with a targeted patch. Restore desktop lyric's existing private font discovery only if the shared module cannot preserve its established tests. Do not use reset, blanket checkout, broad deletion, or real user data.

## Done When

- Styles 3–6 retain all built-in choices and additionally show unique local font families after permission succeeds.
- Desktop lyrics keep the same local-font behavior, and both selectors cause only one `queryLocalFonts()` call per page load.
- Saved local choices survive delayed discovery and unavailable-font states.
- The queue renderer still falls back through Microsoft YaHei and the existing multilingual stack.
- Permission boundaries are unchanged and disclosure/docs are accurate.
- Focused tests, quick verification, full tests, visual inspection, and final diff review pass.

## Results

Completed on 2026-08-21.

- Focused regression: 56 passed, 0 failed.
- `npm run verify:quick`: documentation, 411-file JavaScript syntax, and architecture gates passed.
- Full suite: 784 tests, 783 passed, 1 skipped, 0 failed.
- Isolated 1280×720 Playwright check: both selectors received the same three deduplicated test families from one query; illustrated built-ins stayed first; duplicate Microsoft YaHei and YouYuan entries were omitted; selecting `Cascadia Code` survived a page reload; the open menu fit within the viewport.
- `playwright-interactive` could not run because `js_repl` was unavailable in the current session. The equivalent renderer check used repository Playwright with an isolated temporary data directory, a random high port, and an injected local-font API; the exact-origin Electron permission behavior remained covered by `test/electron-main-modules.test.js`.
