# Cute Clock Card Implementation Plan

**Status:** Complete

**Goal:** Add a fixed `/clock` Browser Source and a new Admin toolbox card named
「萌时钟」 that previews two cute visual styles and builds optional URL parameters
for the displayed date, seconds, hour format, and short badge copy.

**Non-goals:** Do not add persistence, API endpoints, database settings, external
fonts or images, a countdown/stopwatch mode, or changes to existing overlays and
toolbox panels.

**Current behavior:** LIRA has fixed Browser Source pages for queue, danmaku,
games, opening animation, and related overlays, but no standalone current-time
card. Existing Admin tools establish the fixed-address, copy, open, and iframe
preview patterns.

**Ownership:** `public/pages/overlays/clock.html`, `public/css/overlays/clock.css`,
and `public/js/overlays/clock.js` own the clock renderer. The Admin editor is owned
by `public/pages/admin/toolbox/clock.html`,
`public/css/admin/other-features/clock.css`, and
`public/js/admin/clock-card.js`. Public page mapping and Admin composition remain
owned by `src/server/http-utils.js` and `src/server/admin-page.js`. Contracts are
documented in `docs/architecture/frontend/pages.md` and
`docs/architecture/frontend/overlays.md`; focused regressions live in
`test/clock-overlay.test.js`.

**Compatibility constraints:** Keep the app framework-free and dependency-free,
use the fixed `/clock` path, keep the page frameable for OBS/直播姬, render user
copy with `textContent`, accept only documented parameter enums, retain a
transparent page outside the card, and respect `prefers-reduced-motion`.

## Proposed changes

- Add the `/clock` overlay with `peach` and `starlight` style enums and safe URL
  parsing for `style`, `date`, `seconds`, `format`, and `label`.
- Add the 「萌时钟」 toolbox navigation entry and a two-column desktop editor:
  live preview on the left; fixed URL, style choices, and custom parameters on the
  right.
- Register the fragment, stylesheet, Admin initializer, public page mapping, and
  frame allowlist entry.
- Update frontend page/overlay ownership documents and add focused tests.

## Milestones

1. Add failing assertions for the fixed route, frameability, two styles, safe
   rendering, toolbox copy, parameters, and Admin composition.
2. Implement the overlay renderer and two distinct code-native visual systems.
3. Implement the Admin toolbox card, URL builder, copy/open actions, and preview.
4. Update owning documentation, run focused and layered checks, visually inspect
   both styles and the desktop layout, and review the final scoped diff.

## Verification

```text
node --test test/clock-overlay.test.js
node --test test/clock-overlay.test.js test/admin-page-composition.test.js test/toolbox-sidebar.test.js
npm run verify:docs
npm run check
npm run verify:quick
git diff --check
git status --short
```

Visual QA covers both styles, all parameter controls, copy/open behavior, long
badge copy clamping, date/seconds hidden states, and the Admin panel at its
launched desktop size plus a narrower realistic viewport.

## Rollback or failure handling

Remove only the additive `/clock` route, overlay/Admin files, navigation and
composition registrations, focused tests, and documentation rows. No persisted
data or schema requires rollback. Inspect the task-scoped diff instead of using a
blanket checkout or reset.

## Done when

- 百宝箱 shows 「萌时钟」 with the requested annotation and a working live preview.
- `/clock` renders both cute styles and updates current local time accurately.
- The fixed URL and parameterized URL can be copied; all custom controls update
  the preview and generated address.
- Invalid URL values fall back safely and label text never becomes HTML.
- Focused tests, docs, syntax, quick gates, visual QA, and final diff review pass.

## Completion evidence

- The focused clock, Admin composition, and toolbox regressions pass: 16/16.
- Documentation, JavaScript syntax (437 files), and architecture quick gates pass.
- Both 560 × 190 styles were inspected in the desktop browser with a 78px main
  time, enlarged 15px label, approximately 25px seconds, and 18px date row;
  neither style overlaps its mascot and no browser errors were reported.
- The full suite reached 856/858; the two failures are existing assertions in
  blindbox ranking configuration and opening-animation markup, outside this
  additive clock route and its focused consumers.
