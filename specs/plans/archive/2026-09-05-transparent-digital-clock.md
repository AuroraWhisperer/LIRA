# Transparent Digital Clock Implementation Plan

**Goal:** Add the reference's white condensed, two-line digital clock on a
transparent background, and center the existing horizontal timeline separator.

**Architecture:** Extend the existing clock renderer and style selector with
`digital`. Keep the existing settings route, keys, fixed `/clock` URL, and
560 x 190 design canvas. No dependency, storage migration, or new endpoint.

**Tech Stack:** Vanilla frontend ESM, native CSS, CommonJS contract, node:test.

## Boundaries

- Preserve the five existing styles, defaults, custom labels, query overrides,
  date/seconds toggles, and 12/24-hour controls.
- New style: white condensed digits with a subtle dark outline; date and uppercase
  English weekday above full-size hours, minutes, and seconds; no background,
  mascot, year block, or custom label. Use installed fonts, not new assets.
- Reference text and geometry were inspected with local OCR and pixel analysis;
  direct image viewing is unavailable in this session.
- Preserve unrelated worktree edits, including existing API/frontend doc changes.
- No commits, real-settings writes, broad refactors, or repository-wide test run.

## Ownership

- `src/server/clock-contract.js`: accepted `clockStyle` values and label defaults.
- `public/js/overlays/clock.js`: style selection, formatting, and canvas scaling.
- `public/css/overlays/clock.css`: transparent layout and timeline separator fix.
- `public/js/admin/clock-card.js`, `public/pages/admin/toolbox/clock.html`, and
  `public/css/admin/other-features/clock.css`: picker, label state, and swatch.
- `test/clock-overlay.test.js`: existing route, settings, renderer, and picker checks.
- Owning contract docs: `docs/architecture/backend/api.md`,
  `docs/architecture/frontend/app.md`, `docs/architecture/frontend/overlays.md`.

## Milestones

- [x] Inspect the reference, current owner, callers, and focused tests.
- [x] Add `digital` to the contract and selector; retain existing persistence and
  URL behavior. Verify with the clock test file using isolated settings stubs.
- [x] Render the two-line clock using existing elements. Format the upper date as
  `YYYY-MM-DD`, weekday as `THU`, and seconds with a colon and equal digit size.
  Center only the horizontal timeline's separator; preserve digit baselines.
- [x] Update only affected contract facts, inspect the diff, and archive this plan.

## Verification

- Run `node --experimental-vm-modules --test test/clock-overlay.test.js` and
  focused syntax checks. The frontend test helper requires the VM modules flag.
- Use an isolated local server and a Playwright session for the OBS surface.
  Verify transparent screenshot pixels, two nonoverlapping lines, equal-sized
  seconds, advancing time, and full content bounds at 580 x 210 and 300 x 115.
- Exercise selector changes and date/seconds/12-hour control cycles with mocked
  settings requests, never real user settings. Check custom-label retention.
- Check missing date/seconds and the longest weekday/digit combination; confirm
  timeline-horizontal separator centering and one unchanged decorated style.
- Final `git diff --check`, touched diff review, and `git status --short`.

## Failure Handling And Done When

Stop on unresolved contract or data-integrity questions. Inspect and reverse only
task-owned hunks if necessary. Complete when the new style is selectable, renders
the requested transparent layout, focused tests pass, compatibility remains
intact, and verification limitations are recorded. Execution is in this session
with one bounded Luna subtask; optional superpowers execution skills are absent.

## Progress

- Luna's scoped contract and regression changes passed all 8 clock tests using
  the required VM modules flag. The plain node:test command cannot load the
  repository's existing ESM test helper.
- Port 3000 serves the installed app from `live-exe/LIRA/resources/app.asar`, not
  this workspace. Preview uses port 3002, a temporary data directory, and the
  existing server runtime with background authorized work disabled.

## Verification Results

- Clock tests: 8/8 pass with `--experimental-vm-modules` after implementation.
- `node --check` passes for the overlay, admin module, and server contract.
- Transparent PNG capture at 580 x 210: 79,405 fully transparent pixels;
  card computed background is transparent. At 300 x 115, both rows fit inside
  the scaled canvas without overlap; seconds have the same height as hours.
- Live seconds advance; a fixed local midnight renders `00` with `2026-09-03`
  and `THU`. `WED` and the 12-hour period indicator do not overlap.
- Actual picker controls in an in-memory isolated fixture passed date/seconds
  off/on, 12/24-hour, decorated/digital style switching, and reload restoration.
  All nine settings requests were mocked; custom text remained unchanged.
- The horizontal separator's final center is y=100 at native design scale;
  digit ink centers are y=99.5-100, versus the previous low text separator.
- Screenshots are outside the repository in the task visualization directory.
- Touched source/contract diffs reviewed; `git diff --check` passes. Unrelated
  concurrent changes were preserved.

**Limitations:** Reference comparison used OCR, pixel geometry, and font/color
inspection because direct image viewing was unavailable. No installed Electron
package was rebuilt and no full-app desktop visual acceptance is claimed.
