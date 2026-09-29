# Interactive Tour Copy Implementation Plan

**Status:** Superseded.

**复核日期：** 2026-09-28。旧实施安排由当前规格、后续实现记录和现状参考承接；不再按旧代码路径执行，也不把未勾选的历史验收补记为通过。

当前依据：[所属规格或参考](../../../docs/reference/frontend/interactive-tour.md)。状态索引见 [计划入口](../README.md)。

## 原始计划与执行记录

以下保留原计划时点的行为、命令和验证记录；它们不覆盖上述状态或当前契约，历史未勾选项不直接等同于当前缺陷。

> **For agentic workers:** REQUIRED SUB-SKILL: Use inline execution with the repository verification gates.

**Goal:** Make the first-run tour understandable to主播 users who may be new to desktop software, and keep the step labels in a continuous sequence.

**Architecture:** Keep the existing `TOUR_STEPS` data-driven flow and CSS progress indicator. Change only user-facing Chinese copy, step numbering, and focused assertions; do not change completion checks, navigation targets, or authentication behavior.

**Tech Stack:** Vanilla JavaScript ES modules, Markdown documentation, `node:test`.

## Global Constraints

- Preserve the existing Electron desktop flow, target selectors, public page URLs, localStorage completion key, and no-build ESM loading model.
- Use plain Chinese action words and keep each card focused on one user action.
- Keep progress dots as CSS-rendered status indicators; no bitmap asset is required.

## Current Behavior

`public/js/admin/interactive-tour.js` labels both the room-id and refresh-live cards as `第 2 步 · 连接直播间`. Several cards use implementation-oriented terms such as “连接生效” and “平台区域”, which are less clear to first-time主播 users. `test/admin/interactive-tour.test.js` asserts some of the current wording.

## Ownership

- Owner: `public/js/admin/interactive-tour.js`.
- Supporting design guide: `docs/reference/frontend/interactive-tour.md`.
- Focused tests: `test/admin/interactive-tour.test.js`.

## Proposed Changes

1. Rewrite welcome, login, room, refresh, import, platform, usage, and completion copy around direct user actions and visible outcomes.
2. Renumber refresh-live as step 3, import as step 4, music platform as step 5, and usage guide as step 6.
3. Update focused text assertions and the design guide's flow summary to match the runtime copy.

## Milestones

- [x] Update step copy and numbering, then inspect the diff for accidental behavior changes.
- [x] Update focused assertions and documentation.
- [ ] Run `node --test test/admin/interactive-tour.test.js`, `npm run check`, and `git diff --check`.

## Rollback Or Failure Handling

Inspect the scoped diff and restore only the task-owned files if verification fails; do not reset unrelated worktree changes.

## Done When

Every step has a unique sequential label, the copy tells a novice what to click or enter and what success looks like, progress dots remain CSS-only, focused tests and syntax checks pass, and no unrelated files change.
