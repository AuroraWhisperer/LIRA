# Overlay Loopback Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use the IPv4 loopback address consistently for the local service and all generated overlay URLs.

**Architecture:** Normalize the ambiguous `localhost` input at the server startup boundary and bind to `127.0.0.1` by default. The admin page will reuse `location.origin` unchanged so copied overlay links always target that same service instance.

**Tech Stack:** Browser JavaScript, Node.js `node:test`

## Global Constraints

- Preserve the existing port and protocol from `location.origin`.
- Normalize legacy `HOST=localhost` configuration to `127.0.0.1`.
- Add no dependencies and do not change queue or WebSocket behavior.

---

### Task 1: Preserve The Bound Loopback Host

**Files:**
- Modify: `public/js/admin/display.js`
- Test: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: browser `location.origin`
- Produces: overlay URLs for `/queue`, `/songlist`, and `/lyrics`

- [x] **Step 1: Strengthen the regression test**

Assert that `display.js` does not rewrite `127.0.0.1` to `localhost`.

- [x] **Step 2: Run the focused test and verify it fails**

Run: `node --test --test-name-pattern="admin overlay links" test/frontend-regressions.test.js`

- [x] **Step 3: Implement the minimal fix**

Use `location.origin` directly when generating all overlay URLs.

- [x] **Step 4: Verify the focused and full suites**

Run: `node --test --test-name-pattern="admin overlay links" test/frontend-regressions.test.js`

Run: `npm run check && npm test`

### Task 2: Normalize Local Service Binding

**Files:**
- Modify: `src/server.js`
- Modify: `src/server/ws.js`
- Test: `test/server-smoke.test.js`

**Interfaces:**
- Consumes: `runtimeOptions.host`, `start({ host })`, and `process.env.HOST`
- Produces: a server bound to `127.0.0.1` whenever the requested host is omitted or equals `localhost`

- [x] **Step 1: Add the startup regression test**

Start an isolated runtime with `host: 'localhost'` and assert its returned host and base URL use `127.0.0.1`.

- [x] **Step 2: Run the focused test and verify it fails**

Run: `node --test --test-name-pattern="normalizes localhost" test/server-smoke.test.js`

- [x] **Step 3: Implement host normalization**

Normalize startup host selection and use `127.0.0.1` for the WebSocket request URL fallback.

- [x] **Step 4: Run the focused test and verify it passes**

Run: `node --test --test-name-pattern="normalizes localhost" test/server-smoke.test.js`
