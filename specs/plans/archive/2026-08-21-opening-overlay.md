# Opening Overlay Implementation Plan

**Status:** Superseded.

**复核日期：** 2026-09-28。旧实施安排由当前规格、后续实现记录和现状参考承接；不再按旧代码路径执行，也不把未勾选的历史验收补记为通过。

当前依据：[所属规格或参考](../../opening-overlay_design.md)。状态索引见 [计划入口](../README.md)。

## 原始计划与执行记录

以下保留原计划时点的行为、命令和验证记录；它们不覆盖上述状态或当前契约，历史未勾选项不直接等同于当前缺陷。

**Goal:** Add a self-contained `/opening` 1920×1080 Browser Source scene based on `specs/opening-overlay_design.md`, and expose a toolbox control card with the single switch that enables or disables the whole scene effect.

**Non-goals:** No persisted opening settings, no new backend service or WebSocket state, no live audio capture/FFT, no user file picker, and no changes to existing overlay behavior.

**Current behavior:** `public/pages/admin/toolbox/start-animation.html` is an empty toolbox panel. `src/server/http-utils.js` has an explicit overlay page map and frame policy but no `/opening` entry. There is no opening scene asset in `public/img/overlays/opening/`. The existing admin `display.js` owns static overlay URL labels, while the user-requested switch belongs in the toolbox opening-animation panel.

**Ownership:** The overlay route/page is owned by `src/server/http-utils.js` and `public/pages/overlays/`; the toolbox surface is owned by `public/pages/admin/toolbox/start-animation.html` plus `public/js/admin/start-animation.js`; toolbox CSS is composed by `public/css/admin/toolbox.css`. Focused regression coverage belongs in `test/overlays/opening-overlay.test.js` and the existing admin composition tests.

**Compatibility constraints:** Keep the explicit `/opening` route, frameable overlay headers, same-origin asset references, `textContent` for query text, default `audio=none`, `100vh` fallback before `100dvh`, no settings/API writes from the toolbox switch, and existing Admin fragment order and ESM loading conventions.

**Proposed changes:** Add the semantic opening HTML, CSS animation layers, bounded JS scheduler and local placeholder asset files; register the route and `.ogg` MIME; fill the toolbox panel with an accessible master switch, preview/link and copy action; load a dedicated ESM module from the admin bundle; add focused tests for route, security headers, scene structure, configuration safety, lifecycle hooks and switch behavior.

**Milestones:**

1. Static scene and bounded animation shell; verify files, DOM layers, parameters and reduced-motion rules.
2. Route and asset serving; verify `/opening` response, frame policy and MIME types.
3. Toolbox master switch and preview URL; verify no settings write and accessible state feedback.
4. Run focused tests, syntax/quick gates, then review diff/status.

**Verification:** `node --test test/overlays/opening-overlay.test.js test/admin/admin-page-composition.test.js test/admin/frontend-admin-shell.test.js`, `npm run check`, `npm run verify:quick`, `git diff --check`, and `git status --short`.

**Rollback or failure handling:** Inspect the scoped diff and remove only task-owned opening files or revert individual hunks; do not reset the repository or delete shared output directories. If the missing user avatar or licensed music is later supplied, replace only the two local asset files without changing the page contract.

**Done when:** `/opening` loads as an opaque frameable overlay with initial entrance plus idle animation, low/reduced-motion degradation and safe text/audio fallback; the toolbox opening-animation panel has a working master switch and copyable local URL; focused and quick checks pass; no unrelated files or user data are added.
