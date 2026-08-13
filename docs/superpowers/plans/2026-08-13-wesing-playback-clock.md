# WeSing Playback Clock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep WeSing lyrics advancing when UI Automation temporarily cannot read progress, while preserving pause detection and resynchronizing to valid progress samples.

**Architecture:** Treat UI Automation progress as an optional calibration sample instead of the playback clock itself. A monotonic in-process clock advances between samples, freezes only after a confirmed pause, resets on track changes, and accepts backward calibration for replay or seeking. The existing lyric-state and browser animation contracts remain unchanged.

**Tech Stack:** Node.js 24 CommonJS, Windows UI Automation through PowerShell, `node:test`.

## Global Constraints

- Do not add dependencies or change the WebSocket/API payload shape.
- Preserve existing local-QRC and online-lyric resolution behavior.
- Keep changes limited to WeSing capture timing and its regression tests.

---

### Task 1: Capture timing regressions

**Files:**
- Test: `test/wesing-capture.test.js`

**Interfaces:**
- Consumes: `createWeSingCapture({ now, monitorFactory })` and monitor samples with `currentSec`/`totalSec`.
- Produces: regression coverage for unavailable progress, recovery, pause, and backward calibration.

- [x] Add a controlled clock fixture that sends `currentSec: -1` while a titled WeSing window remains detected.
- [x] Assert that unavailable progress does not reset `currentMs` or set `playing` to false.
- [x] Assert that the next valid sample recalibrates the clock.
- [x] Assert that repeated valid seconds still confirm a real pause after 1500 ms.
- [x] Assert that a lower valid second recalibrates backward for replay/seek.
- [x] Run `node --test test/wesing-capture.test.js` and confirm the unavailable-progress assertions fail before implementation.

### Task 2: Monotonic capture clock

**Files:**
- Modify: `src/music/wesing-capture.js:195-347`
- Test: `test/wesing-capture.test.js`

**Interfaces:**
- Consumes: optional non-negative UIA progress samples and `now()` timestamps.
- Produces: the existing `state.currentMs` and `state.playing` fields with continuous timing semantics.

- [x] Add private clock state: base milliseconds, anchor timestamp, and running flag.
- [x] Add helpers to read, set, start, pause, and reset the monotonic clock.
- [x] Parse negative/non-finite progress as unavailable rather than zero.
- [x] On a valid changed second, set the clock to the observed value and run it.
- [x] On a repeated valid second for more than 1500 ms, pause the clock at its estimated position.
- [x] While progress is unavailable, preserve the last play/pause state and use the monotonic estimate.
- [x] On title changes, reset timing; when a title exists but its first progress is unavailable, optimistically start from zero as Now Playing does.
- [x] Run `node --test test/wesing-capture.test.js` and confirm all timing cases pass.

### Task 3: Repository verification

**Files:**
- No additional product files.

- [x] Run `npm run check`.
- [x] Run `npm test`.
- [x] Run `git diff --check` and inspect `git status --short`.

## Self-Review

- The plan covers UIA loss, recovery, pause, replay/seek, and track reset.
- Existing transport and frontend interpolation remain intact.
- No placeholders, new dependencies, or unrelated refactors are included.
