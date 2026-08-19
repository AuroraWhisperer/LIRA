+# Game Winner Avatar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display the winning host's or viewer's Bilibili avatar immediately before the winner name in the game overlay result, without retaining avatar data after that result is hidden.

**Architecture:** The game session retains only the identity of the viewer whose accepted move ended the game, so multi-viewer matches can identify the actual winner. A game-scoped route resolves the current session's Bilibili face URL on demand; the overlay requests it only when it displays a result and clears the image when the result closes. The host identity is resolved from the configured live room and the viewer identity is the recorded winning danmaku sender.

**Tech Stack:** Node.js 24+, CommonJS, native `node:test`, Vanilla JavaScript, native CSS, Electron-rendered OBS overlay.

## Global Constraints

- Preserve existing game API and WebSocket state fields; only add additive result metadata.
- Do not persist, cache, or log avatar URLs.
- Only accept numeric Bilibili UIDs and only render HTTPS Bilibili image URLs.
- Keep all rendering DOM-safe; do not use `innerHTML`.
- Do not create a commit unless explicitly requested.

---

## File Structure

- Modify `src/games/game-session-service.js`: retain the winning viewer's transient UID and display name with the live session.
- Modify `src/bilibili/danmaku/api-client.js`: add the narrowly scoped Bilibili profile lookup that returns an HTTPS avatar URL.
- Modify `src/server/bilibili-runtime.js`, `src/server.js`, and `src/server/api-context.js`: expose a game-only resolver through the existing composition root and API context.
- Modify `src/server/routes/game-routes.js`: add the game winner-profile endpoint, which uses the current session winner rather than client-supplied UIDs.
- Modify `public/pages/overlays/games.html`, `public/js/overlays/games.js`, and `public/css/overlays/games.css`: render and clear the avatar beside the winner label.
- Modify `test/games.test.js`, `test/game-routes.test.js`, and `test/games-overlay.test.js`: lock down winner metadata, endpoint validation, and DOM-safe overlay use.

### Task 1: Preserve Winning Viewer Identity

**Files:**
- Modify: `src/games/game-session-service.js`
- Test: `test/games.test.js`

**Interfaces:**
- Consumes: `handleDanmaku({ uid, userName, message })`.
- Produces: `getSession().winner = { role, uid, name }` after a winning move, with empty `uid` for the host.

- [x] **Step 1: Write the failing test**

```js
test('game session retains the viewer identity that wins', () => {
  const service = createGameSessionService();
  service.start({ game: 'number-bomb', mode: 'single', targetUid: '42', targetName: 'Alice' });
  service.move({ value: 50 }, 'host');
  service.handleDanmaku({ uid: '42', userName: 'Alice', message: '1' });
  assert.deepEqual(service.getSession().winner, { role: 'viewer', uid: '42', name: 'Alice' });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/games.test.js`
Expected: FAIL because the public session has no `winner` identity metadata.

- [x] **Step 3: Write minimal implementation**

```js
function move(input = {}, player = 'host', playerIdentity = {}) {
  // ...
  if (result.state.winner) {
    winner = {
      role: result.state.winner,
      uid: result.state.winner === 'viewer' ? cleanUid(playerIdentity.uid) : '',
      name: cleanName(playerIdentity.name)
    };
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --test test/games.test.js`
Expected: PASS.

### Task 2: Resolve A Result Avatar On Demand

**Files:**
- Modify: `src/bilibili/danmaku/api-client.js`
- Modify: `src/server/bilibili-runtime.js`
- Modify: `src/server.js`
- Modify: `src/server/api-context.js`
- Modify: `src/server/routes/game-routes.js`
- Test: `test/game-routes.test.js`

**Interfaces:**
- Consumes: `GET /api/games/winner-profile`.
- Produces: `{ ok: true, data: { avatarUrl, name } }`, or an empty `avatarUrl` if Bilibili cannot provide an image.
- The resolver performs no memoization or persistence.

- [x] **Step 1: Write the failing test**

```js
test('game avatar route validates viewer uid and returns transient profile data', async () => {
  const context = { games: { getWinnerProfile: async () => ({ avatarUrl: 'https://i0.hdslb.com/a.jpg', name: 'Alice' }) } };
  const result = await invokeGameAvatarRoute(context, { role: 'viewer', uid: '42' });
  assert.deepEqual(result.payload.data, { avatarUrl: 'https://i0.hdslb.com/a.jpg', name: 'Alice' });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/game-routes.test.js`
Expected: FAIL because the route does not exist.

- [x] **Step 3: Write minimal implementation**

```js
async 'GET /api/games/winner-profile'(context, request, res) {
  const profile = await context.games.getWinnerProfile();
  sendJson(res, 200, { ok: true, data: profile });
}
```

Use `BilibiliApiClient.fetchProfile(uid)` to extract only an HTTPS `hdslb.com` face URL, return an empty avatar on lookup failure, and do not add a cache.

- [x] **Step 4: Run test to verify it passes**

Run: `node --test test/game-routes.test.js`
Expected: PASS.

### Task 3: Render And Clear The Result Avatar

**Files:**
- Modify: `public/pages/overlays/games.html`
- Modify: `public/js/overlays/games.js`
- Modify: `public/css/overlays/games.css`
- Test: `test/games-overlay.test.js`

**Interfaces:**
- Consumes: the additive `session.winner` metadata and `GET /api/games/winner-profile`.
- Produces: a circular `<img>` immediately before the winner name, with a role fallback when no avatar is available.

- [x] **Step 1: Write the failing test**

```js
assert.match(html, /id="gameResultAvatar"/);
assert.match(script, /api\/games\/avatar/);
assert.match(script, /replaceChildren|textContent/);
assert.doesNotMatch(script, /innerHTML/);
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/games-overlay.test.js`
Expected: FAIL because the result card has no avatar node or on-demand lookup.

- [x] **Step 3: Write minimal implementation**

```js
async function showGameResult(winner, winnerIdentity) {
  resultEl.hidden = false;
  renderWinnerText(winner, winnerIdentity);
  const profile = await loadWinnerProfile(winner, winnerIdentity.uid);
  if (resultEl.hidden || resultEl.dataset.winner !== winner) return;
  avatar.src = profile.avatarUrl;
  avatar.hidden = !profile.avatarUrl;
}
```

Clear `src` and hide the image in `hideGameResult()`; use an incrementing request token so an old profile response cannot update a later game result.

- [x] **Step 4: Run test to verify it passes**

Run: `node --test test/games-overlay.test.js`
Expected: PASS.

### Task 4: Verify The Scoped Change

**Files:**
- Verify: `test/games.test.js`
- Verify: `test/game-routes.test.js`
- Verify: `test/games-overlay.test.js`

- [x] **Step 1: Run focused regressions**

Run: `node --test test/games.test.js test/game-routes.test.js test/games-overlay.test.js`
Expected: PASS.

- [x] **Step 2: Run syntax checks**

Run: `npm.cmd run check`
Expected: PASS.

- [x] **Step 3: Review the final change**

Run: `git diff --check` and `git status --short`
Expected: no whitespace errors and only task-owned source, test, style, and plan changes.

## Self-Review

- **Spec coverage:** Task 1 identifies the actual winning viewer; Task 2 retrieves the Bilibili face only when requested and never stores it; Task 3 places the avatar before the winner name and handles a failed lookup; Task 4 verifies the affected contracts.
- **Placeholder scan:** No TODO/TBD placeholders are present.
- **Type consistency:** `winner` is the additive session field consumed by the overlay; `getWinnerProfile(query)` is the context interface used by the avatar route.

## Rollback Or Failure Handling

If a Bilibili lookup fails, return an empty avatar URL and retain the text-only winner result. To reverse implementation work, inspect the task-owned diff and remove only these additions with a targeted patch; do not reset or checkout unrelated work.

## Done When

The winner overlay shows the correct host or viewer avatar before the display name when Bilibili provides it, falls back to text without breaking the result card when it does not, never caches avatar data, focused tests and syntax checks pass, and the final diff contains no unrelated changes.
