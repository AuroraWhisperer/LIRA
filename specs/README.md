# Specification Lifecycle

Specifications define required behavior and acceptance criteria. Implementation
plans define how risky work is delivered. A plan may sequence or clarify
implementation, but it cannot redefine an accepted specification.

## Index

<!-- SPEC_INDEX_START -->
| Document | Type | Status | Runtime Evidence | Last Reviewed |
|---|---|---|---|---|
| `specs/bilibili-user-info-service_design.md` | Design specification | Implemented | `src/bilibili/users/user-info-service.js`<br>`src/bilibili/users/profile-provider.js`<br>`src/bilibili/danmaku-client.js`<br>`src/bilibili/danmaku/history-poller.js`<br>`src/bilibili/danmaku/online-rank-poller.js`<br>`src/bilibili/danmaku/fans-medal-poller.js`<br>`src/bilibili/parsers/superchat-parser.js`<br>`test/bilibili-user-info-service.test.js`<br>`test/bilibili-user-info-pollers.test.js` | 2026-08-21 |
| `specs/danmaku-draw-guess_design.md` | Design specification | Implemented | `src/games/draw-guess.js`<br>`src/games/game-session-service.js`<br>`public/js/admin/games.js`<br>`public/js/overlays/games.js`<br>`test/games.test.js` | 2026-08-20 |
| `specs/song-request-board-style-3_design.md` | Design specification | Implemented | `public/js/overlays/queue.js`<br>`public/js/overlays/queue-render.js`<br>`public/css/overlays/base/storybook.css`<br>`test/frontend-queue.test.js` | 2026-08-20 |
| `specs/queue-style-settings-isolation_design.md` | Design specification | Implemented | `src/storage/settings-store.js`<br>`public/js/admin/theme.js`<br>`public/js/overlays/queue.js`<br>`test/frontend-queue.test.js` | 2026-08-23 |
| `specs/desktop-lyric-preview_reverse_spec.md` | Reverse specification | Reference | `src/music/lyric-state.js`<br>`public/js/admin/desktop-lyric-preview.js`<br>`test/desktop-lyrics.test.js` | 2026-08-16 |
| `specs/desktop-hardware-summary_design.md` | Design specification | Implemented | `src/server/system-metrics.js`<br>`public/js/admin/metrics.js`<br>`test/system-metrics.test.js` | 2026-08-19 |
| `specs/desktop-lyric-timeline_design.md` | Design specification | Implemented | `src/music/lyric-timeline.js`<br>`public/js/admin/desktop-lyric-preview.js`<br>`test/desktop-lyrics.test.js` | 2026-08-16 |
| `specs/games-single-overlay-session_design.md` | Design specification | Implemented | `src/games/game-session-service.js`<br>`public/js/overlays/games.js`<br>`public/js/admin/games.js`<br>`test/game-routes.test.js`<br>`test/games-overlay.test.js` | 2026-08-18 |
| `specs/gift-effects-frame-overlay_design.md` | Design specification | Draft | `public/pages/overlays/gift-effects.html`<br>`public/js/overlays/gift-effects.js`<br>`public/css/overlays/gift-effects.css`<br>`test/gift-effects-overlay.test.js` | 2026-08-21 |
| `specs/opening-overlay_design.md` | Design specification | Draft | `src/server/http-utils.js`<br>`public/pages/overlays/overtime.html`<br>`public/css/overlays/overtime.css`<br>`public/js/admin/display.js`<br>`test/overtime-overlay.test.js` | 2026-08-21 |
| `specs/opening-track-motion_design.md` | Design specification | Implemented | `public/js/admin/start-animation.js`<br>`public/js/overlays/opening.js`<br>`src/server/routes/opening-routes.js`<br>`test/opening-overlay.test.js` | 2026-08-23 |
| `specs/model-provider-capabilities_design.md` | Design specification | Implemented | `src/ai/deepseek-client.js`<br>`public/js/admin/ai-assistant-settings.js`<br>`test/ai-provider-adapters.test.js` | 2026-08-17 |
| `specs/netease-entitlement-playback_design.md` | Design specification | Implemented | `src/music/providers/netease-provider.js`<br>`public/js/playback/operations/provider-operations.js`<br>`test/netease-provider.test.js` | 2026-08-16 |
| `specs/now-playing-wesing_reverse_spec.md` | Reverse specification | Reference | `src/music/wesing-capture-engine.js`<br>`src/music/wesing-online-lyrics.js`<br>`test/wesing-capture.test.js` | 2026-08-16 |
| `specs/overtime-gift-sale-refresh_design.md` | Design specification | Implemented | `src/bilibili/gift/sale-catalog.js`<br>`src/server/routes/overtime-routes.js`<br>`test/gift-sale-catalog.test.js` | 2026-08-16 |
| `specs/overtime-rule-quantity-mode_design.md` | Design specification | Implemented | `src/overtime/overtime-service.js`<br>`public/js/admin/overtime-rule-editor.js`<br>`test/overtime-service.test.js` | 2026-08-16 |
| `specs/overtime-text-display_design.md` | Design specification | Implemented | `src/overtime/overtime-contract.js`<br>`src/overtime/overtime-service.js`<br>`public/js/admin/overtime-rule-editor.js`<br>`public/js/overlays/overtime.js`<br>`test/overtime-service.test.js` | 2026-08-22 |
| `specs/qixi-que-box-default_design.md` | Design specification | Implemented | `src/storage/settings-store.js`<br>`public/js/admin/gifts/recent.js`<br>`test/blind-box-defaults.test.js` | 2026-08-16 |
| `specs/wesing-live-lyrics_design.md` | Design specification | Implemented | `src/music/wesing-capture.js`<br>`public/js/playback/services/wesing-service.js`<br>`test/playback-wesing.test.js` | 2026-08-16 |
| `specs/wesing-lyric-source-selection_design.md` | Design specification | Implemented | `src/music/wesing-online-lyrics.js`<br>`public/js/admin/desktop-lyric.js`<br>`test/wesing-online-lyrics.test.js` | 2026-08-16 |
| `specs/wesing-lyric-sync-controls_design.md` | Design specification | Implemented | `src/music/wesing-capture-engine.js`<br>`src/server/routes/wesing-routes.js`<br>`test/wesing-capture.test.js` | 2026-08-16 |
<!-- SPEC_INDEX_END -->

## Status Vocabulary

- `Draft`: requirements are still being explored and are not approved.
- `Accepted`: requirements are approved but implementation has not started.
- `In Progress`: implementation or acceptance behavior is only partially present.
- `Implemented`: source and tests demonstrate the acceptance behavior.
- `Reference`: reverse-engineered current behavior whose described runtime paths
  still exist.
- `Superseded`: a newer named specification replaces this document.

Changelog text is supporting evidence, not sufficient evidence by itself. A
reverse specification may be `Reference` only while its described runtime paths
exist. A design may be `Implemented` only when source and tests demonstrate its
acceptance behavior; partial behavior is `In Progress`.

## When A New Specification Is Required

Create a specification when the requested target behavior is new, materially
changes a public or persisted contract, changes user-visible security or
compatibility guarantees, or has acceptance criteria that cannot be derived from
an accepted owner document. A local bug with already-defined intended behavior
usually needs a regression test, not a new specification.

Use [the planning standard](../PLANS.md) separately when implementation risk
requires milestones, rollback handling, or cross-owner coordination.

## Specification Template

```markdown
# Feature: <name>

## Goal

State the required user-visible outcome.

## Context

Describe the current behavior, evidence, and reason for change.

## Constraints

List platform, dependency, data, and implementation constraints.

## Non-goals

List adjacent behavior that will not change.

## Architecture

Name owners, contracts, data flow, and responsibility boundaries.

## Security

Define trust boundaries, validation, privileges, secrets, and failure behavior.

## Compatibility

List public and persisted contracts that must remain compatible or explicitly
describe approved changes.

## Acceptance Criteria

List observable, testable required behavior.

## Done When

Define the evidence required to mark the specification implemented.
```
