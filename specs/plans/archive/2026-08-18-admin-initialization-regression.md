# Admin Initialization Regression Plan

**Status:** Superseded.

**复核日期：** 2026-09-28。旧实施安排由当前规格、后续实现记录和现状参考承接；不再按旧代码路径执行，也不把未勾选的历史验收补记为通过。

当前依据：[所属规格或参考](../../../docs/reference/frontend/app.md)。状态索引见 [计划入口](../README.md)。

## 原始计划与执行记录

以下保留原计划时点的行为、命令和验证记录；它们不覆盖上述状态或当前契约，历史未勾选项不直接等同于当前缺陷。

## Goal

Restore the Admin page initialization path so gift data, blind-box statistics,
blind-box mappings, and toolbox navigation render and respond after startup.

## Non-goals

Do not change persisted gift data, blind-box configuration, API contracts, or
the visual layout of the gift and toolbox pages.

## Current Behavior

In v3.5.1, `desktopLyricVisibleLines` was added as a standalone number input
but also registered as a range-and-number pair. `FormsService.bindRangePair`
therefore dereferenced the absent `desktopLyricVisibleLinesNumber` element.
The resulting `TypeError` interrupted `initApp` before it subscribed to state,
loaded blind-box statistics, or initialized toolbox navigation.

## Ownership

- Admin composition and initialization: `public/js/admin/app.js`, documented by
  `docs/reference/frontend/app.md`.
- Desktop lyric controls: `public/js/admin/desktop-lyric.js` and
  `public/pages/admin/song/desktop-lyric.html`.
- Focused regression coverage: `test/lyrics/desktop-lyrics.test.js`,
  `test/gifts/frontend-gifts.test.js`, and `test/admin/toolbox-sidebar.test.js`.

## Compatibility Constraints

- Preserve the standalone `desktopLyricVisibleLines` setting and its existing
  persisted key.
- Preserve all gift APIs, current blind-box mappings, and toolbox panel IDs.
- Keep the no-build ESM Admin loading model.

## Proposed Changes

1. Remove the standalone visible-lines number control from the range-pair
   registration list.
2. Add a focused assertion that the standalone control remains present and is
   not registered as a paired range control.

## Verification

1. Run `npm.cmd test -- test/lyrics/desktop-lyrics.test.js test/gifts/frontend-gifts.test.js test/admin/frontend-admin-shell.test.js test/admin/toolbox-sidebar.test.js`.
2. Run `npm.cmd run check` and `npm.cmd run verify:quick`.
3. Open `/admin#gifts` in headless Chromium and verify recent gifts, blind-box
   completion state, and blind-box mapping markup replace their initial shells
   without an uncaught Admin initialization exception.
4. Review `git diff --check`, `git diff`, and `git status --short`.

## Rollback Or Failure Handling

If the focused verification fails, inspect only the scoped Admin lyric control
registration and test assertion. Revert only task-owned lines with a targeted
patch; do not reset the worktree or modify persisted configuration.

## Done When

The Admin initialization completes without the missing control error, gift and
toolbox functionality initializes, focused tests and applicable quick gates
pass, and the final diff contains only the targeted regression fix, coverage,
and this record.
