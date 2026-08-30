# Gift Frame Art Upgrade Implementation Plan

**Goal:** Replace the current sparse woodland gift frame with the user's finished composite reference and four production border components, then add restrained firefly motion while preserving the existing gift event, queue, settings, and OBS URL contracts.

**Architecture:** Import the user's transparent composite plus top, right, bottom, and left components without redrawing them. The four components remain independently animated runtime layers; the composite is a local load-failure fallback and alignment reference. A bounded Canvas controller adds firefly points only around the frame perimeter. The change stays inside the gift-frame overlay owner; no new runtime dependency, theme loader, protocol, setting, or backend behavior is introduced.

**Tech Stack:** User-authored transparent PNG assets, Canvas 2D, Vanilla JavaScript, native CSS, HTML, `node:test`, Playwright visual QA.

## Global Constraints

- Electron remains the primary admin client; `/gift-effects` remains an OBS browser-source overlay.
- Preserve `/gift-effects`, `gift:frame`, all settings keys, queue semantics, motion-mode precedence, and transparent idle behavior.
- Use four independently addressable runtime border assets: top, right, bottom, and left.
- Keep all artwork local and allowlisted; do not load remote artwork at runtime.
- Do not create a commit.

---

## Non-goals

- No new theme selector option or runtime theme loader.
- No change to gift thresholds, event construction, preview endpoints, or admin settings persistence.
- No redesign of unrelated admin panels or overlays.
- No full-screen forest background that covers the stream content.

## Current Behavior

The overlay already receives `gift:frame` events and has bounded queueing, reduced-motion handling, watchdog cleanup, and a bottom information plate. The visible frame is an inline SVG made from broad green strokes and a few leaf paths. At 1920×1080 it reads as a basic wire frame and lacks the user's completed botanical, lantern, butterfly, crystal, and glow detail.

## Ownership

- Owner: `public/pages/overlays/gift-effects.html`, `public/css/overlays/gift-effects.css`, `public/js/overlays/gift-effects.js`
- Contract: `docs/architecture/frontend/overlays.md`, `specs/gift-effects-frame-overlay_design.md`
- Consumer: OBS/browser source at `/gift-effects`; Admin preview in `public/js/admin/gift-frame.js`
- Focused test: `test/gift-effects-overlay.test.js`

## Visual Direction

- Subject: a moonlit forest gift celebration for a Chinese livestream audience.
- Palette: Deep Pine `#112C26`, Fern `#35634C`, Moss `#718D5A`, Champagne Gold `#D8B86A`, Moon Ivory `#F2E7C8`, Firefly `#BDE7A7`.
- Materials: carved dark wood, layered fern and lily-of-the-valley foliage, restrained gold filigree, dew crystals, and soft firefly light.
- Motion: preserve the baked lantern and firefly light as a visual base, then add at most six small perimeter fireflies with staggered opacity, scale, and short drift. No particle crosses the central stream-safe area.
- Signature: four richly illustrated botanical components assemble around the transparent center while the bottom component's ivory plaque becomes the actual gift-information surface.

## QA Inventory

| Claim or state                       | Functional check                                                                                          | Visual evidence                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Frame is actually four parts         | Assert four stable `data-frame-part` side nodes and four local asset URLs                                 | Holding-state screenshot at 1920×1080            |
| Artwork is intricate and coordinated | Inspect the user's wood, foliage, gold, butterfly, lantern, crystal, and firefly detail                   | Holding-state screenshot and close visual review |
| Fireflies improve the static image   | Verify the bounded controller emits perimeter-only light points in full motion and none in reduced motion | Enter/holding transition screenshots             |
| Stream center stays usable           | Verify transparent center and no full-screen veil                                                         | 1920×1080 and 2560×1440 screenshots              |
| Existing motion modes remain safe    | Exercise `full` and `reduced`; reduced has no particles or large movement                                 | Reduced holding-state screenshot                 |
| Lifecycle remains clean              | Wait through playback and verify `idle`, hidden frame, empty dynamic text                                 | Post-playback DOM assertions                     |
| Long text remains readable           | Dispatch long gift/user strings and verify ellipsis without amount clipping                               | Dense payload screenshot                         |

Exploratory checks: reload during playback and run at a smaller 1280×720 viewport; confirm no stale classes, clipping, or unexpected center obstruction.

## Milestone 1: Import and verify the artwork

**Files:**

- Create: `public/img/overlays/gift-frame/woodland-bloom/frame-composite.png`
- Create: `public/img/overlays/gift-frame/woodland-bloom/frame-top.png`
- Create: `public/img/overlays/gift-frame/woodland-bloom/frame-right.png`
- Create: `public/img/overlays/gift-frame/woodland-bloom/frame-bottom.png`
- Create: `public/img/overlays/gift-frame/woodland-bloom/frame-left.png`

- [x] Import the user's five transparent PNGs without recompressing or redrawing them.
- [x] Verify RGBA alpha, dimensions, composition, edge safety, and component orientation.
- [x] Verify the four slices reconstruct the frame without visible seams at 1920×1080.

## Milestone 2: Integrate the four components and fireflies

**Files:**

- Modify: `public/pages/overlays/gift-effects.html`
- Modify: `public/css/overlays/gift-effects.css`
- Modify: `public/js/overlays/gift-effects.js`

- [x] Replace the simple inline frame artwork with four local image nodes while retaining stable `data-frame-part` hooks.
- [x] Position the sides with intentional overlap and viewport-safe scaling; keep the center transparent.
- [x] Animate each side from its corresponding direction and use the bottom artwork's ivory plaque for gift information.
- [x] Add at most six bounded perimeter fireflies in full motion; reduced motion renders no particles.
- [x] Preserve reduced motion, cleanup, queue timing, and safe text rendering.

## Milestone 3: Update contracts and regression coverage

**Files:**

- Modify: `test/gift-effects-overlay.test.js`
- Modify: `docs/architecture/frontend/overlays.md`
- Modify: `specs/gift-effects-frame-overlay_design.md`

- [x] Replace inline-SVG-specific assertions with four-component local-asset, composite-fallback, perimeter-firefly, and transparent-center assertions.
- [x] Update the owner document and draft design specification to describe the user-authored component assets and bounded firefly layer.
- [x] Run `node --test test/gift-effects-overlay.test.js` and confirm it passes.
- [x] Run `npm run check`, `npm run verify:quick`, and the relevant overlay tests.

## Milestone 4: Visual and interaction verification

- [x] Capture the full-motion enter transition and holding state at 1920×1080.
- [x] Capture the holding state at 2560×1440 and reduced-motion state at 1280×720.
- [x] Dispatch a dense long-text payload and verify amount visibility and ellipsis.
- [x] Wait for cleanup and verify the overlay returns to a transparent idle state.
- [x] Review `git diff`, `git diff --check`, `git status --short`, and any pre-existing staged diff.

## Done When

- The forest frame visibly uses the user's detailed coordinated five-image artwork set.
- The runtime border is composed from four independently animated local assets with seam-safe joins.
- Full motion adds restrained firefly activity around the border while reduced motion remains static and particle-free.
- Stream content remains visible through the transparent center at supported 16:9 sizes.
- Existing gift-frame event, settings, queue, accessibility, and cleanup contracts still pass focused tests.
- Final screenshots pass aesthetic, clipping, layering, and readability review.
- The final diff contains only gift-frame visual work plus the plan and does not alter the user's existing opening-overlay changes.
