# Feature: QQ Music translated and romanized lyrics

## Requirements

- While a QQ Music track is selected, when lyrics are loaded, the system shall request the original timed lyric, translation, and romanization in one upstream call.
- When QQ Music returns encrypted lyric payloads, the system shall decrypt them before parsing and caching.
- When translation or romanization data is present, the existing fullscreen lyric controls shall display it without another network request.
- When the richer lyric endpoint is unavailable, the system shall fall back to the existing public lyric endpoint so original lyrics continue to work.

## Architecture

### Frontend

- Reuse the existing fullscreen `translation` and `roma` line fields and toggle controls.
- Keep HTML escaping and disabled states already implemented by the lyric renderer.

### Backend

- Request `music.musichallSong.PlayLyricInfo.GetPlayLyricInfo` through the existing public `musicu.fcg` client.
- Send only normalized track metadata and the `qrc`, `trans`, `roma`, and `crypt` feature flags.
- Validate and QRC-decrypt each hexadecimal payload, unwrap the QRC XML when present, then pass original, translation, romanization, and word timing to the shared lyric parser.
- Preserve the legacy lyric endpoint as a compatibility fallback.

### Security

- Do not copy cookies, tokens, account identifiers, `Sign`, or `Mask` values from the HAR.
- Validate the QQ track MID and numeric song ID before including them in an upstream request.
- Return only normalized lyric lines to the browser; never expose upstream credentials or raw response metadata.
- Bound upstream requests with the existing timeout and cache the normalized result.

## Implementation Plan

- [x] Add encrypted QRC decoding support with a pinned dependency.
- [x] Implement and validate the richer QQ lyric request and response mapping.
- [x] Add legacy fallback behavior.
- [x] Add provider and parser regression tests for original, translation, romanization, missing fields, and upstream failure.
- [x] Run static checks and the full test suite.
