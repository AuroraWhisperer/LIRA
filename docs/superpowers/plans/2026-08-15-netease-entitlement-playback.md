# NetEase Entitlement-Aware Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve NetEase streams using the currently logged-in account's playback rights, including official trial clips, and make browser audio recovery retry or skip safely.

**Architecture:** Keep the existing `POST /api/music/resolve-stream` contract. The NetEase provider calls the authenticated player-URL API with its server-side Cookie and returns only sanitized stream metadata; the browser continues to receive an audio URL without ever receiving the Cookie. The frontend error handler obtains its dependencies through the controller closure so audio events cannot call undefined callbacks.

**Tech Stack:** Node.js 24 CommonJS backend, browser ES modules, native `fetch`, `node:test`.

## Global Constraints

- Do not expose, log, or send the stored NetEase Cookie to the browser.
- Let NetEase decide full-track versus trial entitlement for the current account.
- Keep the existing music route and track contract; add no dependencies.
- Preserve unrelated working-tree changes.

---

### Task 1: NetEase account-aware stream resolution

**Files:**
- Modify: `src/music/providers/netease-provider.js`
- Test: `test/netease-provider.test.js`

**Interfaces:**
- Consumes: `NeteaseMusicProvider.requestJson(pathname, params)`, which already adds the saved Cookie server-side.
- Produces: `resolvePlayableUrl(track): Promise<{source, sourceTrackId, url, expireAt, playUrlExpireAt, trial, trialStartMs, trialEndMs}>`.

- [x] **Step 1: Write failing full-track and trial tests**

```js
provider.requestJson = async () => ({
  code: 200,
  data: [{ id: 11, url: 'https://cdn.test/full.mp3', code: 200, expi: 1200 }]
});
assert.equal((await provider.resolvePlayableUrl({ sourceTrackId: '11' })).trial, false);

provider.requestJson = async () => ({
  code: 200,
  data: [{ id: 11, url: 'https://cdn.test/trial.mp3', code: 200,
    freeTrialInfo: { start: 0, end: 30 } }]
});
assert.equal((await provider.resolvePlayableUrl({ sourceTrackId: '11' })).trial, true);
```

- [x] **Step 2: Run the provider test and confirm the fixed outer URL implementation fails the assertions**

Run: `node --test test/netease-provider.test.js`
Expected: FAIL because `requestJson` is not called and trial metadata is absent.

- [x] **Step 3: Implement the minimal authenticated player-URL parser**

```js
const payload = await this.requestJson('/api/song/enhance/player/url/v1', {
  ids: JSON.stringify([Number(sourceTrackId)]),
  level: 'standard',
  encodeType: 'mp3'
});
const stream = Array.isArray(payload?.data) ? payload.data[0] : null;
if (!stream?.url) throw new Error('当前网易云音乐账号无法播放或试听该歌曲。');
```

- [x] **Step 4: Validate URL protocol and return only sanitized playback metadata**

Accept only `http:` and `https:` URLs. Derive expiry from `expi`, normalize `freeTrialInfo.start/end`, and do not return upstream Cookie or raw response objects.

- [x] **Step 5: Run the provider tests**

Run: `node --test test/netease-provider.test.js`
Expected: PASS.

### Task 2: Browser audio error recovery

**Files:**
- Modify: `public/js/playback/features/stream-handler.js`
- Modify: `public/js/playback/controller.js`
- Test: `test/helpers/playback-app.js`
- Test: `test/playback-queue-behavior.test.js`

**Interfaces:**
- Consumes: `createStreamHandler({ streamService, playbackState, getPlaybackAudio, playPlaybackTrack, playbackNext })`.
- Produces: `handlePlaybackError(): Promise<void>` with no caller-supplied function arguments.

- [x] **Step 1: Extend the browser harness to vary resolve-stream responses and inspect errors**

```js
const stream = options.resolveStream?.(requestIndex) ?? { url: 'https://example.test/audio.mp3' };
return response({ ok: true, data: stream });
```

- [x] **Step 2: Add a failing audio-error retry test**

```js
await app.emit('music-player', 'error');
await flushAsyncWork();
assert.equal(app.audioPlayCalls(), 1);
assert.deepEqual(app.errors(), []);
```

- [x] **Step 3: Inject stable callback closures into the stream handler**

```js
const streamHandler = createStreamHandler({
  ...sharedDeps,
  playPlaybackTrack: (...args) => playPlaybackTrack(...args),
  playbackNext: (...args) => playbackNext(...args)
});
```

- [x] **Step 4: Make `handlePlaybackError` read audio and callbacks from dependencies**

The audio `error` listener keeps calling `handlePlaybackError()`; retry invokes the injected player callback, and terminal failure invokes the injected next-track callback.

- [x] **Step 5: Run the playback regression test**

Run: `node --experimental-vm-modules --test test/playback-queue-behavior.test.js`
Expected: PASS with no `TypeError` or unhandled rejection.

### Task 3: Repository verification

**Files:**
- Modify: `specs/netease-entitlement-playback_design.md`

**Interfaces:**
- Consumes: completed backend and frontend behavior.
- Produces: documented security and verification decisions.

- [x] **Step 1: Run JavaScript syntax checks**

Run: `npm run check`
Expected: PASS.

- [x] **Step 2: Run the complete test suite**

Run: `npm test`
Expected: PASS.

- [x] **Step 3: Review the final diff**

Confirm every changed runtime line supports entitlement-aware playback or safe audio recovery, and confirm pre-existing gift-effect and package changes are untouched.
