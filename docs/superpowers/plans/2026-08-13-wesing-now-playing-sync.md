# WeSing Now Playing Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match Now Playing's WeSing progress calibration and pause behavior so lyrics use the same clock semantics.

**Architecture:** Keep the existing UI Automation and lyric-state pipeline, but align its timing constants and calibration rules with Widdit/now-playing-service and now-playing-frontend. The capture clock remains continuous between integer-second samples, freezes when the mature 1.5-second pause detector confirms a pause, and applies Now Playing's 130 ms progress compensation.

**Tech Stack:** Node.js 24 CommonJS, Windows UI Automation through PowerShell, browser ES modules, `node:test`.

## Global Constraints

- Do not add dependencies or change HTTP/WebSocket routes.
- Preserve local-QRC and online-lyric resolution behavior.
- Keep changes limited to WeSing timing and its regression tests.

---

### Task 1: Now Playing timing regressions

**Files:**
- Modify: `test/wesing-capture.test.js`

**Interfaces:**
- Consumes: `createWeSingCapture({ now, monitorFactory })` and monitor samples containing `currentSec`/`totalSec`.
- Produces: regression coverage for compensated calibration and pause freezing.

- [x] **Step 1: Update the valid-sample assertions**

```js
assert.equal(capture.getStatus().currentMs, 2130);
assert.equal(capture.getStatus().playing, true);
```

- [x] **Step 2: Assert a confirmed pause freezes the interpolated position**

```js
assert.equal(pausedAt, 11730);
assert.equal(capture.getStatus().playing, false);
```

- [x] **Step 3: Run the focused test and verify it fails before implementation**

Run: `node --test test/wesing-capture.test.js`
Expected: FAIL because the current implementation has no 130 ms compensation and rewinds a confirmed pause to the integer sample.

### Task 2: Align capture timing with Now Playing

**Files:**
- Modify: `src/music/wesing-capture.js:14-15`
- Modify: `src/music/wesing-capture.js:376-385`
- Modify: `src/music/wesing-capture.js:652`
- Test: `test/wesing-capture.test.js`

**Interfaces:**
- Consumes: integer-second UI Automation samples.
- Produces: compensated `currentMs` and authoritative `playing` state in the existing `lyricState` payload.

- [x] **Step 1: Add Now Playing's progress compensation**

```js
const PROGRESS_COMPENSATION_MS = 130;
```

- [x] **Step 2: Calibrate changed samples with compensation**

```js
setPlaybackClock(sampledCurrentMs + PROGRESS_COMPENSATION_MS, timestamp);
```

- [x] **Step 3: Freeze the interpolated clock on confirmed pause**

```js
pausePlaybackClock(timestamp);
state.playing = false;
```

- [x] **Step 4: Use Now Playing's 100 ms polling interval**

```powershell
Start-Sleep -Milliseconds 100
```

- [x] **Step 5: Run the focused test and verify it passes**

Run: `node --test test/wesing-capture.test.js`
Expected: PASS.

### Task 3: Repository verification

**Files:**
- No additional product files.

- [x] **Step 1: Run static JavaScript validation**

Run: `npm run check`
Expected: PASS.

- [x] **Step 2: Run the complete test suite**

Run: `npm test`
Expected: PASS.

- [x] **Step 3: Inspect the final diff**

Run: `git diff --check` and `git status --short`.
Expected: no whitespace errors and only the planned files changed.

## Self-Review

- The plan covers Now Playing's 100 ms polling, 130 ms compensation, integer-second calibration, and pause freeze.
- Existing lyric transport, lyric parsing, and provider behavior remain unchanged.
- No placeholders, new dependencies, or unrelated refactors are included.
