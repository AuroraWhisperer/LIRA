# WeSing Capture Test Ownership Plan

## Goal

Split the 817-line WeSing capture test into facade/cache parsing, capture timing, and monitor/lyric refresh suites while preserving all 17 tests and the capture facade integration.

## Current Behavior / Ownership

- One file mixes focused module exports, UTF-16LE log/QRC decoding, cache directory creation, progress and pause timing, reload/error calibration, online fallback, monitor script, late QRC refresh, and lyric offset behavior.
- The focused baseline passes 17/17.
- The existing cache fixture creates a fresh temporary WeSing directory and encrypted QRC per call.

## Compatibility Constraints / Non-goals

- Move complete tests without changing logs, encrypted payloads, measured times, pause/reload states, fallback, or offset assertions.
- Extract only the existing QRC/cache fixture for genuine reuse; every test keeps its own temporary directory.
- Preserve the facade export test and full capture-engine integration scenarios.
- Do not modify the completed Batch B diagnostic/capture implementation or C/D work.

## Milestones

- [x] Keep facade exports, local log/QRC parsing, safe song IDs, and cache-directory setup in `wesing-capture.test.js`.
- [x] Move activation, progress gating, delayed refresh, pause, seek calibration, reload, and monitor-error timing to `wesing-capture-timing.test.js`.
- [x] Move online fallback, monitor cadence/window detection, late QRC, and lyric offset behavior to `wesing-capture-refresh.test.js`.
- [x] Share only the existing temporary QRC/cache constructor through `helpers/wesing-capture-fixture.js`.
- [x] Remove the obsolete legacy-size record and verify exact test ownership, 17 focused tests, syntax, architecture, modularity, formatting, and diff checks.

## Results

- The 17 tests now live in facade/cache, timing, and refresh suites of 121, 433, and 247 lines plus a 46-line isolated fixture; focused execution passed 17/17 and the exact test-name multiset is unchanged.
- The obsolete size allowance was removed. Final Batch A gates passed: full `npm test`, `npm run test:admin` (83/83), `npm run check`, `npm run verify:architecture` (22/22), `npm run verify:modularity` (900 files, 25 reviewed-size files, 0 errors), `npm run verify:docs` (5/5), Prettier, and `git diff --check`.

## Done When

All 17 tests remain present and passing exactly once, temporary cache state remains isolated, every file is below 800 lines, and the old 817-line allowance is removed.
