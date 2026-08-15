# WeSing Capture Modularization Plan

**Goal:** Replace the 961-line WeSing capture module with a compatibility facade over focused cache, capture-engine, and Windows monitor modules.

**Architecture:** Keep all current exports available from `wesing-capture.js`. Isolate filesystem/QRC discovery, capture state-machine coordination, and PowerShell/native monitoring into separate CommonJS modules with one-way dependencies.

**Tech Stack:** CommonJS, Node.js filesystem/process APIs, PowerShell source generation, `node:test`

## Constraints

- Preserve every export from `wesing-capture.js`.
- Preserve capture timing constants and state transitions exactly.
- Preserve cache path validation and QRC security limits.
- Preserve generated PowerShell source byte-for-byte apart from module location.
- Add no dependencies.

### Task 1: Lock the facade boundary

**Files:**
- Modify: `test/wesing-capture.test.js`

- [x] Assert that facade exports are the same functions exported by focused modules.
- [x] Run the focused assertion and confirm it fails before extraction.

### Task 2: Extract focused modules

**Files:**
- Modify: `src/music/wesing-capture.js`
- Create: `src/music/wesing-cache.js`
- Create: `src/music/wesing-capture-engine.js`
- Create: `src/music/wesing-monitor.js`

- [x] Move path/log/QRC parsing into `wesing-cache.js`.
- [x] Move the capture state machine into `wesing-capture-engine.js`.
- [x] Move process control and PowerShell generation into `wesing-monitor.js`.
- [x] Replace `wesing-capture.js` with a compatibility export facade.

### Task 3: Verify all timing and cache behavior

- [x] Run all `test/wesing-capture*.test.js` files.
- [x] Run `npm run check` and `npm test`.
