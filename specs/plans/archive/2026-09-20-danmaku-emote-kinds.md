# Danmaku Emote Kinds Implementation Plan

**Status:** Complete, 2026-09-20. Existing motion-test failure and temporary-file cleanup limitation recorded below.

**Goal:** Display inline emotes, including a standalone 喝彩, at the text font size; display whole-message stickers at 1.4 times their previous size.

**Architecture:** Preserve the upstream distinction in each emote's optional `kind` field (`inline` or `sticker`). Keep existing parsers, feed projections, renderers and CSS owners in both LIRA and the adjacent LIRA Server repository.

**Tech stack:** Existing CommonJS parsers, no-build ESM renderers, native CSS, node:test and Playwright.

## Boundaries and compatibility

- `emots` entries are inline; `emoticon` and metadata slot 13 are stickers. Keep existing source precedence, image allowlists, dimensions and text fallback.
- New producers emit `kind`; legacy payloads without it retain the existing whole-message classification. Unknown kinds do not become a trusted type.
- The additive public field requires the server OpenAPI, protocol, requirement, acceptance and fixture to change together. No endpoint, auth, tenant, persistence, architecture or dependency changes.
- Scope excludes deployment, packaging, unrelated themes, gift notices and game styling. No commits or branches.

## Current behavior and ownership

Both parsers discard emote source type. The shared renderers mark every single-emote message `is-emote-only`, including small inline emotes. Base CSS uses 1.85em / 3.2em; ranked and identity use 1.75em / 4.1em.

- Client: `src/bilibili/parsers/danmaku-parser.js`, `src/bilibili/danmaku/feed-buffer.js`, `src/server/overlay-projection.js`, `public/js/overlays/danmaku-message-renderer.js`, `public/js/overlays/danmaku.js`, and the base/ranked/identity danmaku CSS owners.
- Server: `src/lib/bilibili-danmaku.js`, `public/overlay/app.js` (SSE normalization), `public/overlay/danmaku-message-renderer.js`, and corresponding CSS owners.
- Contracts: client Bilibili protocol and overlay architecture docs; server `REQ-BILI-006`, `AC-BILI-005`, and public overlay API/OpenAPI.

## Implementation and verification

- [x] Add focused regression cases for the same trigger/image dimensions delivered through inline versus sticker metadata, including standalone and repeated inline emotes. For example:
  ```js
  assert.equal(extractBilibiliDanmakuEmotes(info)[0].kind, 'inline');
  assert.doesNotMatch(render(inlineMessage).className, /is-emote-only/);
  assert.match(render(stickerMessage).className, /is-emote-only/);
  ```
- [x] Emit and preserve `kind` through both pipelines; normalize only `inline` and `sticker`. Require `kind !== 'inline'` for whole-message enlargement. Label preview text emotes inline and the existing standalone image sticker.
- [x] Set small emotes to 1em; change sticker height 3.2em → 4.48em and ranked/identity 4.1em → 5.74em. Keep aspect ratio, width limits and failure fallback.
- [x] Update the owning contracts and a synthetic emote fixture, and assert schema acceptance for both typed and legacy messages.
- [x] Run client focused tests: `node --experimental-vm-modules --test test/bilibili-danmaku-parser.test.js test/danmaku-client.test.js test/danmaku-feed-buffer.test.js test/overlay-projection.test.js test/danmaku-overlay-renderer.test.js test/danmaku-local-preview.test.js test/danmaku-style-ownership.test.js`.
- [x] Run server focused parser, RoomMonitor, protocol and renderer checks with `node --require ./test/support/test-mode.cjs --test`, plus affected documentation/architecture gates.
- [x] Verify actual computed image/font sizes across all nine styles using synthetic messages and isolated browser state. Review one screenshot with inline, standalone-inline and sticker messages. Check missing type and failed images as compatibility cases. Reuse the existing browser test infrastructure; do not launch the user's app or access real data.
- [x] Inspect both diffs, run `git diff --check` and inspect `git status --short`. Archive this plan with verification outcomes.

## Failure handling and completion

If a check fails, correct only the owning behavior or stop with the specific limitation. Undo only task-owned hunks if necessary; never reset either repository. Done when both pipelines distinguish sources, small emotes remain at 1em, sticker scaling is verified, compatibility and image safety checks pass, docs agree, and task-owned hunks remain within scope while preserving unrelated workspace changes.

## Completion evidence

- Client focused suite: 44 passed. JavaScript syntax gate: 923 files passed. Documentation governance: 5 passed.
- Server focused parser, RoomMonitor, renderer, preview, protocol, documentation and architecture suite: 68 passed. The affected preview/protocol tests were repeated after the SSE normalizer edit: 19 passed. Changed server JavaScript syntax checks passed.
- Browser size regression passed across all nine styles, exercising parsed inline/standalone/repeated emotes and slot-13 stickers. Measured heights are 1em, 4.48em and 5.74em as applicable; image proportions and container fit passed. Signal and ranked screenshots were visually reviewed.
- Existing motion suite: 40 passed, one existing failure (`failed image resize is compensated before the next paint`). The same assertion fails with unmodified HEAD app/renderer/CSS served to an isolated Playwright page at the test viewport. This unrelated baseline behavior was not changed; image failure still falls back to text.
- Isolated browser processes and contexts were closed and the test server stopped. Automatic approval rejected cleanup of the task's temporary test files with `blocked by policy`; the uniquely named `emote-kinds-20260920` files remain under the system temp directory.
- No deployment, release, branch or commit was performed.
