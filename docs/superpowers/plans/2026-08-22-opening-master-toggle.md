# Opening Master Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the “显示整套特效” switch a true master control that leaves the browser source transparent and silent when off, including the editor preview.

**Architecture:** Keep the existing persisted `openingEnabled` setting and `/opening` source contract. The admin preview will navigate to `about:blank` while disabled so its iframe runtime is unloaded; the overlay will only attach an audio source when enabled and will apply a shared disabled state that hides and pauses visual layers.

**Tech Stack:** Electron renderer assets, Vanilla JavaScript ES modules, native CSS, Node.js `node:test` fixtures.

## Global Constraints

- Preserve the fixed `/opening` Browser Source URL and existing settings/API contracts.
- Keep the desktop/Electron experience as the design baseline.
- Make the smallest task-scoped edits; do not alter unrelated user changes or create commits.

---

### Task 1: Define and verify the disabled-state contract

**Files:**
- Modify: `test/opening-overlay.test.js`

**Interfaces:**
- Consumes: Existing opening overlay HTML, CSS, and admin renderer source.
- Produces: Regression assertions for transparent/silent disabled behavior.

- [x] **Step 1: Add failing assertions** for an audio element without parser-time autoplay/source, CSS transparent disabled selectors and paused disabled layers, and admin preview unloading to `about:blank`.
- [x] **Step 2: Run the focused test** with `node --test test/opening-overlay.test.js` and confirm the new assertions fail against the current implementation.

### Task 2: Make the overlay source transparent and silent when disabled

**Files:**
- Modify: `public/pages/overlays/opening.html`
- Modify: `public/js/overlays/opening.js`
- Modify: `public/css/overlays/opening.css`

**Interfaces:**
- Consumes: Persisted `openingEnabled` and existing runtime scheduler/audio helpers.
- Produces: Disabled overlay state with transparent document/body/viewport, no visible stage, cancelled visual schedulers, paused SVG/CSS animations, and no audio source or playback.

- [x] **Step 1: Remove parser-time audio playback** by leaving `#openingAudio` as a looped, metadata-preloaded element without `autoplay` or `src`.
- [x] **Step 2: Update runtime cleanup** so disabled and non-browser-audio paths pause, reset, remove the audio source, and reload the element; add `is-paused` to the disabled stage state and clear schedulers.
- [x] **Step 3: Strengthen disabled CSS** with transparent root/viewport rules and explicit animation disabling for the hidden stage.
- [x] **Step 4: Run the focused test** and confirm all opening overlay assertions pass.

### Task 3: Unload the editor preview when the switch is off

**Files:**
- Modify: `public/js/admin/start-animation.js`
- Modify: `public/css/admin/other-features/start-animation.css`
- Modify: `public/pages/admin/toolbox/start-animation.html`

**Interfaces:**
- Consumes: Existing `render()` preview lifecycle and fixed source URL.
- Produces: A clear master-control label/status and an editor iframe that is navigated to `about:blank` while disabled, then rebuilt from the opening URL when enabled.

- [x] **Step 1: Render `about:blank` on disabled state** while keeping the preview hidden and restoring the generated preview URL when enabled.
- [x] **Step 2: Clarify the switch copy/status** to state that it controls the complete animation and music set; style the disabled preview area as transparent/empty.
- [x] **Step 3: Run focused tests and `npm run check`** to verify the renderer source remains valid.

### Task 4: Run the project gates

**Files:**
- Review: `git diff --check`, affected files only.

- [x] **Step 1: Run `node --test test/opening-overlay.test.js`**.
- [x] **Step 2: Run `npm run verify:quick`**.
- [x] **Step 3: Review `git diff` and `git status --short`** to confirm only requested lines were added to already-touched files.
