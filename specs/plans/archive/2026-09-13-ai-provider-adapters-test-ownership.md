# AI Provider Adapters Test Ownership Plan

## Goal

Group the 1,028-line provider-adapter test into request protocols, error/connection contracts, and local/external tools while keeping all 29 tests unchanged.

## Current Behavior / Ownership

- One file mixes DeepSeek Chat/Responses request formats, provider presets and failure reporting, model/connection checks, time, weather quota, and map behavior.
- The focused baseline passes 29/29.

## Compatibility Constraints / Non-goals

- Move complete tests and keep the small JSON response factory local to each suite.
- Preserve provider URLs, reasoning mappings, cancellation, logging, quota refund, and normalized route assertions.
- Do not modify provider/tool production code, network behavior, or B/C/D work.
- Keep all resulting files below 600 lines so no new warning-band review is needed.

## Milestones

- [x] Keep Chat/Responses requests and provider presets in `ai-provider-adapters.test.js`.
- [x] Move truncation, tracing, model listing, and connection validation to `ai-provider-contracts.test.js`.
- [x] Move time, QWeather quota, and AMap behavior to `ai-tools.test.js`.
- [x] Remove the obsolete legacy-size record.
- [x] Verify the exact test-name multiset, focused suites, syntax, architecture, modularity, formatting, and diff checks.

## Results

- The 29 tests now live in three behavior suites of 413, 373, and 267 lines; focused execution passed 29/29 and the exact test-name multiset is unchanged.
- The obsolete size allowance was removed. Final Batch A gates passed: full `npm test`, `npm run test:admin` (83/83), `npm run check`, `npm run verify:architecture` (22/22), `npm run verify:modularity` (900 files, 25 reviewed-size files, 0 errors), `npm run verify:docs` (5/5), Prettier, and `git diff --check`.

## Done When

All 29 tests remain present and passing exactly once, each file has one behavior family and stays below 600 lines, and the old 1,028-line allowance is removed.
