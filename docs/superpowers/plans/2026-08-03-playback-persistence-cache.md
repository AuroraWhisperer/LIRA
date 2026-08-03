# Playback Persistence And Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Execute these tasks inline with test-first checkpoints; no subagent skill is available in this workspace.

**Goal:** Restore the last desktop playback queue and progress from SQLite, reliably flush the final state during Electron shutdown, and retain personal music-list caches across desktop restarts.

**Architecture:** Keep SQLite as the authoritative playback-state store and use the existing localStorage state only as a legacy fallback. Expose an awaited shutdown flush from the persistence closure. Keep provider content in localStorage for 24 hours with the existing stale-while-revalidate behavior, clearing it only when authentication changes.

**Tech Stack:** Browser ESM, Electron IPC, Node.js 24 `node:test`, SQLite-backed HTTP API.

## Global Constraints

- Touch only playback persistence, provider content caching, and their regression tests.
- Preserve the existing `default` playback client ID and `/api/playback/queue-state` contract.
- Add no dependencies and follow the repository's two-space, single-quote JavaScript style.
- Keep the user's existing changes in `public/css/admin/toasts.css`, `public/css/overlays/base.css`, and `public/js/admin/settings.js` untouched.

---

### Task 1: Restore Playback State From SQLite

**Files:**
- Modify: `public/js/playback/state/storage.js`
- Test: `test/playback-queue.test.js`

**Interfaces:**
- Consumes: `GET /api/playback/queue-state?clientId=default` returning `{ ok, data: { payload } }`.
- Produces: `StorageManager.restoreState()` returning normalized state with `currentTime` mapped to `restoredTime`.

- [ ] **Step 1: Write the failing cold-start test**

```js
test('cold start restores the server queue and playback progress without local storage', async () => {
  const app = await createPlaybackApp(savedState, { localState: null });
  await app.init();
  assert.equal(app.element('playbackTrackTitle').textContent, savedState.current.title);
  assert.equal(app.element('playbackCurrentTime').textContent, '00:42');
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `node --experimental-vm-modules --test test/playback-queue.test.js`

Expected: the player remains empty because `StorageManager` only reads localStorage.

- [ ] **Step 3: Implement server-first restoration with legacy fallback**

```js
async restoreState() {
  const serverState = await this._restoreFromServer();
  if (serverState) return serverState;
  return this._restoreFromLocalStorage();
}
```

Normalize `currentTime` with `Math.max(0, Number(saved.currentTime ?? saved.restoredTime ?? 0))` before validating and applying the state.

- [ ] **Step 4: Run the focused test and confirm it passes**

Run: `node --experimental-vm-modules --test test/playback-queue.test.js`

Expected: PASS, including queue title, current track, and 42-second progress restoration.

### Task 2: Await The Electron Shutdown Flush

**Files:**
- Modify: `public/js/playback/operations/state-persistence.js`
- Modify: `public/js/playback/core/initializer.js`
- Modify: `public/js/playback/controller.js`
- Test: `test/playback-queue.test.js`

**Interfaces:**
- Consumes: `window.musicAPI.savePlaybackState(clientId, payload)` and `confirmShutdownFlush()`.
- Produces: `flushPlaybackStateForShutdown(): Promise<void>` that owns access to the closure's pending payload.

- [ ] **Step 1: Write the failing immediate-shutdown test**

```js
await app.emit('music-player', 'pause');
await app.emitPrepareShutdown();
assert.equal(app.ipcSavedState().currentTime, 37);
assert.equal(app.shutdownAcknowledged(), true);
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `node --experimental-vm-modules --test test/playback-queue.test.js`

Expected: no IPC state is saved because the initializer reads a nonexistent dependency property.

- [ ] **Step 3: Implement an awaited closure-owned flush**

```js
async function flushPlaybackStateForShutdown() {
  if (!playbackStateSavePending && playbackState.current) savePlaybackState();
  const payload = takePendingPayload();
  if (!payload) return;
  await window.musicAPI.savePlaybackState(playbackClientId, payload);
}
```

Pass this function through the controller and have the initializer await it before acknowledging shutdown.

- [ ] **Step 4: Run the focused test and confirm it passes**

Run: `node --experimental-vm-modules --test test/playback-queue.test.js`

Expected: PASS with IPC persistence completing before the acknowledgment.

### Task 3: Retain Personal Music Caches Across Restarts

**Files:**
- Modify: `public/js/playback/cache/manager.js`
- Modify: `public/js/playback/core/initializer.js`
- Modify: `public/js/playback/operations/provider-operations.js`
- Test: `test/frontend-regressions.test.js`
- Test: `test/playback-queue.test.js`

**Interfaces:**
- Consumes: cache keys for `liked`, `created-playlists`, `collected-playlists`, and `playlist-tracks`.
- Produces: 24-hour persistent localStorage entries, with `clearByPrefix(platform + ':')` on successful login or logout.

- [ ] **Step 1: Write failing cache-lifetime and pagehide tests**

```js
now += 12 * 60 * 60 * 1000;
assert.deepEqual(new CacheManager().get('qq:liked'), cachedData);
await app.emitWindow('pagehide');
assert.ok(app.hasStorageKey('playbackCache:qq:liked'));
```

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run: `node --experimental-vm-modules --test test/frontend-regressions.test.js test/playback-queue.test.js`

Expected: the 4-hour TTL expires and pagehide removes the cache.

- [ ] **Step 3: Implement the 24-hour policy and authentication invalidation**

```js
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
```

Remove the pagehide `clearAll()` listener. Clear only the selected provider prefix after successful login and during logout cleanup so another account never sees stale personal lists.

- [ ] **Step 4: Run static and full regression verification**

Run: `npm run check`

Expected: all JavaScript syntax checks pass.

Run: `npm test`

Expected: all tests pass with no unhandled promise rejections.
