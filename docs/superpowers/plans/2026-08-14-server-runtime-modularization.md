# Server Runtime Modularization Plan

**Goal:** Reduce `src/server.js` to runtime orchestration by extracting API context assembly, Bilibili event bridging, settings bootstrap, and legacy compatibility wrappers.

**Architecture:** Keep database/service ownership, HTTP server lifecycle, startup, and shutdown in `createServerRuntime`. Move stateless or adapter-heavy construction into focused CommonJS modules with explicit dependency objects and no hidden global state.

**Tech Stack:** CommonJS, Node.js HTTP, `node:test`, existing server/domain modules

## Constraints

- Preserve `createServerRuntime` and every compatibility export.
- Preserve startup migration order, forced Bilibili reconnect behavior, and shutdown order.
- Preserve API context shape and all route capabilities.
- Preserve gift logging and Bilibili message behavior.
- Add no dependencies.

### Task 1: Lock extracted adapter boundaries

**Files:**
- Create: `test/server-modules.test.js`
- Modify: source-regression tests that inspect Bilibili wiring

- [x] Test legacy compatibility wrappers with an injected runtime factory.
- [x] Test API context construction with explicit dependencies.
- [x] Run the focused tests and confirm they fail before extraction.

### Task 2: Extract focused server modules

**Files:**
- Modify: `src/server.js`
- Create: `src/server/api-context.js`
- Create: `src/server/bilibili-client.js`
- Create: `src/server/settings-bootstrap.js`
- Create: `src/server/compatibility-runtime.js`

- [x] Move route-context object construction without changing its shape.
- [x] Move Bilibili client event callbacks behind an explicit context object.
- [x] Move settings version reads and migrations while preserving invocation order.
- [x] Move singleton compatibility wrappers while preserving exports.

### Task 3: Verify runtime behavior

- [x] Run server module, smoke, Bilibili wiring, overtime, and WeSing route tests.
- [x] Run `npm run check` and `npm test`.
