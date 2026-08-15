# Remaining Source Modularization Plan

**Goal:** Modularize the remaining oversized CSS and JavaScript sources without changing browser behavior or introducing an HTML assembly runtime.

**Architecture:** Keep `toasts.css` and `workspace.css` as ordered import facades, move contiguous feature rules into sibling directories, and extract the overtime rule editor behind a two-method module boundary. Keep the static `admin.html` entry intact until the project adopts a deliberate HTML build/include mechanism.

**Tech Stack:** CSS imports, browser ES modules, `node:test`

## Constraints

- Preserve CSS cascade order exactly.
- Preserve `window.AdminApp.overtime` and all API payloads.
- Do not add runtime HTML fragment fetching or dependencies.
- Keep each new source file below 700 lines.

### Task 1: Split toast and workspace styles

- [x] Convert both oversized files to ordered import facades.
- [x] Move only contiguous rules into feature-oriented files.
- [x] Update source-based tests to expand CSS imports.

### Task 2: Extract the overtime rule editor

- [x] Move rule rendering, editing, validation, and probability logic into a dedicated module.
- [x] Keep page lifecycle, API actions, catalog, clock, and settlement orchestration in `overtime.js`.
- [x] Update source-based tests to inspect the module graph.

### Task 3: Verify and document the HTML decision

- [x] Confirm all new sources remain below 700 lines.
- [x] Run focused tests, `npm run check`, and `npm test`.
- [x] Record why `admin.html` remains a static monolith pending a build/include decision.

## HTML decision

Keep `public/pages/admin.html` as the static route entry for now. The server serves this file directly, and browser regression tests inspect its markup directly. Splitting it today would require either runtime fragment fetching (adding load-order and failure states) or a new build-time template compiler. That architectural change is larger and more coupled than the mechanical source modularization in this plan, so it should be proposed and tested separately.
