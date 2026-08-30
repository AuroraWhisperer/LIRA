# Desktop Lyric Automatic Local Fonts Implementation Plan

> **For agentic workers:** Implement this plan inline and verify each checkbox before moving on. Do not create commits unless the user explicitly requests one.

**Goal:** Automatically detect installed local font families when the desktop lyric settings form opens and merge them into the primary-font selector without a manual action.

**Architecture:** Reuse Chromium's `window.queryLocalFonts()` API and the existing Electron `localFonts` permission boundary. The renderer will enumerate and normalize family names during form initialization, retain all built-in and saved choices, and continue storing only the selected CSS font-family string through the existing settings API.

**Tech Stack:** Electron 43, Chromium Local Font Access API, Vanilla JavaScript, HTML/CSS, `node:test`.

## Global Constraints

- Preserve the existing `desktopLyricFontFamily` settings key and built-in font choices.
- Read and expose family names only; do not read font files, paths, or contents.
- Remove the manual local-font button, status text, click listener, and their unused styling/tests.
- Keep unsupported clients, denied permission, and query failures non-destructive.
- Keep the exact-origin Electron permission boundary and add no IPC channel or runtime dependency.

## Task 1: Remove manual UI and replace it with automatic loading

**Files:**

- Modify: `public/pages/admin/song/desktop-lyric.html`
- Modify: `public/css/admin/desktop-lyric-preview.css`
- Modify: `public/js/admin/desktop-lyric.js`

**Interfaces:**

- Consumes: `window.queryLocalFonts(): Promise<Array<{ family: string }>>` when available.
- Produces: a `本机字体` option group merged during `initDesktopLyricForm()` while preserving the current selector value.

- [x] Remove the button, status element, and `aria-describedby` reference from the font picker markup.
- [x] Delete status updates and button event handling; invoke local-font loading once from form initialization with an internal `try/catch`.
- [x] Keep family normalization, CSS quoting, deduplication, sorting, and saved-option preservation unchanged.
- [x] Remove CSS rules that only style the deleted status element.

## Task 2: Update focused regression coverage and owner docs

**Files:**

- Modify: `test/desktop-lyrics.test.js`
- Modify: `docs/architecture/frontend/app.md`
- Modify: `docs/architecture/desktop/main.md`

**Interfaces:**

- Consumes: the automatic initialization behavior from Task 1.
- Produces: tests proving automatic enumeration, deduplication, selection preservation, and non-destructive denial/error handling; documentation matching runtime behavior.

- [x] Replace click-listener fixtures with an initialization-time `queryLocalFonts()` fixture and await its completion.
- [x] Assert the old button/status IDs and click workflow are absent while the local-font group is populated automatically.
- [x] Assert denied or failed enumeration leaves built-in options and the current selection untouched.
- [x] Update frontend and desktop architecture prose from “click to load” to “automatically enumerate on settings-page startup”.

## Verification

- `node --test test/desktop-lyrics.test.js`
- `npm run check`
- `npm run verify:quick`
- Review `git diff --check` and `git status --short`; only task-owned files should change.
