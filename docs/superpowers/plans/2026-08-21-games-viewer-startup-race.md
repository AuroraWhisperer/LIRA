# Games Viewer Startup Race Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the games viewer picker from reporting an empty audience during application startup before the Bilibili online snapshot is ready.

**Architecture:** Keep the existing `/api/games/viewers` response contract and server-side viewer cache unchanged. The games admin module will coalesce concurrent refreshes, retry empty snapshots for a short bounded window, and trigger a silent refresh when the live connection transitions to connected; manual refreshes retain the existing toast behavior.

**Tech Stack:** Vanilla JavaScript ES modules, shared admin EventBus, Node.js `node:test` source-contract tests.

## Global Constraints

- Preserve the existing HTTP response shape and viewer picker behavior.
- Keep the Electron desktop flow as the primary UI target.
- Use two-space indentation, semicolons, single quotes, and minimal surgical changes.
- Do not add dependencies, timers that outlive the feature, or authentication/data changes.

---

### Task 1: Add deterministic startup refresh coordination

**Files:**
- Modify: `public/js/admin/games.js:1-55`
- Test: `test/frontend-games.test.js`

**Interfaces:**
- Consumes: `eventBus`/`Events.STATE_LOADED` and existing `/api/games/viewers` endpoint.
- Produces: `requestViewerRefresh(options)` used by initial load, live-state refresh, and the manual button.

- [x] **Step 1: Write the failing source-contract assertions**

  Assert that the games module imports the EventBus, defines bounded viewer refresh retry delays, coalesces refreshes, and refreshes on a connected live-state transition without changing the endpoint path.

- [x] **Step 2: Run the focused test to verify it fails**

  Run: `node --test test/frontend-games.test.js`

  Expected: FAIL because the current module performs one uncoordinated fetch and does not subscribe to live-state readiness.

- [x] **Step 3: Implement the minimal coordination**

  Add a bounded retry loop for empty viewer responses, a single in-flight promise so startup/live/manual triggers cannot overlap, and an EventBus listener that silently retries after `liveStatus.connected` changes from false to true or the room changes. Keep initial refreshes silent; manual refreshes continue to show the count toast.

- [x] **Step 4: Run the focused test to verify it passes**

  Run: `node --test test/frontend-games.test.js`

  Expected: PASS.

- [x] **Step 5: Run syntax and diff checks**

  Run: `npm run check` and `git diff --check`.

  Expected: PASS with only the planned frontend module, test, and plan changes.
