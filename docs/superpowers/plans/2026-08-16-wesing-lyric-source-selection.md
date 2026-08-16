# WeSing Lyric Source Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a NetEase-default lyric source selector and optional QQ/NetEase smart matching for WeSing online fallback, exposed in the desktop lyric settings column without changing normal online-player lyrics.

**Architecture:** Extend the existing WeSing-only online resolver instead of introducing a generic lyric resolver. Persist two WeSing-scoped settings, read them dynamically for every fallback request, and reuse the desktop lyric form's automatic save path for the controls.

**Tech Stack:** Node.js 24 CommonJS backend, vanilla browser JavaScript, HTML/CSS, `node:test` with `node:assert/strict`.

## Global Constraints

- Preserve the user's existing scrollbar changes in `public/css/admin/desktop-lyric-preview.css` and `test/desktop-lyrics.test.js`.
- Keep QQ Music and NetEase Music player lyrics provider-native; do not modify `/api/music/lyrics` or `public/js/playback/services/lyric-service.js`.
- Keep local WeSing QRC ahead of online fallback.
- Default `weSingLyricSource` to `netease` and `weSingSmartLyricMatch` to `true`.
- Accept only `qq` and `netease` inside the resolver; do not add dependencies or network endpoints.
- Follow existing two-space indentation, semicolons, single quotes, CommonJS/ESM boundaries, and automatic-save behavior.

---

### Task 1: Lock WeSing Resolver Preferences With Tests

**Files:**
- Modify: `test/wesing-online-lyrics.test.js`
- Modify: `src/music/wesing-online-lyrics.js`

**Interfaces:**
- Consumes: existing `createWeSingOnlineLyricResolver({ registry, lyricsService, preferredPlatform })`.
- Produces: `createWeSingOnlineLyricResolver({ ..., getPreferences })`, where `getPreferences()` returns `{ preferredPlatform: 'qq' | 'netease', smartMatch: boolean | string }`.

- [ ] **Step 1: Add a failing single-source test**

```js
let preferences = { preferredPlatform: 'netease', smartMatch: false };
const requestedPlatforms = [];
const resolve = createWeSingOnlineLyricResolver({
  registry: {},
  lyricsService: createTrackingLyricsService(requestedPlatforms),
  getPreferences: () => preferences
});

await resolve({ title: '失控', durationMs: 255000 });
assert.deepEqual(requestedPlatforms, ['netease']);

preferences = { preferredPlatform: 'qq', smartMatch: 'false' };
requestedPlatforms.length = 0;
await resolve({ title: '失控', durationMs: 255000 });
assert.deepEqual(requestedPlatforms, ['qq']);
```

- [ ] **Step 2: Add a failing smart-match tie-break test**

```js
const result = await createWeSingOnlineLyricResolver({
  registry: {},
  lyricsService: createEqualQualityLyricsService(),
  getPreferences: () => ({ preferredPlatform: 'netease', smartMatch: true })
})({ title: '失控', durationMs: 255000 });

assert.equal(result.source, 'netease');
```

- [ ] **Step 3: Run the resolver tests and confirm the new cases fail**

Run: `node --test test/wesing-online-lyrics.test.js`

Expected: FAIL because the resolver currently always queries both configured platforms and does not read `getPreferences()`.

- [ ] **Step 4: Implement dynamic preference normalization**

```js
const DEFAULT_PREFERRED_PLATFORM = 'netease';

function normalizeLyricPreferences(value, platforms) {
  const input = value && typeof value === 'object' ? value : {};
  const preferredPlatform = platforms.includes(input.preferredPlatform)
    ? input.preferredPlatform
    : platforms.includes(DEFAULT_PREFERRED_PLATFORM) ? DEFAULT_PREFERRED_PLATFORM : platforms[0];
  const smartMatch = input.smartMatch === undefined
    ? true
    : input.smartMatch === true || input.smartMatch === 'true';
  return { preferredPlatform, smartMatch };
}
```

Read `getPreferences()` inside `resolveWeSingOnlineLyrics()`, choose either both platforms or `[preferredPlatform]`, retain `Promise.allSettled`, and pass the current preferred platform to `selectBestLyricCandidate()`.

- [ ] **Step 5: Run the resolver tests**

Run: `node --test test/wesing-online-lyrics.test.js`

Expected: PASS, including existing duration, word-timing, partial-timeline, and single-provider-failure behavior.

- [ ] **Step 6: Prepare the logical commit**

```bash
git add src/music/wesing-online-lyrics.js test/wesing-online-lyrics.test.js
git commit -m "Add WeSing lyric source preferences"
```

Do not execute the commit unless the user explicitly requests it.

### Task 2: Persist and Inject WeSing Preferences

**Files:**
- Modify: `src/storage/settings-store.js`
- Modify: `src/server/music-runtime.js`
- Test: `test/wesing-online-lyrics.test.js`

**Interfaces:**
- Consumes: `settingsStore.getSettings()` and Task 1's `getPreferences()` resolver option.
- Produces: persisted string settings `weSingLyricSource` and `weSingSmartLyricMatch` available through normal state snapshots.

- [ ] **Step 1: Add failing default and wiring assertions**

```js
const { DEFAULT_SETTINGS } = require('../src/storage/settings-store');
assert.equal(DEFAULT_SETTINGS.weSingLyricSource, 'netease');
assert.equal(DEFAULT_SETTINGS.weSingSmartLyricMatch, 'true');
```

Also assert that `music-runtime.js` passes a `getPreferences` callback which reads both keys from `settingsStore.getSettings()`.

- [ ] **Step 2: Run the focused test**

Run: `node --test test/wesing-online-lyrics.test.js`

Expected: FAIL because the settings and runtime callback do not exist.

- [ ] **Step 3: Add defaults and runtime injection**

```js
weSingLyricSource: 'netease',
weSingSmartLyricMatch: 'true',
```

```js
getPreferences() {
  const settings = settingsStore.getSettings();
  return {
    preferredPlatform: settings.weSingLyricSource,
    smartMatch: settings.weSingSmartLyricMatch
  };
}
```

- [ ] **Step 4: Run the focused test**

Run: `node --test test/wesing-online-lyrics.test.js`

Expected: PASS.

- [ ] **Step 5: Prepare the logical commit**

```bash
git add src/storage/settings-store.js src/server/music-runtime.js test/wesing-online-lyrics.test.js
git commit -m "Persist WeSing lyric preferences"
```

Do not execute the commit unless the user explicitly requests it.

### Task 3: Add Desktop Lyric Settings Controls

**Files:**
- Modify: `public/pages/admin/song/desktop-lyric.html`
- Modify: `public/js/admin/desktop-lyric.js`
- Modify: `public/css/admin/desktop-lyric-preview.css`
- Modify: `test/desktop-lyrics.test.js`

**Interfaces:**
- Consumes: settings snapshot keys from Task 2 and the existing `/api/settings` automatic-save queue.
- Produces: accessible `weSingLyricSource` radio controls and `weSingSmartLyricMatch` checkbox serialization.

- [ ] **Step 1: Add failing UI structure assertions**

Assert the HTML contains:

```html
<input type="radio" name="weSingLyricSource" value="netease" checked>
<input type="radio" name="weSingLyricSource" value="qq">
<input id="weSingSmartLyricMatch" type="checkbox" checked>
```

Also assert the controls live before the existing style fieldset, include explanatory text that they only affect WeSing online fallback, and do not use `.source-tab`.

- [ ] **Step 2: Extend the automatic-save test**

Provide `document.querySelector('input[name="weSingLyricSource"]:checked')`, set `weSingSmartLyricMatch.checked`, and assert the saved body includes:

```js
{
  weSingLyricSource: 'netease',
  weSingSmartLyricMatch: 'true'
}
```

Dispatch `app:settings-state` with `{ weSingLyricSource: 'qq', weSingSmartLyricMatch: 'false' }` and assert the QQ radio becomes checked and the smart-match checkbox becomes unchecked.

- [ ] **Step 3: Run the desktop lyric tests and confirm failure**

Run: `node --experimental-vm-modules --test test/desktop-lyrics.test.js`

Expected: FAIL because the controls and serialization do not exist.

- [ ] **Step 4: Add the settings markup and scoped styles**

Use native radio inputs inside a `role="radiogroup"` and the existing `.switch-control` / `.switch-track` structure. Add only desktop-lyric-scoped source-picker styles, including `:focus-visible`; preserve the existing hover-only scrollbar changes.

- [ ] **Step 5: Serialize and restore the controls**

```js
function selectedWeSingLyricSource() {
  return document.querySelector('input[name="weSingLyricSource"]:checked')?.value || 'netease';
}

function checkedValue(id) {
  return document.getElementById(id)?.checked ? 'true' : 'false';
}
```

Update `collectDesktopLyric()`, make the `app:settings-state` handler pass `event.detail` to `loadDesktopLyricSettings()`, and restore both controls without scheduling a save.

- [ ] **Step 6: Run the desktop lyric tests**

Run: `node --experimental-vm-modules --test test/desktop-lyrics.test.js`

Expected: PASS, including the user's existing scrollbar assertions.

- [ ] **Step 7: Prepare the logical commit**

```bash
git add public/pages/admin/song/desktop-lyric.html public/js/admin/desktop-lyric.js public/css/admin/desktop-lyric-preview.css test/desktop-lyrics.test.js
git commit -m "Expose WeSing lyric source settings"
```

Do not execute the commit unless the user explicitly requests it.

### Task 4: Verify Scope and Regression Safety

**Files:**
- Verify: `public/js/playback/services/lyric-service.js`
- Verify: `src/server/routes/music-routes.js`
- Verify: all files changed in Tasks 1-3

**Interfaces:**
- Consumes: completed resolver, runtime settings, and UI controls.
- Produces: evidence that the feature is WeSing-only and the repository passes required validation.

- [ ] **Step 1: Run focused tests**

Run: `node --test test/wesing-online-lyrics.test.js`

Run: `node --experimental-vm-modules --test test/desktop-lyrics.test.js`

Expected: both commands PASS.

- [ ] **Step 2: Confirm normal playback remains provider-native**

Run: `git diff -- public/js/playback/services/lyric-service.js src/server/routes/music-routes.js`

Expected: no diff.

- [ ] **Step 3: Run the JavaScript syntax check**

Run: `npm run check`

Expected: PASS.

- [ ] **Step 4: Run the full serial test suite**

Run: `npm test`

Expected: PASS with no unhandled promise rejection.

- [ ] **Step 5: Review the final diff**

Run: `git -c core.excludesFile= status --short` and `git diff --check`.

Expected: only the scoped feature files plus the user's preserved scrollbar changes are modified; no whitespace errors are reported.

