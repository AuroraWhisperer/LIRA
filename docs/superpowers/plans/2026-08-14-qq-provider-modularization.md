# QQ Provider Modularization Plan

**Goal:** Reduce `qq-provider.js` to the public provider workflow while isolating HTTP/auth transport and pure QQ data transformations.

**Architecture:** Keep `QQMusicProvider` and every existing public method intact. Make it inherit a focused `QQMusicClient` that owns authenticated requests, and move stateless mapping/decoding/normalization helpers into `qq-provider-utils.js`.

**Tech Stack:** CommonJS, Node.js fetch, `node:test`, existing QQ signing and QRC packages

## Constraints

- Preserve the `QQMusicProvider` export and method behavior.
- Preserve request URLs, payloads, headers, signing, fallback order, and error messages.
- Keep helper modules private to the provider implementation.
- Add no dependencies.

### Task 1: Lock the module boundary

**Files:**
- Modify: `test/qq-provider.test.js`

- [x] Add an assertion that the provider inherits the focused client boundary.
- [x] Run the focused assertion and confirm it fails before extraction.

### Task 2: Extract transport and pure helpers

**Files:**
- Modify: `src/music/providers/qq-provider.js`
- Create: `src/music/providers/qq-provider-client.js`
- Create: `src/music/providers/qq-provider-utils.js`

- [x] Move stateless mapping, decoding, cookie, and normalization helpers unchanged.
- [x] Move authenticated request and login guard methods into `QQMusicClient`.
- [x] Move the signed playlist-write HTTP request into the client.
- [x] Keep provider workflows in `QQMusicProvider` and use inheritance for compatibility.

### Task 3: Verify provider behavior

- [x] Run `node --test test/qq-provider.test.js`.
- [x] Run `npm run check` and `npm test`.
