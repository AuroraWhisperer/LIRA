# Desktop Lyric Local Font Library Implementation Plan

> **For agentic workers:** Implement this plan inline and verify each checkbox before moving on. Do not create commits unless the user explicitly requests one.

**Goal:** Let a desktop-client user explicitly authorize LIRA to read installed font family names and add the complete deduplicated list to the desktop lyric font selector.

**Architecture:** Call Chromium's user-gesture-gated `window.queryLocalFonts()` API from a new Admin button. Electron's default session handles only the `localFonts` permission for the exact LIRA origin and obtains consent with a native dialog; the renderer stores only the selected CSS font-family string through the existing settings API and no privileged IPC bridge is added.

**Tech Stack:** Electron 43, Chromium Local Font Access API, Vanilla JavaScript, HTML/CSS, `node:test`.

## Global Constraints

- Preserve the current built-in font choices and existing `desktopLyricFontFamily` settings key.
- Read and display family names only; do not read or expose font file contents or paths.
- Require an explicit button click and an explanatory confirmation before querying fonts.
- Keep refusal, unsupported-client, and query-failure behavior non-destructive.
- Add no runtime dependency, process, port, service, or Electron IPC channel.
- Deny local-font requests outside the exact LIRA origin and deny every unrelated permission handled by this registration.

---

## Goal

Add a visible “获取本地字体” action beside the desktop lyric primary-font selector. After the user accepts the Electron permission dialog, populate the selector with every unique family returned by the client while keeping the current selection and built-in choices intact.

## Non-goals

- Enumerating fonts for the song board, queue, or other theme selectors.
- Reading font binary data, file names, or filesystem paths.
- Persisting the complete local font inventory in server settings.
- Adding native font-parsing dependencies or OS-specific registry access.

## Current Behavior

`public/pages/admin/song/desktop-lyric.html` contains eleven hard-coded choices. `public/js/admin/desktop-lyric.js` loads and saves only the selected string and has no font-enumeration workflow. `test/desktop-lyrics.test.js` covers the settings form and live preview but not local-font authorization or population.

## Ownership

- Owner: `public/js/admin/desktop-lyric.js` and `public/pages/admin/song/desktop-lyric.html`.
- Contract: `docs/architecture/frontend/pages.md` and `docs/architecture/frontend/overlays.md`; the existing persisted key remains documented in `docs/architecture/backend/storage.md`.
- Consumer: the Admin desktop lyric form and `public/js/admin/desktop-lyric-preview.js`; the `/lyrics` browser source continues to consume the stored family string.
- Focused test: `test/desktop-lyrics.test.js`.

## Compatibility Constraints

- The Admin page must still work when opened outside Electron or when `queryLocalFonts` is unavailable.
- Existing saved font values and all built-in font-stack choices must remain selectable.
- Canceling or failing a query must not trigger autosave or change the selected font.
- Local font family values must be safe to interpolate into the existing CSS `font-family` stack.

## Proposed Changes

- Modify `public/pages/admin/song/desktop-lyric.html` to add the button and an `aria-live` status.
- Modify `public/css/admin/desktop-lyric-preview.css` to fit the selector, button, and status within the existing control layout.
- Modify `public/js/admin/desktop-lyric.js` to confirm authorization, query fonts, normalize and deduplicate families, safely quote CSS family values, preserve selection, and render status/error states.
- Create `src/electron/desktop-permissions.js` and wire it from `src/electron/main.js` so the exact LIRA origin can request only `localFonts` after an Electron-native confirmation.
- Modify `docs/architecture/desktop/main.md` to record the permission boundary.
- Modify `test/desktop-lyrics.test.js` with renderer-level regression coverage for successful population, deduplication, repeat loading, and non-destructive permission denial.

Discovery during implementation: Electron 43 exposed `window.queryLocalFonts()`, but its default session denied `localFonts` without presenting a usable prompt. The implementation therefore moved the consent prompt from a renderer confirmation to the owning Electron permission handler; a real client retry then enumerated 219 unique installed families.

## Milestones

### Task 1: Regression coverage

**Files:**

- Test: `test/desktop-lyrics.test.js`

**Interfaces:**

- Consumes: `window.queryLocalFonts(): Promise<Array<{family: string}>>` after Electron resolves the permission request.
- Produces: assertions for unique local options, repeat loading, preserved selection, and permission-denial messaging.

- [x] Add the HTML contract assertions for `desktopLyricLoadLocalFontsBtn` and `desktopLyricLocalFontStatus`.
- [x] Add a VM test that invokes the real click listener with duplicate descriptors and confirms one option per family.
- [x] Verify permission denial leaves the populated selector unchanged.
- [x] Run `node --experimental-vm-modules --test test/desktop-lyrics.test.js`; the new assertions failed before implementation.

### Task 2: Local font loading UI

**Files:**

- Modify: `public/pages/admin/song/desktop-lyric.html`
- Modify: `public/css/admin/desktop-lyric-preview.css`
- Modify: `public/js/admin/desktop-lyric.js`
- Test: `test/desktop-lyrics.test.js`

**Interfaces:**

- Consumes: `FontData.family` values from `window.queryLocalFonts()`.
- Produces: an optgroup labeled `本机字体`, safely quoted option values, button busy state, and user-visible status text.

- [x] Add the selector/button/status markup with accessible labels and live status reporting.
- [x] Add the minimum CSS needed for a stacked action layout that fits the existing narrow settings column.
- [x] Implement API support detection, busy-state cleanup, family-name normalization, case-insensitive deduplication, locale sorting, and current-selection preservation.
- [x] Keep all built-in options if the user refuses permission or enumeration throws.
- [x] Run the focused test until it passes.

### Task 3: Electron permission boundary

**Files:**

- Create: `src/electron/desktop-permissions.js`
- Modify: `src/electron/main.js`
- Modify: `docs/architecture/desktop/main.md`
- Test: `test/electron-main-modules.test.js`

**Interfaces:**

- Consumes: Electron's `localFonts` permission request, the running desktop `baseUrl`, and `hasExactOrigin(candidateUrl, expectedUrl)`.
- Produces: a native allow/cancel prompt and a boolean permission callback; all unrelated permissions and foreign origins return `false`.

- [x] Register the permission handler after the local server chooses its base URL and before the main window is created.
- [x] Show the native dialog only for `localFonts` from the exact LIRA origin.
- [x] Add unit coverage for allow, cancel, foreign-origin denial, and unrelated-permission denial.
- [x] Run the focused Electron module test until it passes.

## Verification

- `node --experimental-vm-modules --test test/desktop-lyrics.test.js` — all desktop lyric regressions pass.
- `npm run check` — JavaScript syntax passes.
- `npm run verify:quick` — documentation, syntax, and architecture checks pass.
- Launch the Electron client, click the action, accept the native permission dialog, and confirm the dropdown contains substantially more unique local family names while the current selection remains stable. Observed on the development machine: 219 unique families read, 218 new options appended because one family already existed as a built-in option.
- Repeat with refusal and confirm no options or settings are changed. The real client retained all eleven built-ins and showed the denial status; unit coverage confirms a previously loaded group is also retained.
- Review `git diff`, `git diff --check`, and `git status --short`; only task-owned files are changed.

## Rollback Or Failure Handling

Stop after a failed focused check, inspect only the scoped diff, and reverse task-owned hunks with a new patch. Do not use reset, blanket checkout, or delete user files. Runtime failures remain recoverable because the hard-coded options are never removed.

## Done When

- The desktop lyric settings page presents a clear local-font action and permission explanation.
- Accepting permission lists all unique returned font families and retains the current font selection.
- Refusal, unsupported API, and query errors preserve the built-in selector and provide readable status.
- Focused and quick verification pass, Electron interaction is checked, and the final diff contains no unrelated changes.

## Verification Results

- Focused renderer and Electron tests: 23 passed.
- `npm run verify:quick`: passed documentation, syntax, and architecture gates.
- `npm test`: 611 passed, 1 skipped, 0 failed.
- Real Electron client: Local Font Access API present; 219 unique families read, 218 appended, current selection preserved, repeat loading stable, and no picker overflow at the 1280×720 launch size.
