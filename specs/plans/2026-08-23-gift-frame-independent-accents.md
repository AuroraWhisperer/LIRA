# Gift Frame Independent Accents Implementation Plan

> **For agentic workers:** Execute inline in the current task; do not dispatch subagents or create commits.

**Goal:** Add three transparent illustrated accent images above the existing four-part Woodland Bloom gift frame so individual branches and ornaments can move independently without changing the frame, event, queue, settings, or transparent-center contracts.

**Architecture:** Keep the existing top/right/bottom/left PNGs as the complete structural frame. Add a separate `gift-frame-accents` DOM layer containing a branch sprig, crystal charm, and floral knot, then let `FrameController` own their enter, one-shot holding, exit, reduced-motion, and reset states. Assets stay local under the existing `woodland-bloom` directory; no new dependency, theme loader, protocol, setting, or perpetual animation loop is introduced.

**Tech Stack:** Built-in image generation, transparent PNG, Vanilla JavaScript, native CSS, WAAPI, `node:test`, Playwright visual QA.

## Global Constraints

- `/gift-effects` remains an OBS browser-source overlay with a transparent idle and transparent center.
- The four structural frame images and `frame-composite.png` fallback remain unchanged.
- Add exactly three independent accents; each has a stable `data-frame-accent` hook.
- Holding motion is one-shot, lasts no more than 1100 ms per accent, and uses no infinite CSS or WAAPI loop.
- Full-motion displacement stays within 8 px and rotation within 3 degrees; reduced motion shows static accents with no branch, pendulum, or rotation movement.
- All artwork is local and contains no text, logo, watermark, remote URL, or runtime dependency.
- Preserve unrelated working-tree changes and do not create a commit.

---

## Visual Direction

- Palette: existing Woodland Bloom leaf green, warm gold, ivory blossom, and emerald crystal only.
- Materials: hand-painted glossy leaves, braided gold vine, white jasmine/lily-of-the-valley, and faceted emerald glass.
- Layout: one horizontal branch overlaps the top-right frame join, one narrow crystal charm hangs on the right edge, and one compact floral knot sits above the lower-left border.
- Signature: the extra branch creates a shallow parallax layer over the fixed frame, followed by a quieter charm swing and floral settling motion.
- Restraint review: no character, halo, smoke, large panel, central-screen particle, or fourth accent; the three motions are staggered rather than simultaneous.

## Current Behavior

The overlay already assembles four user-provided transparent frame components and uses the full composite as a local failure fallback. Six bounded Canvas fireflies animate around the perimeter in full motion, while reduced motion is particle-free. All illustrated ornaments are currently baked into the structural PNGs, so none can move independently.

## Ownership

- Owner: `public/pages/overlays/gift-effects.html`, `public/css/overlays/gift-effects.css`, `public/js/overlays/gift-effects.js`
- Contract: `docs/architecture/frontend/overlays.md`, `specs/gift-effects-frame-overlay_design.md`
- Consumer: OBS/browser source at `/gift-effects`
- Focused test: `test/gift-effects-overlay.test.js`

## Non-goals

- Do not redraw or modify the five existing frame PNGs.
- Do not add an accent editor, theme selector, remote asset loader, or new settings key.
- Do not add continuous idle loops, physics, audio, video, or Canvas-rendered branches.
- Do not change gift thresholds, frame events, queue ordering, or Admin controls.

## Milestone 1: Generate and import the three accent assets

**Files:**

- Create: `public/img/overlays/gift-frame/woodland-bloom/accent-branch-sprig.png`
- Create: `public/img/overlays/gift-frame/woodland-bloom/accent-crystal-charm.png`
- Create: `public/img/overlays/gift-frame/woodland-bloom/accent-floral-knot.png`

- [x] Generate one isolated transparent asset per prompt using the existing Woodland Bloom composite as a style reference.
- [x] Inspect every output for real alpha, clean cutout edges, matching light direction, correct anatomy/materials, and absence of text or framing.
- [x] Copy the selected final files into the workspace without overwriting the structural frame assets.

Focused verification: all three files load as RGBA PNGs, have non-zero transparent and opaque pixels, and visually match the existing gold/green/ivory frame.

## Milestone 2: Define the failing overlay contract test

**File:** `test/gift-effects-overlay.test.js`

- [x] Add assertions for the three local asset URLs and `data-frame-accent="branch|crystal|floral"` hooks.
- [x] Assert the source contains `playHoldingAccents`, uses bounded one-shot animation, and has no `iterations: Infinity` or `animation: ... infinite` accent rule.
- [x] Assert reduced mode bypasses holding accent motion and text continues to use `textContent`.
- [x] Run `node --test test/gift-effects-overlay.test.js`; expect the new test to fail before implementation.

## Milestone 3: Add the independent accent layer

**Files:**

- Modify: `public/pages/overlays/gift-effects.html`
- Modify: `public/css/overlays/gift-effects.css`
- Modify: `public/js/overlays/gift-effects.js`

HTML structure:

```html
<div class="gift-frame-accents" aria-hidden="true">
  <img class="gift-frame-accent gift-frame-accent-branch" data-frame-accent="branch" ...>
  <img class="gift-frame-accent gift-frame-accent-crystal" data-frame-accent="crystal" ...>
  <img class="gift-frame-accent gift-frame-accent-floral" data-frame-accent="floral" ...>
</div>
```

Controller interface:

```js
frameController.playHoldingAccents(session, motionMode);
```

- [x] Position all accents over opaque perimeter artwork with transform origins that match their physical attachment points.
- [x] Fade accents in after their supporting frame component begins entering, then fade them out with the frame.
- [x] Start three staggered one-shot holding motions: branch sway, crystal pendulum, and floral settle.
- [x] Track every WAAPI handle in `PlaybackSession`, reset inline opacity/transform on cleanup, and render reduced mode without holding movement.
- [x] Keep the composite fallback usable; independent accents remain visible because they are not structural frame fragments.

Focused verification: the new static contract test passes, existing gift-frame tests stay green, and forced component failure still shows the composite plus all three accents.

## Milestone 4: Documentation and visual QA

**Files:**

- Modify: `docs/architecture/frontend/overlays.md`
- Modify: `specs/gift-effects-frame-overlay_design.md`
- Modify: `specs/README.md` only if its review date needs updating

- [x] Document three independent local accent images, one-shot holding motion, reduced-motion behavior, and ownership by `FrameController`.
- [x] Capture 1920×1080 full-motion enter and holding states; check that accents read as one frame and do not duplicate existing focal points.
- [x] Capture 2560×1440 full motion and 1280×720 reduced motion; verify no clipping, overflow, or central obstruction.
- [x] Force the composite fallback during playback and verify the independent accents remain correctly layered.
- [x] Wait through cleanup and verify no active animations, text, Canvas pixels, or visible frame nodes remain.
- [x] Run `node --test test/gift-effects-overlay.test.js test/gift-frame-config.test.js test/gift-frame-admin.test.js`.
- [x] Run `npm run check`, `npm run verify:quick`, and review `git diff`, `git diff --check`, `git status --short`, plus any staged diff.

## Rollback Or Failure Handling

If a generated accent does not match the frame, discard only that new asset and regenerate it; do not edit the user's structural PNGs. If runtime motion causes visual or performance problems, remove only the accent DOM/CSS/controller additions and keep the current four-part frame. Never use blanket checkout or destructive reset because the workspace contains unrelated user changes.

## Done When

- Three local transparent accent images visibly sit above, but remain separate from, the four structural frame components.
- Branch, crystal, and floral motions are independently timed, subtle, one-shot, and absent in reduced mode.
- The complete frame remains cohesive at 1080p, 2K, and 720p with a transparent center and no clipping.
- Composite fallback, queue lifecycle, safe text, settings, and event contracts remain unchanged.
- Focused tests and quick verification pass, visual QA is reviewed, and the final diff is task-scoped.
