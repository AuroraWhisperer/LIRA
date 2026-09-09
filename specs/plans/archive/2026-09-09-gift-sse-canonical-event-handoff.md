# Gift SSE Canonical Event Handoff Implementation Plan

**Status:** Complete (2026-09-09; source fix verified, installed application unchanged).

**Goal:** Deliver valid server final SSE events immediately through the existing client importer, without waiting for polling or reconnection.

**Architecture:** The remote client owns strict wire validation. The controller consumes the already-validated canonical event using the existing internal canonicalizer, as the local importer already does. No transport, authentication, source-fence, cursor, or persistence contract changes.

**Tech Stack:** Electron 43, Node.js 24, CommonJS, existing `node:test` fixtures and Web Streams.

## Current Behavior and Ownership

`remote-license-client.js` calls `normalizeProcessedGiftEvent` on raw SSE JSON. Its result contains derived `unitPriceCents`, `totalPriceCents`, `blindBoxPriceCents`, and `blindProfitCents` fields. `remote-gift-controller.js` repeats strict wire validation on that canonical object, rejects the derived fields, and silently returns before import or reconciliation. This rejection was reproduced in both source and the installed application archive. Existing controller tests feed raw events directly, bypassing the failing boundary.

The accepted source-partitioned gift projection specification requires a contiguous final event in clean `LIVE` to reach the idempotent importer before HTTP catch-up completes. The owning fact document is `docs/architecture/desktop/main.md`.

## Scope and Compatibility

- Modify only the controller's imported/called validator, focused SSE handoff tests, the desktop fact document, and task plans.
- Preserve the existing 10-second fallback edits, strict network allowlists, final cursor persistence, four-field fences, idempotent settlement, progress/final semantics, and other working-tree changes.
- Do not relax network validation, introduce local Bilibili settlement, modify a server/deployment, package/install, commit, or touch real user data.

## Milestone and Verification

- [x] Add real `createRemoteLicenseClient().watchGiftEvents` -> controller tests using in-memory SSE input and existing runtime fixtures. Cover immediate contiguous final before a deliberately delayed recovery response, progress handoff, and rejection of extra/privacy-sensitive wire fields at the network boundary.
- [x] Confirm the handoff regression fails before the controller fix. No real timer, network, authorization, or user database is used.
- [x] In `src/electron/remote-gift-controller.js`, replace the import and invocation of `normalizeProcessedGiftEvent` with `canonicalizeProcessedGiftEvent`. Keep error isolation and all state/fence gates unchanged.
- [x] Document wire-versus-canonical ownership and record the root-cause finding alongside the earlier fallback plan.
- [x] Run the controller suite and related import/store/client suites separately, focused syntax checks, and architecture/document checks listed below.
- [x] Review the touched diff, `git diff --check`, and `git status --short`; archive the completed plan with actual results.

## Verification Results

- Before the fix, `node --test --test-name-pattern='validated SSE canonical events' test/remote-gift-controller.test.js` failed because the valid progress event never reached the importer through the real SSE parser.
- After the fix, the two new boundary tests passed. The final test keeps HTTP recovery unresolved and confirms immediate import while the durable cursor remains unchanged; it fires no polling timer and causes no reconnect. The negative test rejects malformed JSON and extra `uid`/`roomId` wire fields while allowing a following valid event.
- `node --test test/remote-gift-controller.test.js`: 32/32 passed.
- `node --test test/remote-license-client.test.js test/processed-gift-import.test.js test/gift-sync-store.test.js`: 35/35 passed, including the actual importer's once-only recent snapshot, history, statistics, overtime and frame effects.
- `node --experimental-vm-modules --test test/module-boundaries.test.js test/esm-module-boundaries.test.js test/governance-docs.test.js`: 18/18 passed.
- `node --check src/electron/remote-gift-controller.js`, `node --check test/remote-gift-controller.test.js`, and `git diff --check` passed; only repository LF/CRLF conversion warnings remain.
- No server, network allowlist, schema, user data, generated asset, or installed package changed. Earlier fallback edits remain intact. Live installed-client verification requires a rebuilt application and was not performed.

## Failure Handling and Done When

Malformed network data remains rejected before it reaches the controller. Stop and inspect only task-owned changes if focused tests reveal a contract conflict; do not reset existing edits. Done when the actual SSE parsing boundary reaches the immediate final importer and progress handler, wire rejection and existing lifecycle/idempotency tests pass, and the scoped diff is reviewed. Delivery of a rebuilt installed application is outside this source fix.
