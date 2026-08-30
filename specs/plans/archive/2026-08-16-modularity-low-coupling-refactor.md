# Modularity and Low-Coupling Refactor Implementation Plan

> Status: Done
> Archived: 2026-08-16

**Goal:** Enforce explicit dependency boundaries while preserving all current LIRA behavior and external contracts.

**Architecture:** Keep the modular monolith and introduce narrow adapters at existing change boundaries. Refactor one subsystem at a time, add architecture fitness tests before implementation, and retain only the minimum compatibility bridge required by legacy Admin modules.

**Tech Stack:** Node.js 24+, CommonJS backend, Vanilla JavaScript ES modules, `node:sqlite`, `node:test`.

## Global Constraints

- Preserve HTTP, WebSocket, IPC, SQLite schema, page URLs, and persisted payload contracts.
- Add no runtime dependency, process, port, framework, or build step.
- Do not revert or reformat unrelated working-tree changes.
- Do not create commits automatically in the current dirty worktree; each task ends with an independently reviewable test gate.
- Follow `docs/architecture/engineering/modularity-standard.md`.

---

### Task 1: Architecture Fitness Tests

**Files:**

- Create: `test/module-boundaries.test.js`
- Modify: `docs/architecture/engineering/test.md`

**Interfaces:**

- Consumes: repository source files as UTF-8 text.
- Produces: structural assertions for the five migration boundaries.

- [ ] **Step 1: Write failing structural tests**

Assert that `queue-service.js` and `superchat-service.js` contain no `.prepare(` or `.exec(`, `admin/app.js` contains no `window.AdminApp`, `playback/controller.js` contains no `sharedDeps` or forward-declaration cycle comment, and `shared/utils.js` exports no ZIP/XLSX helpers.

- [ ] **Step 2: Run the test and verify failure**

Run: `node --test test/module-boundaries.test.js`

Expected: FAIL on all currently violated boundaries.

- [ ] **Step 3: Keep the test red while implementing Tasks 2-5**

Run the test after each task; only assertions owned by that task should turn green.

### Task 2: Split Spreadsheet and ZIP Utilities

**Files:**

- Create: `src/shared/xlsx-codec.js`
- Modify: `src/shared/utils.js`
- Modify: `src/music/song-file-codec.js`
- Modify: `test/song-file-codec.test.js`

**Interfaces:**

- Produces: `createZip(entries)`, `readZipFiles(buffer)`, `columnName(index)`, `parseSharedStrings(xml)`, `parseWorksheetXml(xml, sharedStrings)`, and `escapeXml(value)` from `xlsx-codec.js`.
- Consumes: `cleanText` from `shared/utils.js` for worksheet row filtering.

- [ ] **Step 1: Update codec tests to import ZIP helpers from `xlsx-codec.js`**
- [ ] **Step 2: Run `node --test test/song-file-codec.test.js` and verify module-not-found/export failure**
- [ ] **Step 3: Move only ZIP/XML/XLSX functions and their constants into `xlsx-codec.js`**
- [ ] **Step 4: Update `song-file-codec.js` imports and remove the old exports from `utils.js`**
- [ ] **Step 5: Run `node --test test/song-file-codec.test.js test/module-boundaries.test.js`**

Expected: spreadsheet behavior passes and the shared-utils boundary assertion is green.

### Task 3: Introduce Queue and SuperChat Stores

**Files:**

- Create: `src/storage/queue-store.js`
- Create: `src/storage/superchat-store.js`
- Modify: `src/music/queue-service.js`
- Modify: `src/bilibili/superchat-service.js`
- Modify: `src/server/domain-services.js`
- Modify: `test/queue-service.test.js`
- Create: `test/superchat-store.test.js`

**Interfaces:**

- `createQueueStore(songDb)` produces `countActive()`, `findActiveBySongName(name)`, `insertRequest(input)`, `completeNext(updatedAt)`, `clearActive(updatedAt)`, `setPinned(id, pinned, updatedAt)`, `setStatus(id, status, updatedAt)`, `listActive()`, and `normalizeCurrentToWaiting(updatedAt)`.
- `createSuperChatStore(superChatDb)` produces `findByPlatformId(id)`, `insert(input)`, `setStatus(id, status, updatedAt)`, and `listActive()`.
- Services consume `{ store, settings, defaults, findSong }` rather than `{ db, settingsStore }`.

- [ ] **Step 1: Rewrite queue atomicity test against `createQueueStore` and add a fake-store service test**
- [ ] **Step 2: Add SuperChat store persistence tests**
- [ ] **Step 3: Run the target tests and verify missing store failures**
- [ ] **Step 4: Move SQL and transactions into the two stores**
- [ ] **Step 5: Inject stores from `domain-services.js` and remove raw DB access from services**
- [ ] **Step 6: Run `node --test test/queue-service.test.js test/superchat-store.test.js test/module-boundaries.test.js`**

Expected: service modules contain no SQLite calls and database atomicity remains covered.

### Task 4: Narrow Playback Controller Dependencies

**Files:**

- Modify: `public/js/playback/controller.js`
- Modify: `test/playback-queue-behavior.test.js`
- Modify: `test/playback-quality.test.js`

**Interfaces:**

- Controller-local named callback functions provide `renderPlayback`, `playPlaybackTrack`, and `ensurePlaybackRadioQueueFilled` without mutable forward declarations.
- Each `create*` factory receives an object containing only fields destructured by that factory.

- [ ] **Step 1: Add structural assertions for the removed `sharedDeps` and cycle comments**
- [ ] **Step 2: Run `node --test test/module-boundaries.test.js` and verify playback assertions fail**
- [ ] **Step 3: Replace mutable forward declarations with named callback ports that delegate to initialized modules**
- [ ] **Step 4: Replace every `...sharedDeps` call with an explicit dependency object**
- [ ] **Step 5: Run playback queue, quality, provider, persistence, and WeSing tests**

Expected: no fat dependency bag remains and all playback behavior is unchanged.

### Task 5: Isolate Admin Legacy Globals

**Files:**

- Create: `public/js/admin/legacy-admin-bridge.js`
- Modify: `public/js/admin/app.js`
- Modify: `public/js/admin/index.js`
- Modify: `test/frontend-admin-shell.test.js`

**Interfaces:**

- `getLegacyAdminModules()` returns the current `window.AdminApp` facade.
- `publishNavigation(navigation)` is the only application-entry write to the legacy global.
- New Admin code imports explicit ESM services; only the bridge touches `window.AdminApp` for compatibility.

- [ ] **Step 1: Update Admin tests to require the bridge boundary and forbid direct `window.AdminApp` access in `app.js`**
- [ ] **Step 2: Run Admin and module-boundary tests and verify failure**
- [ ] **Step 3: Add the bridge and route all legacy module reads/writes through it**
- [ ] **Step 4: Remove the unused DI container registration and debug exposure from `app.js`**
- [ ] **Step 5: Run `node --experimental-vm-modules --test test/frontend-admin-shell.test.js test/esm-module-boundaries.test.js test/module-boundaries.test.js`**

Expected: Admin behavior stays compatible while global access has one named boundary.

### Task 6: Reduce Composition-Root Responsibilities

**Files:**

- Create: `src/server/bilibili-runtime.js`
- Modify: `src/server.js`
- Create: `src/electron/desktop-state.js`
- Modify: `src/electron/main.js`
- Modify: `test/server-modules.test.js`
- Modify: `test/electron-main-modules.test.js`

**Interfaces:**

- `createBilibiliRuntime(options)` owns auth cache, live status, client replacement serialization, reconnect, status publication, and stop.
- `createDesktopState()` owns mutable desktop references and exposes explicit getters/setters used by startup and IPC registration.

- [ ] **Step 1: Add isolated runtime/state tests**
- [ ] **Step 2: Run the tests and verify missing factory failures**
- [ ] **Step 3: Extract Bilibili lifecycle behavior without changing client callbacks or status payloads**
- [ ] **Step 4: Replace Electron module-level mutable fields with the desktop state object**
- [ ] **Step 5: Run server lifecycle, smoke, startup wiring, Electron module, and IPC tests**

Expected: entrypoints retain wiring and lifecycle ownership while domain-specific mutable behavior lives in focused modules.

### Task 7: Documentation and Full Verification

**Files:**

- Modify: `docs/architecture/README.md`
- Modify: `docs/architecture/backend/server-core.md`
- Modify: `docs/architecture/frontend/app.md`
- Modify: `docs/architecture/frontend/playback.md`
- Modify: `docs/architecture/engineering/test.md`

**Interfaces:**

- Consumes: final source structure and test names.
- Produces: accurate architecture navigation and boundary documentation.

- [ ] **Step 1: Update module maps and ADR navigation**
- [ ] **Step 2: Run `npm run check`**
- [ ] **Step 3: Run `npm test`**
- [ ] **Step 4: Run `git diff --check` and inspect `git diff --stat`**

Expected: syntax check passes, all tests pass, and the diff contains only requested architecture work plus pre-existing user changes.
