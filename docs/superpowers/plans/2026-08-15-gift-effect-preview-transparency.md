# Gift Effect Preview Transparency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show transparent gift-effect regions against the existing debug checkerboard in the toolbox preview while keeping the copied OBS URL fully transparent.

**Architecture:** Keep `/gift-effects` as the canonical transparent overlay URL. Only the toolbox “打开固定预览” action derives `/gift-effects?debug=1`; the overlay already maps that query parameter to its checkerboard preview backdrop, so video masking and live playback remain unchanged.

**Tech Stack:** Browser JavaScript, existing overlay CSS debug state, Node.js `node:test` source assertions

## Global Constraints

- Do not change packed-alpha or black-background frame compositing.
- Do not add query parameters to the copied/live OBS URL.
- Do not add dependencies.

---

### Task 1: Separate preview and live overlay URLs

**Files:**
- Modify: `test/gift-effects-overlay.test.js`
- Modify: `public/js/admin/gift-effects.js`

**Interfaces:**
- Consumes: `liveUrl`, the canonical `${localOverlayOrigin(location)}/gift-effects` URL; the overlay's existing `debug=1` query behavior.
- Produces: `previewUrl`, a derived URL used only by `window.open`; clipboard and displayed live URLs continue using `liveUrl`.

- [ ] **Step 1: Write the failing test**

Replace the old `window.open(liveUrl, ...)` assertion with source assertions that require a derived URL and verify that only it is opened:

```js
assert.match(toolSource, /const previewUrl = new URL\(liveUrl\)/);
assert.match(toolSource, /previewUrl\.searchParams\.set\('debug', '1'\)/);
assert.match(toolSource, /window\.open\(previewUrl\.toString\(\), 'liraGiftEffectPreview'\)/);
assert.match(toolSource, /navigator\.clipboard\.writeText\(liveUrl\)/);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/gift-effects-overlay.test.js`

Expected: FAIL because `previewUrl` is not yet defined.

- [ ] **Step 3: Write the minimal implementation**

Derive the preview URL once during initialization, preserving `liveUrl` for display and clipboard use:

```js
const liveUrl = `${localOverlayOrigin(location)}/gift-effects`;
const previewUrl = new URL(liveUrl);
previewUrl.searchParams.set('debug', '1');
```

Open only the derived preview URL:

```js
window.open(previewUrl.toString(), 'liraGiftEffectPreview');
```

- [ ] **Step 4: Run verification**

Run: `node --test test/gift-effects-overlay.test.js`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

- [ ] **Step 5: Review the diff**

Confirm the product diff changes only the preview URL construction and its regression assertions; no overlay compositing code changes.
