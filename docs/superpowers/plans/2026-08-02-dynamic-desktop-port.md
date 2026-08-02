# Dynamic Desktop Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Electron desktop app bind to an OS-selected free local port on every launch and ensure all overlay links use that actual port.

**Architecture:** Keep the standalone server's configured-port behavior unchanged. Desktop startup prefers port `3000`, cleans up a recorded previous instance before binding, and falls back through the existing port range only when needed. Derive every admin overlay URL from `location.origin` rather than a hard-coded placeholder.

**Tech Stack:** Node.js `http.Server`, Electron, vanilla browser JavaScript, Node test runner.

## Global Constraints

- The desktop EXE prefers port `3000`; it only falls back when that port remains occupied after stale-instance cleanup.
- Overlay URLs must use the bound host and port returned by the current page.

### Task 1: Dynamic Port Binding

**Files:**
- Modify: `src/server/lifecycle.js`
- Modify: `src/server.js`
- Modify: `src/electron/main.js`
- Test: `test/server-lifecycle.test.js`

- [x] Add a `startPort === 0` branch that calls `server.listen(0, host)` and returns the assigned port.
- [x] Pass `startPort: 3000` from Electron unless an explicit `PORT` environment variable is set.
- [x] Add a lifecycle test asserting the returned port is positive and not the requested sentinel `0`.
- [x] Run the lifecycle test and existing server smoke test.

### Task 2: Remove Fixed Overlay Placeholder

**Files:**
- Modify: `public/admin.html`
- Modify: `public/js/admin/display.js`
- Test: `test/frontend-regressions.test.js`

- [x] Replace the blindbox URL placeholder with an empty code element.
- [x] Generate queue, songs, and blindbox URLs from the current page origin/host so the runtime port is preserved.
- [x] Add a regression assertion that no overlay URL builder contains `localhost:3000`.
- [x] Run frontend regression tests and the full test suite.
