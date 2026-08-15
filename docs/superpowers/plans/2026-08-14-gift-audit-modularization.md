# Gift Audit Page Modularization Plan

**Goal:** Turn `public/pages/gift-audit.html` into a small page shell and separate gift analysis, rendering, and browser orchestration without changing its behavior.

**Architecture:** Keep the page URL and server-side token injection unchanged. Move styles to one page stylesheet, isolate parsing and comparison as a DOM-free ES module, isolate rendering helpers from application state, and keep WebSocket/fetch/state coordination in a small entry module.

**Tech Stack:** HTML, CSS, browser ES modules, CommonJS `node:test`, Node.js 24+

## Constraints

- Preserve the existing API and WebSocket URLs.
- Preserve all button actions and startup behavior.
- Keep user-supplied and server-supplied values HTML-escaped before rendering.
- Add no dependencies.

### Task 1: Add a failing page-boundary regression test

**Files:**
- Create: `test/gift-audit-page.test.js`

- [x] Assert that the page links a dedicated stylesheet and ES module entrypoint.
- [x] Assert that the page has no embedded style block or inline event handlers.
- [x] Run the focused test and confirm it fails before extraction.

### Task 2: Extract page styles and JavaScript modules

**Files:**
- Modify: `public/pages/gift-audit.html`
- Create: `public/css/gift-audit.css`
- Create: `public/js/gift-audit/analysis.js`
- Create: `public/js/gift-audit/view.js`
- Create: `public/js/gift-audit/index.js`

- [x] Move the style block unchanged into `gift-audit.css`.
- [x] Move parsing and matching into the DOM-free `analysis.js` module.
- [x] Move escaped DOM rendering into `view.js`.
- [x] Keep state, HTTP, WebSocket, UI events, and startup in `index.js`.
- [x] Replace inline handlers with explicit element IDs and listeners.

### Task 3: Verify behavior

**Files:**
- Modify: `test/gift-audit-page.test.js`

- [x] Add direct behavior tests for parsing and cross-reference matching.
- [x] Run `node --experimental-vm-modules --test test/gift-audit-page.test.js`.
- [x] Run `npm run check` and `npm test`.
