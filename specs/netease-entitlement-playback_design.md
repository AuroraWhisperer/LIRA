# Feature: NetEase Entitlement-Aware Playback

## Requirements

- While a NetEase account is logged in, when a song is played, the system shall request a stream using that account's saved Cookie and use the full or trial URL granted by NetEase.
- While an account lacks full-track rights, when NetEase grants a trial clip, the system shall play that official clip instead of rejecting the song solely because it is marked VIP.
- When NetEase grants neither full nor trial playback, the system shall show a clear account-rights error instead of loading an HTML fallback page as audio.
- When browser audio loading fails, the system shall refresh once and retry, then advance safely after the configured retry limit.

## Architecture

### Frontend

- `StreamService` continues to call the local stream-resolution API and assigns the returned URL to the audio element.
- `createStreamHandler` owns a no-argument audio-error callback and receives stable closures for audio lookup, retry playback, and next-track navigation.
- Official trial metadata may be retained on the in-memory track for UI use, but the audio URL remains the source of enforcement.

### Backend

- The existing `POST /api/music/resolve-stream` route remains unchanged.
- `NeteaseMusicProvider.resolvePlayableUrl` calls `/api/song/enhance/player/url/v1` through `requestJson`, which already attaches the encrypted-at-rest Cookie after it is loaded server-side.
- The provider validates the returned URL, derives its expiry, and exposes only the fields needed for playback.

### Security

- Authentication: the upstream request uses the current provider Cookie; the local endpoint's existing application boundary is unchanged.
- Authorization: NetEase is authoritative for full-track versus trial rights; the application does not bypass or synthesize entitlement.
- Input: the provider reuses the normalized numeric source track ID and rejects unsupported URL protocols.
- Output: Cookie values and raw upstream account data never enter the API response or logs.
- Rate limiting: no new public endpoint or request amplification is introduced; existing one-request-per-resolution behavior remains.
- Logging: no playback URL or Cookie is logged because CDN URLs may contain temporary authorization data.

## Implementation Plan

- [x] Add provider regression tests for full, trial, unavailable, and unsafe URL responses.
- [x] Replace the fixed outer URL with the authenticated player-URL response.
- [x] Add browser regression coverage for refresh-and-retry behavior.
- [x] Correct stream-handler callback injection and terminal fallback.
- [x] Run syntax checks and the complete test suite.
