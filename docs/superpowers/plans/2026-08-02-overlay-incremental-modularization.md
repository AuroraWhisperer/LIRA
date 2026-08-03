# Overlay Incremental Modularization Implementation Plan

> For agentic workers: use executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Reduce duplicated overlay utility code in small, behavior-preserving steps.

**Architecture:** Keep overlay pages as regular scripts for now. Add a browser-global utility module loaded before each consumer, then migrate one overlay at a time while preserving existing function behavior and DOM contracts. Do not change WebSocket flow, API calls, rendering markup, or initialization timing in the first step.

**Tech Stack:** Plain browser JavaScript, static HTML script loading, Node.js node:test, VM-based frontend regression tests.

## Global Constraints

- Preserve existing overlay URLs, DOM ids/classes, API endpoints, and WebSocket behavior.
- Make one overlay change at a time and verify with npm run check and npm test.
- Preserve unrelated user modifications already present in the worktree.
- Use ASCII for newly added source comments and keep the existing browser-script loading model.

---

### Task 1: Extract shared overlay utility functions for the songs overlay

**Files:**
- Create: public/js/overlays/overlay-utils.js
- Modify: public/pages/overlays/songs.html
- Modify: public/js/overlays/songs.js
- Modify: test/frontend-regressions.test.js

**Interfaces:**
- Produces window.OverlayUtils with escapeHtml, hexToRgb, hexToRgba, withMultilingualFallback, scrollTravelSeconds, and overlayLowPowerEnabled.
- songs.js consumes these helpers through window.OverlayUtils; all existing local call sites keep the same argument and return-value behavior.

- [x] Step 1: Add a regression test for the shared helper contract.

  Load overlay-utils.js in a VM sandbox with a minimal window object, then assert that escaping, RGB conversion, alpha clamping, font fallback, scroll timing, and quality query handling return the existing expected values.

- [x] Step 2: Run the focused regression test and verify it fails.

  Run: node --test test/frontend-regressions.test.js --test-name-pattern="overlay utility"

  Expected: FAIL because public/js/overlays/overlay-utils.js does not exist yet.

- [x] Step 3: Implement overlay-utils.js and load it before songs.js.

  Keep the file as a regular browser script and assign the six functions to window.OverlayUtils. Add /js/overlays/overlay-utils.js immediately before /js/overlays/songs.js in songs.html.

- [x] Step 4: Replace only duplicate helper definitions in songs.js.

  Remove the six local helper implementations and call window.OverlayUtils through a local overlayUtils reference. Leave all loading, socket, sorting, rendering, and theme control flow unchanged.

- [x] Step 5: Run focused and full verification.

  Run: node --test test/frontend-regressions.test.js --test-name-pattern="overlay utility", then npm run check && npm test.

- [x] Step 6: Review the diff for unrelated changes.

  Confirm only the new utility, songs overlay script order/call sites, regression coverage, and this plan file changed. Do not commit yet; wait for the next incremental extraction review.

---

### Task 2: Migrate queue and blindbox overlays only after Task 1 passes

**Files:**
- Modify: public/pages/overlays/queue.html
- Modify: public/pages/overlays/blindbox.html
- Modify: public/js/overlays/queue.js
- Modify: public/js/overlays/blindbox.js

Move only helpers proven identical by comparison. Keep each overlay's rendering and reconnect logic local until regression coverage exists for those behaviors.

---

### Task 3: Split admin settings by behavior after overlay helpers stabilize

**Files:**
- Modify: public/js/admin/settings.js
- Create: public/js/admin/bilibili-auth.js
- Create: public/js/admin/blindbox-settings.js
- Create: public/js/admin/maintenance.js
- Modify: public/pages/admin.html

Preserve window.AdminApp.settings compatibility and keep initialization order unchanged. Add focused tests before moving each behavior group.
