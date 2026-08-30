# Game Winner Avatar Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make number bomb and Gomoku resolve both viewer and host winner avatars through the existing game profile endpoint, using one reusable profile resolver and an overlay avatar size that remains legible without covering the result card.

**Architecture:** Keep the existing `/api/games/winner-profile` contract and transient session winner metadata. Move winner-role identity resolution into a small Bilibili profile adapter that accepts the connected host identity, falls back to `resolveRoomInfo()`, and delegates both roles to `UserInfoService.ensure()`. The overlay continues to call the endpoint on result display and sends the returned Bilibili URL through `/api/bilibili/avatar`.

**Tech Stack:** Node.js 24+, CommonJS, native `node:test`, Vanilla JavaScript ES modules, native CSS, Electron-rendered overlay.

## Global Constraints

- Preserve `/api/games/winner-profile` response shape `{ avatarUrl, name }` and all existing game/WebSocket fields.
- Keep avatar data transient; do not persist, log, or expose cookies/tokens in game state.
- Viewer and host profiles must be resolved through the injected `UserInfoService.ensure()` boundary, never from renderer calls to Bilibili.
- Renderer must continue using `/api/bilibili/avatar` and DOM-safe `textContent`/attributes; no direct CDN image URL.
- Keep the desktop overlay as the layout source of truth and avoid unrelated responsive or browser-only changes.

---

## File Structure

- Create: `src/bilibili/users/game-winner-profile.js` — reusable winner-role identity and profile resolver.
- Modify: `src/server/bilibili-runtime.js` — compose the resolver and expose it through the existing runtime method.
- Create: `test/bilibili-game-winner-profile.test.js` — host/viewer resolution and fallback coverage.
- Modify: `public/css/overlays/games.css` — scale the result avatar with the overlay while preserving a square crop.
- Modify: `public/pages/overlays/games.html` — bump the module cache-buster after the visual change.
- Modify: `test/games-overlay.test.js` — assert the result avatar sizing contract and profile endpoint use.

## Task 1: Extract The Winner Profile Resolver

**Files:**

- Create: `src/bilibili/users/game-winner-profile.js`
- Modify: `src/server/bilibili-runtime.js:1-110`
- Test: `test/bilibili-game-winner-profile.test.js`

**Interfaces:**

- Consumes: `{ role: 'viewer'|'host', uid?, name? }`, `ensureProfile(uid, { fields: ['name', 'avatarUrl'] })`, connected host identity, and a room-info fallback.
- Produces: `Promise<{ avatarUrl: string, name: string }>` with empty fields when the winner is invalid or profile lookup fails.

- [x] **Step 1: Write the failing resolver tests**

```js
test('winner resolver uses the recorded viewer uid', async () => {
  const resolver = createGameWinnerProfileResolver({
    ensureProfile: async (uid, options) => {
      assert.equal(uid, '42');
      assert.deepEqual(options.fields, ['name', 'avatarUrl']);
      return {
        uid: '42',
        name: 'Alice',
        avatarUrl: 'https://i0.hdslb.com/a.jpg',
      };
    },
  });
  assert.deepEqual(
    await resolver({ role: 'viewer', uid: '42', name: '弹幕名' }),
    {
      avatarUrl: 'https://i0.hdslb.com/a.jpg',
      name: 'Alice',
    },
  );
});

test('winner resolver captures the host from the connected identity or room fallback', async () => {
  const calls = [];
  const resolver = createGameWinnerProfileResolver({
    getHostIdentity: () => ({ uid: '', name: '' }),
    resolveRoomInfo: async () => ({ uid: '99', ownerName: '主播' }),
    ensureProfile: async (uid) => {
      calls.push(uid);
      return { name: '主播', avatarUrl: 'https://i0.hdslb.com/b.jpg' };
    },
  });
  assert.deepEqual(await resolver({ role: 'host' }), {
    avatarUrl: 'https://i0.hdslb.com/b.jpg',
    name: '主播',
  });
  assert.deepEqual(calls, ['99']);
});
```

- [x] **Step 2: Run the focused test to verify it fails**

Run: `node --test test/bilibili-game-winner-profile.test.js`
Expected: FAIL because the resolver module does not exist.

- [x] **Step 3: Implement the minimal resolver**

Export `createGameWinnerProfileResolver(options)`. Normalize the role to viewer/host, prefer the connected host `{ uid, name }`, otherwise await `resolveRoomInfo()`, and call `ensureProfile(uid, { fields: ['name', 'avatarUrl'] })`. Return the resolved name/avatar with the winner or room name as fallback; catch provider/room failures and return empty `avatarUrl` without throwing.

- [x] **Step 4: Compose it in the runtime**

In `createBilibiliRuntime()`, construct the resolver once with:

```js
const resolveGameWinnerProfile = createGameWinnerProfileResolver({
  getHostIdentity: () => ({ uid: client?.ownerUid, name: client?.ownerName }),
  resolveRoomInfo: () => getGameApiClient().resolveRoomInfo(),
  ensureProfile: (uid, fields) => userInfoService.ensure(uid, fields),
});
```

Replace the inline `getGameWinnerProfile()` body with `return resolveGameWinnerProfile(winner);`. Keep `fetchAvatarImage()` and all runtime lifecycle behavior unchanged.

- [x] **Step 5: Run focused tests**

Run: `node --test test/bilibili-game-winner-profile.test.js test/game-routes.test.js test/games.test.js`
Expected: PASS, including existing winner-profile route and winner identity regressions.

## Task 2: Make The Result Avatar Legible In All Desktop Game Viewports

**Files:**

- Modify: `public/css/overlays/games.css:106-107`
- Modify: `public/pages/overlays/games.html:6,139`
- Test: `test/games-overlay.test.js`

**Interfaces:**

- Consumes: `profile.avatarUrl` returned by `GET /api/games/winner-profile`.
- Produces: a circular, square-cropped avatar that scales from compact browser-source sizes to desktop game canvases without changing game layout.

- [x] **Step 1: Add the sizing assertions**

Extend the overlay regression to require `aspect-ratio: 1`, `object-fit: cover`, and a bounded `clamp()` width/height for `.game-result-avatar`, while retaining `/api/games/winner-profile` and `/api/bilibili/avatar?url=` assertions.

- [x] **Step 2: Run the focused overlay test to verify the new assertion fails**

Run: `node --test test/games-overlay.test.js`
Expected: FAIL because the existing avatar rule has no explicit aspect ratio and its 26–34px range is too small for the result card.

- [x] **Step 3: Implement the minimal visual change**

Use the same bounded size for width and height, for example `clamp(36px, 4.6vw, 56px)`, add `aspect-ratio: 1`, `flex: 0 0 auto`, and retain `object-fit: cover`, border, and circular radius. Update the two static resource query versions in `games.html` so Electron does not reuse stale CSS/JS during verification.

- [x] **Step 4: Run focused UI checks**

Run: `node --test test/games-overlay.test.js test/frontend-games.test.js`
Expected: PASS with the existing DOM-safe and cache-buster assertions.

## Task 3: Verify The Unified Contract

**Files:**

- Verify: `src/bilibili/users/game-winner-profile.js`
- Verify: `src/server/bilibili-runtime.js`
- Verify: `public/js/overlays/games.js`
- Verify: `public/css/overlays/games.css`

- [x] **Step 1: Run syntax and architecture gates**

Run: `npm.cmd run check` and `npm.cmd run verify:architecture`
Expected: PASS with no new boundary violations.

- [x] **Step 2: Run the quick verification gate**

Run: `npm.cmd run verify:quick`
Expected: PASS.

- [x] **Step 3: Review the final diff**

Run: `git diff --check` and `git status --short`.
Expected: only the resolver, runtime wiring, focused tests, overlay sizing/cache-buster, and this plan are changed; no generated data or secrets appear.

## Self-Review

- **Spec coverage:** Task 1 unifies host/viewer capture while preserving the existing endpoint; Task 2 makes the image legible and crop-safe; Task 3 verifies syntax, architecture, and focused regressions.
- **Placeholder scan:** There are no TODO/TBD implementation steps.
- **Type consistency:** The resolver always returns `{ avatarUrl, name }`, matching `createGamesContext()` and `/api/games/winner-profile`.

## Done When

Number bomb and Gomoku winner results request the same transient profile endpoint as draw guess; viewer UIDs use `UserInfoService.ensure()`, host identity is resolved through the reusable adapter with connected/room fallback, the avatar is proxied and visibly sized for the result card, and focused plus quick verification gates pass.
