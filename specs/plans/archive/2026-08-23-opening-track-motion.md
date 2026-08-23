# Opening Track Motion Implementation Plan

**Status:** Complete (2026-08-23)

**Goal:** Add three safe, selectable waveform motion treatments to the opening
animation and expose them through the Admin editor without changing existing
Browser Source URLs or the default appearance.

**Non-goals:** Do not add free-form animation input, new endpoints, schema DDL,
dependencies, or changes to music, copy, character artwork, and unrelated Admin
panels.

**Ownership:** `public/pages/admin/toolbox/start-animation.html` and
`public/js/admin/start-animation.js` own the editor; `public/pages/overlays/opening.html`,
`public/css/overlays/opening.css`, and `public/js/overlays/opening.js` own rendering;
`src/storage/settings-store.js`, `src/server/opening-contract.js`, and the opening
and settings routes own persistence and validation; `test/opening-overlay.test.js`
owns focused regressions.

**Compatibility constraints:** Keep `heart` as the default, keep `/opening` as the
fixed address, preserve current settings and API shapes additively, and reject or
fall back from values outside `heart|barber|progress`.

## Milestones

1. Add focused failing assertions for Admin markup, query/payload plumbing, default
   storage, endpoint sanitization, invalid settings rejection, and all SVG/CSS modes.
2. Add the shared enum contract and wire it through settings storage and opening
   configuration.
3. Add the Admin control and overlay layers with paused, low-quality, and
   reduced-motion behavior.
4. Update owning architecture documentation, run focused and layered checks, and
   visually inspect all three modes at Browser Source proportions.

## Verification

```text
node --test test/opening-overlay.test.js
node --test test/opening-overlay.test.js test/admin-page-composition.test.js
npm run verify:docs
npm run check
npm run verify:quick
git diff --check
git status --short
```

All focused tests, documentation checks, JavaScript syntax checks, architecture
checks, and the quick gate passed. Headless Chromium rendered all three modes at
1920×1080 without page errors; each mode exposed only its intended foreground
layer, and the heart remained attached to the shared SVG motion path.

## Rollback

Remove the additive setting/response/query field, Admin select, SVG foreground
layers, and their tests/docs. Existing `heart` markup remains the compatibility
baseline; no database schema rollback is required.

## Done When

- Admin exposes and persists exactly three track-motion choices.
- Preview URLs and fixed `/opening` rendering resolve the selected validated mode.
- Invalid submissions return 400 and invalid read/render values fall back to heart.
- New loops have no hard seam and stop under low-quality/reduced-motion conditions.
- Focused tests, docs, syntax, quick gates, visual QA, and final diff review pass.

