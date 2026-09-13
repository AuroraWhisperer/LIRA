# AI Assistant Service Test Ownership Plan

## Goal

Split the 1,105-line AI assistant service test into trigger/safety, delivery, generation/tool rounds, and lifecycle/cache suites while retaining every integration chain and isolated service instance.

## Current Behavior / Ownership

- One file registers 26 tests spanning pure prompt policy, unsafe-input rejection, FIFO delivery and room echo, tool rounds, provider operations, shutdown, review stages, and reply caching.
- The focused baseline passes 26/26.
- Three fixture functions at the end create per-test service state and are genuinely reused across the behavior groups.

## Compatibility Constraints / Non-goals

- Move complete tests without weakening assertions or converting integration scenarios into isolated stubs.
- Extract only the existing service factory, answering client, and wait helper to a test helper; each service call still creates independent state.
- Preserve delivery ordering, retry counts, cancellation reasons, tool rounds, cache keys, and shutdown drains.
- Do not modify AI production code, prompts, configuration, or B/C/D work.

## Milestones

- [x] Keep trigger extraction, reply policy, and local safety in `ai-assistant-service.test.js`.
- [x] Move FIFO delivery, chunk pacing, cooldown, and room-echo retry behavior to `ai-assistant-delivery.test.js`.
- [x] Move generation budgets, tool rounds, review stages, and official-chat search to `ai-assistant-generation.test.js`.
- [x] Move provider operations, shutdown, and cache invalidation to `ai-assistant-lifecycle.test.js`.
- [x] Share only the existing stateless fixture constructors through `helpers/ai-assistant-service-fixture.js`.
- [x] Remove the obsolete legacy-size record and verify exact test ownership, focused tests, syntax, architecture, modularity, formatting, and diff checks.

## Results

- The 26 tests now live in four behavior suites (108–420 lines) plus an 83-line isolated fixture; focused execution passed 26/26 and the exact test-name multiset is unchanged.
- The obsolete size allowance was removed. Final Batch A gates passed: full `npm test`, `npm run test:admin` (83/83), `npm run check`, `npm run verify:architecture` (22/22), `npm run verify:modularity` (900 files, 25 reviewed-size files, 0 errors), `npm run verify:docs` (5/5), Prettier, and `git diff --check`.

## Done When

All 26 tests remain present and passing exactly once, the shared fixture creates no global mutable state, every file is below 800 lines, and the old 1,105-line allowance is removed.
