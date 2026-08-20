# QQ Paid Playback Quality Implementation Plan

## Goal

Make QQ Music Standard, HQ, and SQ switching reliably use the authenticated
subscriber playback path while preserving the song type observed in the
provided HAR. Keep automatic fallback to the best playable browser-compatible
stream when the account or track lacks the requested entitlement.

## Non-goals

- Do not expose Dolby, Master Tape 4.0, Premium Sound, or Panoramic Sound 3.0.
  The HAR shows QQ-specific encrypted `.mgg` / `.mflac` media and does not
  provide a Chromium-compatible decode or DSP contract for those modes.
- Do not add a native decoder, DRM bypass, external process, runtime
  dependency, or frontend framework.
- Do not change the existing `/api/music/resolve-stream` request or response
  shape beyond retaining an additive track metadata field.

## Current Behavior

- The playback UI already exposes QQ Standard (`M500` MP3), HQ (`M800` MP3),
  and SQ (`F000` FLAC), refreshes the current stream, resumes the prior
  position, and persists the provider preference.
- The QQ provider sends authenticated cookies and batches requested quality
  candidates from best to fallback quality.
- The provider currently hard-codes every QQ `songtype` value to `0`.
- The supplied HAR records the paid song as `songtype: 1` for both
  `music.vkey.GetEVkey/CgiGetEVkey` requests. The captured `Q0...mflac` and
  `O8...mgg` resources are encrypted QQ media, so returning their URLs to the
  renderer would not make them playable through Chromium's `<audio>` element.

## Ownership

- Owner: `src/music/providers/qq-provider.js`,
  `src/music/providers/qq-provider-utils.js`, and `src/music/track-contract.js`.
- Contract: `docs/architecture/backend/music/qq-provider.md`,
  `docs/architecture/backend/music/services.md`, and
  `docs/architecture/frontend/playback.md`.
- Consumers: `src/music/stream-resolver.js`, `public/js/playback/`, and
  `src/server/routes/playback-routes.js`.
- Focused tests: `test/qq-provider.test.js`, `test/lyrics.test.js`,
  `test/playback-quality.test.js`, and `test/playback-persistence.test.js`.

## Compatibility Constraints

- Preserve Standard / HQ / SQ quality IDs and labels, playback state keys,
  stream response fields, cookies, login behavior, and automatic fallback.
- Preserve Electron context isolation and the existing authenticated Cookie
  source; never copy credentials from the HAR into source or tests.
- Treat `sourceSongType` as optional additive metadata and default old/restored
  tracks to `0`.
- Preserve all unrelated working-tree changes.

## Proposed Changes

- Map QQ's numeric song type into `sourceSongType` when normalizing upstream
  songs.
- Retain `sourceSongType` through backend normalization, renderer
  normalization, provider serialization, and playback-state persistence.
- Use that value for each quality candidate's `songtype` instead of always
  sending `0`.
- Add regression coverage for mapping, provider forwarding, persistence, and
  fallback compatibility.
- Update the QQ upstream contract and playback documentation with the supported
  quality boundary and HAR-derived song-type behavior.

## Milestones

1. Add failing tests for a `sourceSongType: 1` QQ track reaching the provider
   request and surviving playback persistence.
   - Verify: `node --test test/qq-provider.test.js test/lyrics.test.js test/playback-persistence.test.js`
2. Implement the minimum metadata propagation and provider request change.
   - Verify: rerun the same focused tests plus
     `node --test test/playback-quality.test.js`.
3. Update owner documentation and run repository gates.
   - Verify: `npm run verify:docs`, `npm run check`, and `npm run verify:quick`.

## Verification

- `node --test test/qq-provider.test.js test/lyrics.test.js test/playback-persistence.test.js test/playback-quality.test.js`
- `npm run verify:docs`
- `npm run check`
- `npm run verify:quick`
- `git diff --check`
- `git diff -- src/music/providers/qq-provider.js src/music/providers/qq-provider-utils.js src/music/track-contract.js public/js/playback/utils.js public/js/playback/operations/state-persistence.js test/qq-provider.test.js test/lyrics.test.js test/playback-persistence.test.js docs/architecture/backend/music/qq-provider.md docs/architecture/frontend/playback.md specs/plans/2026-08-20-qq-paid-playback-quality.md`
- `git status --short`

Verification result (2026-08-20): focused backend tests passed 21/21;
focused renderer tests passed 7/7 with `--experimental-vm-modules`;
`npm run verify:docs`, `npm run check`, and `npm run verify:quick` passed;
`npm test` passed 717 tests with 1 skip and 0 failures; `git diff --check`
reported no whitespace errors.

## Rollback Or Failure Handling

Stop after the first failing gate, inspect only the files listed above, and
reverse only task-owned lines with a targeted patch. Do not use blanket restore,
checkout, reset, or deletion commands. Leave the supplied HAR and unrelated
working-tree changes untouched.

## Done When

- A QQ track carrying `sourceSongType: 1` sends `songtype: [1, ...]` for all
  requested Standard / HQ / SQ candidates.
- Older tracks without the field continue to send `0` and retain existing
  fallback behavior.
- The field survives renderer serialization and persisted playback state.
- Focused tests and applicable quick gates pass.
- Documentation states that encrypted QQ-exclusive spatial / premium modes are
  outside the current Chromium playback boundary.
- Final diff review contains no HAR credentials, generated output, or unrelated
  edits.
