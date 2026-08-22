# Gift Frame Art Upgrade Implementation Plan

**Goal:** Replace the current sparse woodland gift frame with a polished, production-ready four-part illustrated border and a coordinated forest-guardian character while preserving the existing gift event, queue, settings, and OBS URL contracts.

**Architecture:** Generate one transparent 16:9 master frame and one transparent character illustration, derive four runtime border slices from the master, and keep the existing overlay controller responsible for independent side animation. The change stays inside the gift-frame overlay owner; no new runtime dependency, theme loader, protocol, setting, or backend behavior is introduced.

**Tech Stack:** Built-in image generation, transparent PNG/WebP assets, Vanilla JavaScript, native CSS, HTML, `node:test`, Playwright visual QA.

## Global Constraints

- Electron remains the primary admin client; `/gift-effects` remains an OBS browser-source overlay.
- Preserve `/gift-effects`, `gift:frame`, all settings keys, queue semantics, motion-mode precedence, and transparent idle behavior.
- Use four independently addressable runtime border assets: top, right, bottom, and left.
- Keep all artwork local and allowlisted; do not load remote artwork at runtime.
- Preserve the user's existing `opening-overlay` worktree changes and do not create a commit.

---

## Non-goals

- No new theme selector option or runtime theme loader.
- No change to gift thresholds, event construction, preview endpoints, or admin settings persistence.
- No redesign of unrelated admin panels or overlays.
- No full-screen forest background that covers the stream content.

## Current Behavior

The overlay already receives `gift:frame` events and has bounded queueing, reduced-motion handling, watchdog cleanup, and a bottom information plate. The visible frame is an inline SVG made from broad green strokes and a few leaf paths. At 1920×1080 it reads as a basic wire frame, lacks material detail and depth, and has no coordinated character art.

## Ownership

- Owner: `public/pages/overlays/gift-effects.html`, `public/css/overlays/gift-effects.css`, `public/js/overlays/gift-effects.js`
- Contract: `docs/architecture/frontend/overlays.md`, `specs/gift-effects-frame-overlay_design.md`
- Consumer: OBS/browser source at `/gift-effects`; Admin preview in `public/js/admin/gift-frame.js`
- Focused test: `test/gift-effects-overlay.test.js`

## Visual Direction

- Subject: a moonlit forest gift celebration for a Chinese livestream audience.
- Palette: Deep Pine `#112C26`, Fern `#35634C`, Moss `#718D5A`, Champagne Gold `#D8B86A`, Moon Ivory `#F2E7C8`, Firefly `#BDE7A7`.
- Materials: carved dark wood, layered fern and lily-of-the-valley foliage, restrained gold filigree, dew crystals, and soft firefly light.
- Character: an original adult forest guardian in a refined green-and-ivory dress with matching leaf filigree; calm, welcoming pose; no weapon, logo, text, or borrowed character identity.
- Signature: the guardian overlaps the lower-right join while the four illustrated border sides assemble independently around the transparent center.

## QA Inventory

| Claim or state | Functional check | Visual evidence |
|---|---|---|
| Frame is actually four parts | Assert four stable `data-frame-part` side nodes and four local asset URLs | Holding-state screenshot at 1920×1080 |
| Artwork is intricate and coordinated | Inspect wood, foliage, gold, and firefly detail plus matching character costume | Holding-state screenshot and close visual review |
| Character art is integrated | Verify guardian node participates in enter/exit/reset | Holding and enter-transition screenshots |
| Stream center stays usable | Verify transparent center and no full-screen veil | 1920×1080 and 2560×1440 screenshots |
| Existing motion modes remain safe | Exercise `full` and `reduced`; reduced has no particles or large movement | Reduced holding-state screenshot |
| Lifecycle remains clean | Wait through playback and verify `idle`, hidden frame, empty dynamic text | Post-playback DOM assertions |
| Long text remains readable | Dispatch long gift/user strings and verify ellipsis without amount clipping | Dense payload screenshot |

Exploratory checks: reload during playback and run at a smaller 1280×720 viewport; confirm no stale classes, clipping, or unexpected center obstruction.

## Milestone 1: Generate and prepare the artwork

**Files:**

- Create: `public/img/overlays/gift-frame/woodland-bloom/frame-master.png`
- Create: `public/img/overlays/gift-frame/woodland-bloom/frame-top.webp`
- Create: `public/img/overlays/gift-frame/woodland-bloom/frame-right.webp`
- Create: `public/img/overlays/gift-frame/woodland-bloom/frame-bottom.webp`
- Create: `public/img/overlays/gift-frame/woodland-bloom/frame-left.webp`
- Create: `public/img/overlays/gift-frame/woodland-bloom/forest-guardian.webp`

- [ ] Generate a transparent 16:9 master frame with an empty center, continuous corner joins, and no text or watermark.
- [ ] Generate a transparent full-body forest guardian that matches the master frame palette and material language.
- [ ] Inspect alpha, composition, edge safety, character anatomy, and style consistency.
- [ ] Slice the master into four overlapping alpha-safe sides and convert runtime assets to lossless WebP.
- [ ] Verify the four slices reconstruct the frame without visible seams at 1920×1080.

## Milestone 2: Integrate the four sides and character

**Files:**

- Modify: `public/pages/overlays/gift-effects.html`
- Modify: `public/css/overlays/gift-effects.css`
- Modify: `public/js/overlays/gift-effects.js`

- [ ] Replace the simple inline frame artwork with four local image nodes while retaining stable `data-frame-part` hooks.
- [ ] Add the guardian as a separate decorative layer with a stable `data-frame-character` hook.
- [ ] Position the sides with intentional overlap and viewport-safe scaling; keep the center transparent.
- [ ] Animate each side from its corresponding direction and coordinate the guardian with the information plate.
- [ ] Preserve reduced motion, cleanup, queue timing, and safe text rendering.

## Milestone 3: Update contracts and regression coverage

**Files:**

- Modify: `test/gift-effects-overlay.test.js`
- Modify: `docs/architecture/frontend/overlays.md`
- Modify: `specs/gift-effects-frame-overlay_design.md`

- [ ] Replace inline-SVG-specific assertions with four-side local-asset, character-layer, and transparent-center assertions.
- [ ] Update the owner document and draft design specification to describe the four illustrated assets and coordinated guardian layer.
- [ ] Run `node --test test/gift-effects-overlay.test.js` and confirm it passes.
- [ ] Run `npm run check`, `npm run verify:quick`, and the relevant overlay tests.

## Milestone 4: Visual and interaction verification

- [ ] Capture the full-motion enter transition and holding state at 1920×1080.
- [ ] Capture the holding state at 2560×1440 and reduced-motion state at 1280×720.
- [ ] Dispatch a dense long-text payload and verify amount visibility and ellipsis.
- [ ] Wait for cleanup and verify the overlay returns to a transparent idle state.
- [ ] Review `git diff`, `git diff --check`, `git status --short`, and any pre-existing staged diff.

## Done When

- The forest frame visibly uses detailed coordinated artwork and a matching original character illustration.
- The runtime border is composed from four independently animated local assets with seam-safe joins.
- Stream content remains visible through the transparent center at supported 16:9 sizes.
- Existing gift-frame event, settings, queue, accessibility, and cleanup contracts still pass focused tests.
- Final screenshots pass aesthetic, clipping, layering, and readability review.
- The final diff contains only gift-frame visual work plus the plan and does not alter the user's existing opening-overlay changes.
