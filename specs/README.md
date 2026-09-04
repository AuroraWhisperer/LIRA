# Specification Lifecycle

Specifications define required behavior and acceptance criteria. Implementation
plans define how risky work is delivered. A plan may sequence or clarify
implementation, but it cannot redefine an accepted specification.

## Index

<!-- SPEC_INDEX_START -->

| Document                                         | Type                  | Status      | Runtime Evidence                                                                                                                                                                                                                                                                                                                                                                                             | Last Reviewed |
| ------------------------------------------------ | --------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| `specs/gift-ledger-projection-sync_design.md` | Design specification | Implemented | `src/storage/gift-sync-store.js`<br>`src/electron/remote-gift-controller.js`<br>`src/electron/license/remote-license-client.js`<br>`src/electron/desktop-runtime.js`<br>`src/electron/main.js`<br>`src/bilibili/gift/query-service.js`<br>`src/server/routes/gift-routes.js`<br>`public/js/admin/gifts/history.js`<br>`test/gift-sync-store.test.js`<br>`test/processed-gift-import.test.js`<br>`test/remote-gift-controller.test.js`<br>`test/gift-query-service.test.js`<br>`test/gift-ledger-maintenance.test.js`<br>`test/cloud-runtime-sync.test.js` | 2026-09-04 |
| `specs/cloud-authoritative-streamer-sync_design.md` | Design specification | Implemented | `src/electron/cloud-sync-controller.js`<br>`src/electron/bilibili-auth.js`<br>`src/electron/license/license-manager.js`<br>`src/electron/main.js`<br>`src/server.js`<br>`src/server/routes/settings-routes.js`<br>`src/server/routes/song-routes.js`<br>`test/cloud-runtime-sync.test.js`<br>`test/cloud-sync-controller.test.js`<br>`test/song-delete.test.js` | 2026-08-30 |
| `specs/server-authoritative-gift-detection_design.md` | Design specification | Implemented | `src/shared/processed-gift-contract.js`<br>`src/bilibili/gift/detection-service.js`<br>`src/electron/remote-gift-controller.js`<br>`src/electron/license/remote-license-client.js`<br>`src/electron/main.js`<br>`test/processed-gift-import.test.js`<br>`test/remote-gift-controller.test.js`<br>`test/remote-license-client.test.js` | 2026-08-30 |
| `specs/danmaku-fullscreen-random_design.md` | Design specification | Implemented | `src/storage/settings-defaults.js`<br>`src/server/routes/settings-routes.js`<br>`public/pages/admin/toolbox/danmaku.html`<br>`public/js/admin/danmaku-tool.js`<br>`public/pages/overlays/danmaku.html`<br>`public/js/overlays/danmaku.js`<br>`public/js/overlays/danmaku-feed.js`<br>`public/css/overlays/danmaku.css`<br>`test/danmaku-overlay-settings.test.js`<br>`test/danmaku-overlay.test.js`<br>`test/frontend-admin-ai.test.js`<br>`test/toolbox-sidebar.test.js` | 2026-08-30 |
| `specs/license-p0-hardening_design.md`           | Design specification  | Implemented | `src/electron/license/license-manager.js`<br>`src/electron/main.js`<br>`test/license-manager.test.js`<br>`test/license-protocol.test.js`                                                                                                                                                                                                                                                                     | 2026-08-29    |
| `specs/clock-stable-url_design.md`               | Design specification  | Implemented | `src/server/routes/clock-routes.js`<br>`public/js/admin/clock-card.js`<br>`public/js/overlays/clock.js`<br>`test/clock-overlay.test.js`                                                                                                                                                                                                                                                                      | 2026-08-24    |
| `specs/bilibili-user-info-service_design.md`     | Design specification  | Implemented | `src/bilibili/users/user-info-service.js`<br>`src/bilibili/users/profile-provider.js`<br>`src/bilibili/danmaku-client.js`<br>`src/bilibili/danmaku/history-poller.js`<br>`src/bilibili/danmaku/online-rank-poller.js`<br>`src/bilibili/danmaku/fans-medal-poller.js`<br>`src/bilibili/parsers/superchat-parser.js`<br>`test/bilibili-user-info-service.test.js`<br>`test/bilibili-user-info-pollers.test.js` | 2026-08-21    |
| `specs/danmaku-draw-guess_design.md`             | Design specification  | Implemented | `src/games/draw-guess.js`<br>`src/games/game-session-service.js`<br>`public/js/admin/games.js`<br>`public/js/overlays/games.js`<br>`test/games.test.js`                                                                                                                                                                                                                                                      | 2026-08-20    |
| `specs/song-request-board-style-3_design.md`     | Design specification  | Implemented | `public/js/overlays/queue.js`<br>`public/js/overlays/queue-render.js`<br>`public/css/overlays/base/storybook.css`<br>`test/frontend-queue.test.js`                                                                                                                                                                                                                                                           | 2026-08-20    |
| `specs/queue-style-settings-isolation_design.md` | Design specification  | Implemented | `src/storage/settings-store.js`<br>`public/js/admin/theme.js`<br>`public/js/overlays/queue.js`<br>`test/frontend-queue.test.js`                                                                                                                                                                                                                                                                              | 2026-08-23    |
| `specs/desktop-lyric-preview_reverse_spec.md`    | Reverse specification | Reference   | `src/music/lyric-state.js`<br>`public/js/admin/desktop-lyric-preview.js`<br>`test/desktop-lyrics.test.js`                                                                                                                                                                                                                                                                                                    | 2026-08-16    |
| `specs/desktop-hardware-summary_design.md`       | Design specification  | Implemented | `src/server/system-metrics.js`<br>`public/js/admin/metrics.js`<br>`test/system-metrics.test.js`                                                                                                                                                                                                                                                                                                              | 2026-08-19    |
| `specs/desktop-lyric-timeline_design.md`         | Design specification  | Implemented | `src/music/lyric-timeline.js`<br>`public/js/admin/desktop-lyric-preview.js`<br>`test/desktop-lyrics.test.js`                                                                                                                                                                                                                                                                                                 | 2026-08-16    |
| `specs/games-single-overlay-session_design.md`   | Design specification  | Implemented | `src/games/game-session-service.js`<br>`public/js/overlays/games.js`<br>`public/js/admin/games.js`<br>`test/game-routes.test.js`<br>`test/games-overlay.test.js`                                                                                                                                                                                                                                             | 2026-08-18    |
| `specs/gift-effects-frame-overlay_design.md`     | Design specification  | Draft       | `public/pages/overlays/gift-effects.html`<br>`public/js/overlays/gift-effects.js`<br>`public/css/overlays/gift-effects.css`<br>`test/gift-effects-overlay.test.js`                                                                                                                                                                                                                                           | 2026-08-23    |
| `specs/opening-overlay_design.md`                | Design specification  | Draft       | `src/server/http-utils.js`<br>`public/pages/overlays/overtime.html`<br>`public/css/overlays/overtime.css`<br>`public/js/admin/display.js`<br>`test/overtime-overlay.test.js`                                                                                                                                                                                                                                 | 2026-08-21    |
| `specs/opening-character-upload_design.md`       | Design specification  | Implemented | `src/server/routes/opening-routes.js`<br>`src/server/http-utils.js`<br>`public/js/admin/start-animation.js`<br>`public/js/overlays/opening.js`<br>`test/opening-overlay.test.js`                                                                                                                                                                                                                             | 2026-08-24    |
| `specs/opening-track-motion_design.md`           | Design specification  | Implemented | `public/js/admin/start-animation.js`<br>`public/js/overlays/opening.js`<br>`src/server/routes/opening-routes.js`<br>`test/opening-overlay.test.js`                                                                                                                                                                                                                                                           | 2026-08-23    |
| `specs/model-provider-capabilities_design.md`    | Design specification  | Implemented | `src/ai/deepseek-client.js`<br>`public/js/admin/ai-assistant-settings.js`<br>`test/ai-provider-adapters.test.js`                                                                                                                                                                                                                                                                                             | 2026-08-17    |
| `specs/netease-entitlement-playback_design.md`   | Design specification  | Implemented | `src/music/providers/netease-provider.js`<br>`public/js/playback/operations/provider-operations.js`<br>`test/netease-provider.test.js`                                                                                                                                                                                                                                                                       | 2026-08-16    |
| `specs/now-playing-wesing_reverse_spec.md`       | Reverse specification | Reference   | `src/music/wesing-capture-engine.js`<br>`src/music/wesing-online-lyrics.js`<br>`test/wesing-capture.test.js`                                                                                                                                                                                                                                                                                                 | 2026-08-16    |
| `specs/overtime-gift-sale-refresh_design.md`     | Design specification  | Implemented | `src/bilibili/gift/sale-catalog.js`<br>`src/server/routes/overtime-routes.js`<br>`test/gift-sale-catalog.test.js`                                                                                                                                                                                                                                                                                            | 2026-08-16    |
| `specs/remote-gift-catalog-sync_design.md`       | Design specification  | Implemented | `src/bilibili/gift/remote-catalog-cache.js`<br>`src/bilibili/gift/hybrid-catalog.js`<br>`src/server.js`<br>`public/js/admin/overtime.js`<br>`test/remote-catalog-cache.test.js`<br>`test/remote-overtime-catalog.test.js`                                                                                                                                                                                    | 2026-08-29    |
| `specs/overtime-rule-quantity-mode_design.md`    | Design specification  | Implemented | `src/overtime/overtime-service.js`<br>`public/js/admin/overtime-rule-editor.js`<br>`test/overtime-service.test.js`                                                                                                                                                                                                                                                                                           | 2026-08-16    |
| `specs/overtime-text-display_design.md`          | Design specification  | Implemented | `src/overtime/overtime-contract.js`<br>`src/overtime/overtime-service.js`<br>`public/js/admin/overtime-rule-editor.js`<br>`public/js/overlays/overtime.js`<br>`test/overtime-service.test.js`                                                                                                                                                                                                                | 2026-08-22    |
| `specs/qixi-que-box-default_design.md`           | Design specification  | Implemented | `src/storage/settings-store.js`<br>`public/js/admin/gifts/recent.js`<br>`test/blind-box-defaults.test.js`                                                                                                                                                                                                                                                                                                    | 2026-08-16    |
| `specs/wesing-live-lyrics_design.md`             | Design specification  | Implemented | `src/music/wesing-capture.js`<br>`public/js/playback/services/wesing-service.js`<br>`test/playback-wesing.test.js`                                                                                                                                                                                                                                                                                           | 2026-08-16    |
| `specs/wesing-lyric-source-selection_design.md`  | Design specification  | Implemented | `src/music/wesing-online-lyrics.js`<br>`public/js/admin/desktop-lyric.js`<br>`test/wesing-online-lyrics.test.js`                                                                                                                                                                                                                                                                                             | 2026-08-16    |
| `specs/wesing-lyric-sync-controls_design.md`     | Design specification  | Implemented | `src/music/wesing-capture-engine.js`<br>`src/server/routes/wesing-routes.js`<br>`test/wesing-capture.test.js`                                                                                                                                                                                                                                                                                                | 2026-08-16    |

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
