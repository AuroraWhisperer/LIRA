# NetEase Search Artwork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each NetEase search result with its real album artwork instead of a shared artist-avatar fallback.

**Architecture:** Keep the existing `/api/search/get/web` request as the source of search metadata. After it returns a page of songs, make one `/api/song/detail` request containing the result song IDs, map `songs[].al.picUrl` by ID, and inject those URLs before the existing `mapNeteaseSong` fallback is applied. If the detail request fails or omits an entry, search must still succeed with the current artist-avatar or no-artwork behavior.

**Tech Stack:** Node.js CommonJS, built-in `fetch`, `node:test`, `node:assert/strict`.

## Global Constraints

- Use Node.js 24 or newer and no new dependencies.
- Preserve the existing `NeteaseMusicProvider` public API and search pagination behavior.
- Request artwork details once per search page, never once per song.
- Leave the existing artist-avatar fallback active when an album cover is unavailable.
- Verify with `npm run check && npm test`.

---

### Task 1: Cover enrichment in NetEase searches

**Files:**
- Modify: `src/music/providers/netease-provider.js:59-76`
- Test: `test/netease-provider.test.js`

**Interfaces:**
- Consumes: `NeteaseMusicProvider.requestJson(pathname, params)` and raw search songs with numeric `id` fields.
- Produces: `NeteaseMusicProvider.searchTracks(keyword, options)` returning the current normalized track shape, with `coverUrl` populated from detail `al.picUrl` when available.

- [ ] **Step 1: Write the failing test**

```js
test('Netease search enriches result artwork with one batched song-detail request', async () => {
  const provider = createProvider();
  const requests = [];
  provider.requestJson = async (pathname, params) => {
    requests.push({ pathname, params });
    if (pathname === '/api/search/get/web') {
      return { result: { songs: [{ id: 11, name: 'A', album: { id: 1, name: 'Old' }, artists: [{ name: 'Singer', img1v1Url: 'https://artist.test/a.jpg' }] }] } };
    }
    return { songs: [{ id: 11, al: { picUrl: 'https://album.test/a.jpg' } }] };
  };

  const tracks = await provider.searchTracks('A', { limit: 9 });

  assert.equal(requests[1].pathname, '/api/song/detail');
  assert.equal(requests[1].params.ids, '[11]');
  assert.equal(tracks[0].coverUrl, 'https://album.test/a.jpg');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/netease-provider.test.js`

Expected: FAIL because `searchTracks` currently makes only the search request and returns the artist-avatar fallback.

- [ ] **Step 3: Write minimal implementation**

```js
const coverUrls = await this.getSearchCoverUrls(songs);
return songs.map((song) => mapNeteaseSong(song, coverUrls.get(String(song.id)))).filter(Boolean);
```

Add `getSearchCoverUrls(songs)` to collect unique numeric IDs, issue `requestJson('/api/song/detail', { ids: JSON.stringify(ids) })`, and return a `Map` of non-empty `al.picUrl` values keyed by song ID. Extend `mapNeteaseSong(song, searchCoverUrl)` so the detail cover has priority over `album.picUrl`, then preserve the artist-avatar fallback.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/netease-provider.test.js`

Expected: PASS, including the single batched request and real album artwork assertion.

- [ ] **Step 5: Commit**

```bash
git add src/music/providers/netease-provider.js test/netease-provider.test.js
git commit -m "fix: enrich netease search artwork"
```

### Task 2: Graceful fallback for unavailable detail data

**Files:**
- Modify: `src/music/providers/netease-provider.js:59-76`
- Test: `test/netease-provider.test.js`

**Interfaces:**
- Consumes: `getSearchCoverUrls(songs)` and a rejected or incomplete `/api/song/detail` response.
- Produces: successful search results retaining `artists[0].img1v1Url` when the detail cover cannot be read.

- [ ] **Step 1: Write the failing test**

```js
test('Netease search preserves artist artwork when song-detail lookup fails', async () => {
  const provider = createProvider();
  provider.requestJson = async (pathname) => pathname === '/api/search/get/web'
    ? { result: { songs: [{ id: 11, name: 'A', album: { id: 1, name: 'Old' }, artists: [{ name: 'Singer', img1v1Url: 'https://artist.test/a.jpg' }] }] } }
    : Promise.reject(new Error('HTTP 500'));

  const tracks = await provider.searchTracks('A');

  assert.equal(tracks[0].coverUrl, 'https://artist.test/a.jpg');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/netease-provider.test.js`

Expected: FAIL because an unhandled detail lookup error would reject the search.

- [ ] **Step 3: Write minimal implementation**

```js
try {
  const data = await this.requestJson('/api/song/detail', { ids: JSON.stringify(ids) });
  return extractNeteaseCoverUrls(data);
} catch (_) {
  return new Map();
}
```

Ensure `getSearchCoverUrls` returns an empty map for an empty song page, an invalid detail response, or a failed detail request.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/netease-provider.test.js`

Expected: PASS, and the fallback artwork assertion succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/music/providers/netease-provider.js test/netease-provider.test.js
git commit -m "test: cover netease artwork fallback"
```

### Task 3: Whole-repository verification

**Files:**
- Verify: `src/music/providers/netease-provider.js`
- Verify: `test/netease-provider.test.js`

**Interfaces:**
- Consumes: the finished provider implementation and test suite.
- Produces: syntax-valid code and a passing serial Node test suite.

- [ ] **Step 1: Run static validation**

Run: `npm run check`

Expected: PASS with no JavaScript syntax errors.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`

Expected: PASS with no regressions.

- [ ] **Step 3: Inspect the scoped diff**

Run: `git diff -- src/music/providers/netease-provider.js test/netease-provider.test.js`

Expected: only the batched detail lookup, its fallbacks, and regression tests are present.

- [ ] **Step 4: Commit**

```bash
git add src/music/providers/netease-provider.js test/netease-provider.test.js
git commit -m "fix: show netease album artwork in search"
```
