# Preview Connection Recovery Implementation Plan

**Status:** Completed

**Goal:** Keep an active canvas editable for as long as the desktop session remains valid, and recover from temporary transport failures without losing drafts or repeating commands.

**Architecture:** Retain the existing desktop-owned controllers and scoped local HTTP relay. Authenticated activity on either side renews the relay lease; browser mutations are serialized and identified so a lost response can be retried safely.

**Tech Stack:** Node.js, browser ESM, existing Node test runner and Playwright fixtures.

## Current behavior and ownership

- `src/server/component-preview-sessions.js` expires sessions 15 seconds after the last desktop exchange, ignoring authenticated browser activity.
- `public/js/admin/component-preview-dialog.js` revokes all sessions after any exchange failure.
- `public/js/admin/component-preview-remote.js` permanently disconnects after a failed poll or mutation.
- Desktop controllers own edits, persistence and publication. The relay owns only temporary snapshots, capabilities and ordered commands.
- Contract: `docs/reference/frontend/overlays.md`, section 6.4. HTTP route owner: `src/server/routes/component-preview-routes.js`.

## Boundaries and compatibility

- Keep page URLs, existing HTTP actions, IPC, storage formats and renderer privileges unchanged.
- Keep owner/generation invalidation, explicit close/revoke, token checks and Host/Origin checks.
- Add an optional browser command identifier; requests without it remain supported.
- Temporary connection failures retain drafts and show a reconnecting status. HTTP authorization, revocation and validation failures remain terminal.
- This does not recover sessions across server restarts or account changes, persist offline drafts to disk, or change Electron background policies.
- Preserve concurrent UI work in the checkout. No commits, branches, release or deployment.

## Implementation and verification

### 1. Relay activity and safe replay

Files: `src/server/component-preview-sessions.js`, `test/transport/component-preview.test.js`.

- [x] Add fake-clock tests for browser activity beyond the old lease, inactivity cleanup, invalid-token non-renewal, and owner/revoke invalidation after renewal.
- [x] Use a two-minute inactivity lease renewed by authenticated successful reads/commands and desktop exchanges. This accommodates background timer scheduling; it is not a total editing duration.
- [x] Add an optional, increasing integer `commandId` to mutations. Remember the most recently accepted identifier/result per session; duplicate replay returns the original sequence even after desktop acknowledgement, and older identifiers are rejected. The browser sends at most one mutation request at a time, including publish/source.

```js
assert.equal(retry.sequence, original.sequence);
assert.equal(sessions.exchange({ id, state, ack: 0 }).commands.length, 1);
```

### 2. Retry transport without abandoning drafts

Files: `public/js/admin/component-preview-remote.js`, `public/js/admin/component-preview-dialog.js`, `public/js/shared/utils.js`, remote and recovery tests.

- [x] Pass optional abort signals through the existing `api` helper. Bound preview HTTP attempts to five seconds and cancel browser retry timers on close.
- [x] Retry network errors, timeouts, HTTP 408/429/5xx, with a capped delay. Stop on other HTTP failures and preserve the visible draft.
- [x] Serialize browser mutations with a stable identifier for all attempts. Keep local pending edits until desktop acknowledgement; pending save/publication waits across transient polling failures.
- [x] Clear reconnecting status after successful synchronization. Keep it separate from controller validation/save errors.
- [x] Retry desktop exchanges with their existing acknowledgement state. Do not replay commands already processed by the desktop. Detect generation changes before every attempt.

```js
assert.equal(controller.getState().draft.label, 'unsaved');
assert.equal(controller.getState().loaded, true);
assert.equal(publications, 1);
```

### 3. Focused acceptance and contract update

- [x] `node --test test/transport/component-preview.test.js`
- [x] `node --experimental-vm-modules --test test/admin/component-preview-remote.test.js`
- [x] Browser recovery regressions: failed desktop exchange, failed browser read, lost accepted mutation response, retained later edits, terminal revocation, retry cancellation.
- [x] Browser and output suites passed together with Electron; recovery suite passed with remote and transport suites (exact invocations below).
- [x] `node --test test/desktop/danmaku-canvas-electron.test.js` using its isolated Electron data directory and real preload/IPC.
- [x] `npm run verify:quick` and `npm run verify:contracts`, because the change extends relay command replay and touches a shared transport helper.
- [x] Update the owning contract with renewal, retry and terminal failure behavior; inspect task diff, `git diff --check`, and `git status --short`.

## Results — 2026-10-01

- Before the relay change, the activity and safe replay regressions failed. After the fix, all 8 transport tests passed, including three hours of activity using an injected clock.
- `node --experimental-vm-modules --test test/admin/component-preview-recovery.test.js test/admin/component-preview-remote.test.js test/transport/component-preview.test.js`: 13 passed.
- `node --test test/admin/component-preview-browser.test.js test/admin/component-preview-output.test.js test/desktop/danmaku-canvas-electron.test.js`: 7 passed.
- `npm run verify:quick`: 9 governance tests, syntax checks for 1143 JavaScript files, and 22 architecture checks passed. An initial plan-status formatting error was corrected before the passing run.
- `npm run verify:contracts`: 10 pinned fixtures passed at `01fb2b47d5e081f5dd559933991ade4819eb3428`. The default sibling checkout was at a different revision, so validation used a detached temporary checkout under `tmp/`; it was removed afterward.
- The new browser test is registered in `scripts/run-tests.js`. No app instance belonging to the user was restarted; no release was built or installed.

## Failure handling and done criteria

Do not reopen an expired or revoked capability automatically. A permanent disconnect keeps its last visible draft, stops sending commands, and tells the user to reopen from the desktop. Close cancels owned timers/requests and drains previously accepted commands through the existing desktop close path.

Reverse only task-owned hunks if verification requires rollback; never reset concurrent work. Complete when activity survives the old timeout, retry tests prove no lost draft or duplicate publication, authorization tests still pass, checks are recorded, and this plan is archived.
