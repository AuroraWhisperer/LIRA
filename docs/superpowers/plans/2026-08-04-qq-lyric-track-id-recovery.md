# QQ Lyric Track ID Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve QQ Music's numeric song ID across playback restarts and recover it for legacy queue entries so translated and romanized lyrics remain available.

**Architecture:** Keep `sourceSongId` in the existing playback-state track snapshot. When a legacy QQ track reaches the provider without that field, search by its saved title and artist, accept only a candidate with the exact same `songMID`, and then call the rich lyric endpoint with the recovered numeric ID. Advance the lyric cache namespace once so incomplete legacy results are not reused.

**Tech Stack:** Node.js 24, browser ES modules, CommonJS provider modules, `node:test`.

## Global Constraints

- Preserve the repository's two-space indentation, semicolons, and single quotes.
- Add no dependencies and change no unrelated playback behavior.
- Run `npm run check && npm test` before completion.

---

### Task 1: Preserve the Numeric QQ Song ID

**Files:**
- Modify: `public/js/playback/operations/state-persistence.js:25-43`
- Test: `test/playback-queue.test.js`

**Interfaces:**
- Consumes: playback tracks with optional `sourceSongId: number`.
- Produces: queue snapshots whose serialized tracks retain `sourceSongId`.

- [x] **Step 1: Write the failing persistence test**

Create a playback state whose current QQ track has `sourceSongId: 107402287`, flush the saved state, and assert `savedState.current.sourceSongId === 107402287`.

- [x] **Step 2: Run the focused test and verify it fails**

Run: `node --experimental-vm-modules --test --test-name-pattern="numeric QQ song ID" test/playback-queue.test.js`

Expected: FAIL because `serializeTrack()` omits `sourceSongId`.

- [x] **Step 3: Add the missing serialized field**

Add this property beside `sourceTrackId`:

```js
sourceSongId: Math.max(0, Number(track.sourceSongId || track.songId) || 0),
```

- [x] **Step 4: Re-run the focused test**

Expected: PASS.

### Task 2: Recover IDs for Historical Queue Entries

**Files:**
- Modify: `src/music/providers/qq-provider.js:82-128`
- Test: `test/qq-provider.test.js`

**Interfaces:**
- Consumes: a QQ track with `sourceTrackId`, title, and artists but no `sourceSongId`.
- Produces: `resolveSourceSongId(track): Promise<number>` and a rich lyric request using the exact `songMID` match only.

- [x] **Step 1: Write the failing provider test**

Mock QQ search to return `{ id: 107402287, mid: '000w1gfs48CBnw' }`, then mock `GetPlayLyricInfo`. Call `getLyrics()` without `sourceSongId` and assert the rich request contains `songID: 107402287`.

- [x] **Step 2: Run the focused test and verify it fails**

Run: `node --test --test-name-pattern="recovers a missing numeric song ID" test/qq-provider.test.js`

Expected: FAIL because the provider currently goes directly to the legacy lyric endpoint.

- [x] **Step 3: Implement exact-MID recovery**

Before choosing the lyric endpoint, call a helper only when the numeric ID is absent. Build a query from the title and first artist, call `searchTracks(query, { limit: 20 })`, and accept only a result whose `sourceTrackId` exactly equals the requested `sourceTrackId`. If lookup fails or has no exact match, retain the existing legacy fallback.

- [x] **Step 4: Re-run the provider tests**

Run: `node --test test/qq-provider.test.js`

Expected: PASS.

### Task 3: Expire Incomplete Legacy Lyric Cache Entries

**Files:**
- Modify: `src/music/lyrics-service.js:119-128`
- Test: `test/lyrics.test.js`

**Interfaces:**
- Consumes: existing `lyrics-v2` files that may contain empty `translation` and `roma` fields.
- Produces: `lyrics-v3` cache keys populated after ID recovery.

- [x] **Step 1: Write the failing cache-version regression test**

Write an old `lyrics-v2` cache entry into a temporary lyric cache, request the track, and assert the provider is called instead of returning the stale entry.

- [x] **Step 2: Run the focused test and verify it fails**

Run: `node --test --test-name-pattern="ignores incomplete v2 lyric cache" test/lyrics.test.js`

Expected: FAIL while the service still reads `lyrics-v2`.

- [x] **Step 3: Advance the namespace**

Change the cache scope from `lyrics-v2` to `lyrics-v3`; do not delete files or change the 30-day TTL.

- [x] **Step 4: Run all validation**

Run: `npm run check && npm test`

Expected: both commands exit successfully.
