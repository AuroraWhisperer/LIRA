# Opening Overlay Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the opening overlay so its heart follows the waveform, its 16:9 composition stays fixed at every host aspect ratio, long titles remain on one line, the broadcaster name is optional, browser audio is enabled by default, and the Toolbox editor fits the Electron workspace.

**Architecture:** Keep `/opening` as a static Browser Source. Use the SVG waveform as the single motion path, a CSS/SMIL cycle for the heart, container-relative sizing for the fixed 16:9 stage, and URL parameters for all editor state. Keep the admin editor stateless and make its panel use the existing scroll-owning Toolbox body contract.

**Tech Stack:** Vanilla JavaScript ES modules, native CSS, inline SVG, `node:test`.

## Global Constraints

- Preserve the modular monolith and existing `/opening` route.
- Do not add a framework, build step, backend setting, WebSocket message, runtime dependency, or third-party music download.
- Render URL text only through `textContent` and retain the existing length limits.
- Keep reduced-motion and page-visibility pausing intact.
- Use the user-visible default title `唱一首，在一首，给你的歌`; use an empty broadcaster name without an `@` prefix.
- Default to browser audio at `/img/overlays/opening/music.ogg`; the user must provide an authorized recording of `果实` at that path because no audio asset is present in the workspace.

---

### Task 1: Lock the waveform and responsive contracts in tests

**Files:**

- Modify: `test/opening-overlay.test.js`

**Interfaces:**

- Consumes: current `/opening` HTML, CSS, and JS source.
- Produces: assertions for SVG motion-path heart, 16:9 container sizing, title count/scaling, empty name, browser audio, and Toolbox scrolling.

- [ ] Add assertions for `openingTrackPath`, `animateMotion`, no fixed right-positioned heart, `container-type: size`, `cqw`, `white-space: nowrap`, `openingTitleCount`, empty `name`, no `@`, `audio=browser`, and `other-feature-panel-body`.
- [ ] Run `node --test test/opening-overlay.test.js` and confirm the new assertions fail before implementation.

### Task 2: Refine overlay motion and layout

**Files:**

- Modify: `public/pages/overlays/opening.html`
- Modify: `public/css/overlays/opening.css`
- Modify: `public/js/overlays/opening.js`

**Interfaces:**

- Consumes: `title`, `name`, and `audio` URL parameters.
- Produces: `titleSizeForLength(length): number`, a centered 16:9 stage, an SVG heart that travels from path start to end, and an optional hidden name row.

- [ ] Replace the terminal heart span with nested SVG heart groups and `animateMotion` linked to `#openingTrackPath`.
- [ ] Make the stage width `min(100vw, calc(100dvh * 16 / 9))`, center it, declare `container-type: size`, and replace viewport-relative inner sizes with container units.
- [ ] Add `titleSizeForLength()` and set `--opening-title-size` from the sanitized title length while keeping the title on one line.
- [ ] Change defaults to title `唱一首，在一首，给你的歌`, empty name, and `audio: 'browser'`; hide the name row when empty and never render `@`.
- [ ] Pause/unpause SVG animation together with existing visibility and reduced-motion behavior.

### Task 3: Compact the Toolbox editor

**Files:**

- Modify: `public/pages/admin/toolbox/start-animation.html`
- Modify: `public/css/admin/other-features/start-animation.css`
- Modify: `public/js/admin/start-animation.js`

**Interfaces:**

- Consumes: editor inputs and `localOverlayOrigin(location)`.
- Produces: compact scroll-safe editor, `openingTitleCount`, and URLs with `audio=browser`.

- [ ] Add `other-feature-panel-body` to the panel body, set the new default title, clear the name input, and add an accessible `0/40` title counter.
- [ ] Update the counter on every render and generate `name=` without fallback text plus `audio=browser`.
- [ ] Reduce vertical gaps/control height, keep the preview at `aspect-ratio: 16 / 9`, and retain scrolling as the fallback for short windows.

### Task 4: Verify the refinement

**Files:**

- Test: `test/opening-overlay.test.js`

**Interfaces:**

- Consumes: Tasks 1–3.
- Produces: verified behavior without unrelated file changes.

- [ ] Run `node --test test/opening-overlay.test.js` and the relevant admin composition tests.
- [ ] Run `npm run check`, `npm run verify:architecture`, and `npm test`.
- [ ] Review `git diff --check`, the task-scoped diff, and `git status --short`.
