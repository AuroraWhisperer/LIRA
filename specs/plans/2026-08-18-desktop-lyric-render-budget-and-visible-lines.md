# Desktop Lyric Render Budget And Visible Lines

**Goal:** Preserve the existing full-song lyric timeline while reducing repeated rendering work and allowing users to choose how many rows remain visible around the current line.

**Ownership:** Playback/lyrics are owned by `public/js/playback/`, `public/js/admin/`, `public/js/shared/`, and `src/storage/`; the `/lyrics` overlay consumes the shared preview renderer. The focused contract and tests are `docs/architecture/frontend/playback.md`, `docs/architecture/frontend/overlays.md`, and `test/desktop-lyrics.test.js`.

**Constraints:** Keep the existing `/lyrics` URL, WebSocket messages, settings persistence format, full timeline data, visual defaults, and CommonJS/ES-module boundaries. Do not add dependencies or change the server protocol.

## Milestones

1. Add `desktopLyricVisibleLines` setting (default `1`, clamped to a positive integer), expose it in the admin form, serialize/load/autosave it, and verify settings DOM/default coverage.
2. Keep all timeline rows in the DOM but toggle an `is-visible-window` class based on the active index using the even/odd rule: 1 current; 2 current plus next; 3 previous/current/next; 4 previous/current/next two. Verify helper behavior and active-row rendering.
3. Reduce per-frame work by caching the current lyric time and only writing changed progress CSS variables; update timeline classification/countdown only when the active line or a low-frequency time bucket changes. Preserve full precision for the word progress itself.
4. Run focused desktop lyric tests, syntax/quick verification, inspect diff/check, and update overlay/playback architecture notes if the rendered-window behavior needs documenting.

## Done When

- The admin setting persists across reloads and has a minimum of one row.
- `/lyrics` still receives and renders the complete timeline, while only the configured visible window is painted as visible.
- Defaults produce the existing current-line behavior.
- Focused tests and applicable repository verification pass with no unrelated changes.
