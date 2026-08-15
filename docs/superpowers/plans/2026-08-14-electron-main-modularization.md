# Electron Main Modularization Plan

**Goal:** Reduce Electron main-process bootstrap size by extracting server-runtime adaptation and the local-media protocol handler.

**Architecture:** Keep application lifecycle and IPC wiring in `main.js`. Move the server API compatibility adapter into a dependency-free module and move local audio URL/range handling into a protocol module that receives its authorization predicate.

**Tech Stack:** CommonJS, Electron protocol APIs, Node.js filesystem APIs, `node:test`

## Constraints

- Preserve startup order, safeStorage injection, and shutdown behavior.
- Preserve `local-media://` validation, range responses, MIME types, and cache headers.
- Keep the local-media allowlist owned by `main.js`/`local-media-access.js`.
- Add no dependencies.

### Task 1: Add focused module tests

**Files:**
- Create: `test/electron-main-modules.test.js`

- [x] Add a legacy server-runtime adapter behavior test.
- [x] Add local-media protocol authorization and range-response tests.
- [x] Run the focused test and confirm it fails before extraction.

### Task 2: Extract runtime and protocol modules

**Files:**
- Modify: `src/electron/main.js`
- Create: `src/electron/desktop-runtime.js`
- Create: `src/electron/local-media-protocol.js`

- [x] Move `createDesktopRuntime` and runtime shape detection unchanged.
- [x] Move the `local-media://` handler unchanged behind injected authorization.
- [x] Keep small calls in `main.js` and preserve its observable source wiring.

### Task 3: Verify desktop wiring

- [x] Run the focused test plus desktop source-regression tests.
- [x] Run `npm run check` and `npm test`.
