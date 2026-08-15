# Queue Overlay Modularization Plan

**Goal:** Split the 953-line queue overlay controller into a small entrypoint plus rendering, scrolling, and pure utility modules.

**Architecture:** Convert the existing body-end script to a browser ES module. Keep network/state orchestration in `queue.js`, DOM markup/theme generation in `queue-render.js`, animation/layout mechanics in `queue-scroll.js`, and stateless calculations/escaping in `queue-utils.js`.

**Tech Stack:** Browser ES modules, DOM/WebSocket APIs, CommonJS `node:test`, VM source regression tests

## Constraints

- Preserve the queue page URL and WebSocket/API behavior.
- Preserve all generated markup, CSS variables, timing math, and escaping.
- Keep DOMContentLoaded startup behavior unchanged.
- Add no dependencies.

### Task 1: Lock module loading and source-test compatibility

**Files:**
- Modify: `test/queue-overlay-responsive.test.js`
- Modify: `test/frontend-regressions.test.js`
- Create: `test/helpers/js-module-bundle.js`

- [x] Assert the page loads `queue.js` as a module and the entry imports focused modules.
- [x] Run the focused assertion and confirm it fails before extraction.
- [x] Make existing source/VM assertions read the complete local module graph.

### Task 2: Extract queue responsibilities

**Files:**
- Modify: `public/pages/overlays/queue.html`
- Modify: `public/js/overlays/queue.js`
- Create: `public/js/overlays/queue-render.js`
- Create: `public/js/overlays/queue-scroll.js`
- Create: `public/js/overlays/queue-utils.js`

- [x] Move pure formatting and timing functions into `queue-utils.js`.
- [x] Move layout and animation functions into `queue-scroll.js`.
- [x] Move markup and theme rendering into `queue-render.js`.
- [x] Keep state loading, WebSocket refresh, resize, and top-level render selection in `queue.js`.

### Task 3: Verify overlay behavior

- [x] Run queue responsive and frontend regression tests.
- [x] Run `npm run check` and `npm test`.
