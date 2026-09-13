# Frontend Admin AI Test Ownership Plan

## Goal

Split the 1,430-line admin AI test into shared admin controls, danmaku UI, AI autosave, and secret-handling suites while preserving all 12 tests and explicit `test:admin` discovery.

## Current Behavior / Ownership

- The original file mixes general parameter constraints, danmaku connection/sender behavior, a large autosave fixture, and secret masking/submission behavior.
- The focused baseline passes 12/12.
- `test:admin` explicitly lists this file and must list every extracted suite.

## Compatibility Constraints / Non-goals

- Move complete tests with unchanged assertions and keep large per-test fixtures isolated.
- Keep general number/range/form behavior in the original file; do not create shared mutable mock state.
- Do not change AI, danmaku, server, CSS, HTML, settings, or B/C/D implementation.
- Preserve existing module-bundle and VM execution semantics.

## Milestones

- [x] Keep shared AI number limits, module entry, parameter range, and edit-state contracts in `frontend-admin-ai.test.js`.
- [x] Move danmaku markup, status, login refresh, connection state, and assistant placement to `frontend-admin-danmaku.test.js`.
- [x] Move AI autosave behavior to `frontend-admin-ai-autosave.test.js`.
- [x] Move AI secret masking and submission behavior to `frontend-admin-ai-secrets.test.js`.
- [x] Add extracted suites to `test:admin` and remove the obsolete legacy-size record.
- [x] Verify exact test-name ownership, focused suites, `test:admin`, syntax, architecture, modularity, formatting, and diff checks.

## Results

- The 12 tests now live in four behavior suites of 209–592 lines; focused execution passed 12/12, the exact test-name multiset is unchanged, and `test:admin` discovers every extracted suite.
- The obsolete size allowance was removed. Final Batch A gates passed: full `npm test`, `npm run test:admin` (83/83), `npm run check`, `npm run verify:architecture` (22/22), `npm run verify:modularity` (900 files, 25 reviewed-size files, 0 errors), `npm run verify:docs` (5/5), Prettier, and `git diff --check`.

## Done When

All 12 tests remain present and passing exactly once, every resulting file stays below 800 lines, `test:admin` discovers all suites, and the old 1,430-line allowance is removed.
