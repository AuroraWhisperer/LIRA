# Fixed Service Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the local service on port 3000 and prevent a stale instance from causing the UI to use another port or data source.

**Architecture:** Treat port 3000 as the single service endpoint. Startup identifies this application with a stable health `serviceId`, clears only a matching occupant, then binds exactly that port. A port collision that cannot be safely cleared is a startup error, never a silent fallback.

**Tech Stack:** Node.js 24, Electron, built-in `node:http`, `node:test`.

## Global Constraints

- Keep the local service bound to `127.0.0.1`/`localhost`; do not expose it on a network interface.
- Do not add dependencies.
- Use two-space indentation, semicolons, and CommonJS.
- Run `npm run check && npm test` before submitting.

---

### Task 1: Make port cleanup target the requested port

**Files:**
- Modify: `src/server/lifecycle.js:46-90`
- Test: `test/server-lifecycle.test.js`

**Interfaces:**
- Consumes: `cleanupOwnPortOccupant({ port, host, rootDir, dataDir, ... })`.
- Produces: cleanup of the service bound to `options.port`; a non-matching runtime record cannot redirect cleanup to another port.

- [x] **Step 1: Write the failing regression test**

```js
lifecycle.writeRuntimeInfo(dataDir, { pid: 2002, port: 3001, host: 'localhost' });
await lifecycle.cleanupOwnPortOccupant(cleanupOptions(dataDir, fetchImpl, async () => true));
assert.match(requests[0].url, /localhost:3000\/api\/health$/);
```

- [x] **Step 2: Run the focused test to verify it fails**

Run: `node --test test/server-lifecycle.test.js`

Expected: the existing implementation requests `3001`, exposing the stale-runtime redirection defect.

- [x] **Step 3: Write minimal implementation**

```js
const port = Number(options.port);
const runtimeForPort = runtime && Number(runtime.port) === port ? runtime : null;
const pid = healthIsOwn
  ? Number(health.data && health.data.pid)
  : Number(runtimeForPort && runtimeForPort.pid);
```

- [x] **Step 4: Run the focused test to verify it passes**

Run: `node --test test/server-lifecycle.test.js`

Expected: PASS.

The regression suite also covers matching the same application across different data directories and leaving an unrelated service untouched.

### Task 2: Require port 3000 at application startup

**Files:**
- Modify: `src/server/lifecycle.js:12-28`
- Modify: `src/server.js:256-286`
- Modify: `src/electron/main.js:115-119`
- Test: `test/server-lifecycle.test.js`

**Interfaces:**
- Consumes: `listenExactly(server, { port, host })`.
- Produces: a Promise resolving to `port` only when that exact port binds; otherwise it rejects with the original listen error.

- [x] **Step 1: Write the failing regression test**

```js
const first = http.createServer((_req, res) => res.end('first'));
await new Promise((resolve) => first.listen(0, '127.0.0.1', resolve));
const second = http.createServer();
await assert.rejects(
  lifecycle.listenExactly(second, { port: first.address().port, host: '127.0.0.1' }),
  { code: 'EADDRINUSE' }
);
```

- [x] **Step 2: Run the focused test to verify it fails**

Run: `node --test test/server-lifecycle.test.js`

Expected: FAIL because `listenExactly` does not exist.

- [x] **Step 3: Write minimal implementation**

```js
function listenExactly(server, options) {
  return new Promise((resolve, reject) => {
    const onError = (error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(Number(options.port)); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(Number(options.port), options.host);
  });
}
```

Replace the `listenWithFallback` call in `startServer` with `listenExactly`, and pass `3000` explicitly from Electron instead of honoring `PORT`.

- [x] **Step 4: Run the focused test to verify it passes**

Run: `node --test test/server-lifecycle.test.js`

Expected: PASS.

### Task 3: Verify the full suite

**Files:**
- Test: `test/server-lifecycle.test.js`

- [x] **Step 1: Run syntax checks**

Run: `npm run check`

Expected: PASS.

- [x] **Step 2: Run the complete test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/server/lifecycle.js src/server.js test/server-lifecycle.test.js docs/superpowers/plans/2026-08-02-fixed-service-port.md
git commit -m "fix: keep local service on port 3000"
```

## Self-Review

- Spec coverage: Tasks 1 and 2 prevent stale runtime records from redirecting cleanup and remove automatic fallback ports. Task 3 verifies both behavior and project checks.
- Placeholder scan: no placeholders remain.
- Type consistency: `listenExactly(server, { port, host })` is exported from `lifecycle.js` and called by `startServer` with the existing lifecycle options.
