# Desktop Lyric Render Budget And Visible Lines

**Status:** Superseded.

**复核日期：** 2026-09-28。旧实施安排由当前规格、后续实现记录和现状参考承接；不再按旧代码路径执行，也不把未勾选的历史验收补记为通过。

当前依据：[所属规格或参考](../../../docs/reference/frontend/overlays.md)。状态索引见 [计划入口](../README.md)。

## 原始计划与执行记录

以下保留原计划时点的行为、命令和验证记录；它们不覆盖上述状态或当前契约，历史未勾选项不直接等同于当前缺陷。

**Goal:** Preserve the existing full-song lyric timeline while reducing repeated rendering work and allowing users to choose how many rows remain visible around the current line.

**Ownership:** Playback/lyrics are owned by `public/js/playback/`, `public/js/admin/`, `public/js/shared/`, and `src/storage/`; the `/lyrics` overlay consumes the shared preview renderer. The focused contract and tests are `docs/reference/frontend/playback.md`, `docs/reference/frontend/overlays.md`, and `test/lyrics/desktop-lyrics.test.js`.

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
