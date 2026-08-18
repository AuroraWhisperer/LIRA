# WeSing Lyric Artist Matching Implementation Plan

**Goal:** Extract the currently playing artist from WeSing cache metadata when available and use it in online lyric search and candidate ranking so same-title covers no longer default to the first result.

**Architecture:** Keep `wesing-capture-engine` as the state owner. Extend the existing cache/log reader with optional artist metadata, pass that value through the existing fallback resolver interface, and reuse `scoreTrackMatch` for title/artist/duration ranking. No new process, API, storage key, or provider contract is introduced.

**Tech Stack:** Node.js CommonJS, existing WeSing cache parser, `node:test`.

## Constraints

- Preserve the current local-QRC-first behavior and fallback behavior when artist metadata is absent.
- Preserve existing public HTTP, WebSocket, settings, and persisted-data contracts.
- Keep changes scoped to `src/music/` and focused tests/docs.

## Current Behavior

- The monitor exposes title and duration but no artist.
- `refreshLyrics()` calls the fallback with `{ title, durationMs }` only.
- `wesing-online-lyrics.js` searches each provider with `keyword: title`, ranks candidates without an artist, and selects the top result.
- `findLatestSongEntry()` already reads `StartKSong` metadata but returns only `mid` and `songName`.

## Proposed Changes

- Parse optional artist/singer fields from `StartKSong` rows and expose them as `artists` without rejecting older rows.
- In the capture refresh path, read the latest matching log metadata and pass `artists`/`artist` to the fallback resolver.
- Build provider search keywords from title and artist when artist is known; rank candidates with the known artist and retain duration/version penalties.
- Add regression tests for metadata extraction, fallback input propagation, search keyword construction, and same-title candidate selection.

## Verification

1. `node --test test/wesing-online-lyrics.test.js test/wesing-capture.test.js`
2. `npm run check`
3. `npm run verify:quick`
4. Review `git diff --check` and `git status --short`; do not alter unrelated worktree changes.

## Done When

- A `StartKSong` row containing a singer yields a non-empty artist in the fallback input.
- Search requests include the artist when present and the correct same-title artist wins over an earlier cover.
- Existing no-artist, local-QRC, provider-failure, and preference tests remain green.
