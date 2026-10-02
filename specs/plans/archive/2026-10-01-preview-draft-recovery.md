# Preview Draft Recovery Implementation Plan

**Status:** Completed

**Goal:** Restore the last unsaved layout and component parameters when reopening the editor in the same browser. Refreshing an expired link can show its locally retained draft without reviving expired authority.

**Architecture:** Desktop controllers remain the owners of saved settings and publication. A browser-local recovery snapshot stores only their display drafts and saved baselines. A server-issued opaque draft key separates accounts and scenes; it carries no authorization.

## Current behavior and boundaries

The originating desktop retains acknowledged drafts in memory. The browser retains pending edits only until navigation; `pagehide` closes its capability, so refreshing a link can return 410. The relay owns no persisted configuration, and its existing revoke/owner/generation checks remain unchanged.

This change adds local browser recovery, not automatic saving/publication, server-side draft storage, credential persistence, or automatic renewal of expired capabilities. Same-browser recovery uses the same local origin; clearing browser data removes it. Existing concurrent scene, styling and storage changes must be preserved.

## Owners, interfaces and implementation

### 1. Non-authorizing recovery identity

Files: `src/server/component-preview-sessions.js`, `public/js/admin/component-preview-dialog.js`, transport tests.

- [x] Return `draftKey` with newly opened sessions and authenticated snapshots. Hash the authenticated owner's stable scope, component, and saved scene ID for canvas; use a per-process fallback when no scoped owner exists.
- [x] Carry the non-secret key in the existing preview fragment. Never read caller-supplied scope as authorization; fresh authenticated replies determine the key used for online recovery.
- [x] Test account/scene separation, same-account reopening, and unchanged expired-token denial.

### 2. Local draft snapshots and conflict handling

Files: new `public/js/admin/component-preview-drafts.js`, `public/js/admin/component-preview-remote.js`, new draft unit tests.

- [x] Store `{schemaVersion: 1, components: {id: {saved, draft}}}` under the canvas draft key. Exclude tokens, source URLs returned by execute, transport errors and live event data.
- [x] Snapshot on changed controller state, before navigation can discard an unacknowledged edit; skip redundant writes and preserve cached drafts when a connection ends.
- [x] Restore only changed fields through the existing controller `edit` API. Never call save or publish. Recognize a draft that was already saved.
- [x] If a changed field's current baseline or desktop draft differs, preserve both versions and require an in-product choice: restore the previous draft or use current settings.
- [x] Cache clean snapshots after successful save/discard so discarded work cannot reappear. Surface storage failures without interrupting editing.

```js
assert.equal(reopened.getState().dirty, true);
assert.equal(publications, 0);
```

### 3. Reopening and expired-page refresh

Files: `public/js/admin/component-preview-page.js`, `public/js/admin/component-preview-canvas-view.js`, browser tests and owning contract.

- [x] Mount recovery around authenticated controllers before the canvas is mounted. Show restored-but-unsaved state and conflict actions in the existing status/action area.
- [x] On an expired link, read the matching local snapshot and render it read-only with a clear instruction to reopen from the client for further editing. Do not send recovered edits with an expired capability.
- [x] Tear down every owned subscription and connection on navigation. Retain existing disabled save/publication semantics for disconnected views.
- [x] Verify reopening after pending edits, refresh after revocation, conflict choice, discard/save cleanup and account isolation. Update `docs/reference/frontend/overlays.md`.

## Verification and done criteria

- Unit tests for snapshot shape, restoration, changed baseline conflicts, unavailable storage and discard/save behavior.
- Transport tests for draft identity and existing auth/expiry contracts.
- Existing browser recovery/editor/output tests plus a browser scenario proving expired refresh renders the previous unsaved layout and subsequent fresh opening remains dirty.
- Isolated Electron canvas test; `npm run verify:quick`; `git diff --check` and scoped diff/status review.

Complete only when the draft survives the tested navigation cases, restoring never saves or publishes, account isolation and expired-token checks remain intact, and evidence is recorded. Roll back only task-owned hunks if needed; no reset, release, commit or user-app restart.

## Results — 2026-10-01

- The new transport regression failed before implementation because recovery identity was absent. It now passes with account/scene separation and expired-token denial unchanged.
- `node --experimental-vm-modules --test test/admin/component-preview-drafts.test.js test/admin/component-preview-drafts-browser.test.js test/admin/component-preview-recovery.test.js test/admin/component-preview-remote.test.js test/transport/component-preview.test.js test/desktop/danmaku-canvas-electron.test.js`: 21 passed.
- `node --test test/admin/component-preview-browser.test.js test/admin/component-preview-output.test.js`: 8 passed.
- After the final conflict-status layout adjustment, `node --test test/admin/component-preview-drafts-browser.test.js` passed again. This scenario includes blocked unsent edits, expired refresh, reopening with fresh desktop controllers, changed-baseline choice, manual publication, and discard/reopening.
- `npm run verify:quick`: 9 governance tests, syntax checks for 1147 JavaScript files, and 22 architecture tests passed.
- The browser scenario initially navigated only to a new URL fragment, which retains the old document. It now navigates through `about:blank` to model opening the newly issued preview as a fresh page; expired refresh remains a real reload of the old URL.
- Scope remains same browser and local origin. Expired refresh restores a read-only view; continuing editing requires a new desktop-issued connection. Browser data clearing and local port changes are outside this recovery guarantee.
- No existing user app was restarted, no real user storage was read or migrated, and no build or release was produced. Test runtimes and data use the existing isolated fixtures.
