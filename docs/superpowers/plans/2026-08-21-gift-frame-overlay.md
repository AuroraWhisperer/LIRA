# Gift Frame Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a transparent, local SVG/DOM gift frame overlay driven by final gift amounts, and expose its enable/threshold/motion controls in 百宝箱 → 礼物姬.

**Architecture:** A small server-side Frame Adapter turns one finalized gift row into a validated `gift:frame` event (`gift-frame:<giftEventId>`), using the authoritative RMB total and persisted frame settings. The existing `/gift-effects` page remains the public URL but becomes a single-channel frame renderer with bounded FIFO queue, dedupe, cancellable playback sessions, and an inline `woodland-bloom` SVG. The legacy MP4 lookup endpoint remains isolated for compatibility and is not consumed by the new renderer.

**Tech Stack:** Node.js 24 CommonJS backend, SQLite-backed settings store, Vanilla JavaScript ES modules, inline SVG, CSS/WAAPI, optional Canvas particles, `node:test`.

## Global Constraints

- `giftFrameEnabled` defaults to `false`; `giftFrameThresholdRmb` defaults to `"20"`; `giftFrameTheme` defaults to `"woodland-bloom"`; `giftFrameMotionMode` defaults to `"auto"`.
- Only finalized gift rows can produce real-time frame events; compare `Math.round(total_price * 100)` against the threshold in integer cents and require a positive total.
- Keep `/gift-effects`, loopback binding, token/origin checks, database schema, gift progress/final semantics, and existing legacy lookup endpoints compatible.
- The overlay must stay transparent without an event, use `viewBox="0 0 1920 1080"`, inline SVG, textContent-only dynamic text, and no remote media/theme loading.
- Playback is one active session with at most three pending events, 12-second pending age, stable-ID dedupe, watchdog cleanup, and URL > admin > system motion precedence.

### Task 1: Frame event contract and persisted settings

**Files:**
- Modify: `src/storage/settings-store.js`
- Create: `src/bilibili/gift/frame-config.js`
- Modify: `src/server.js`, `src/server/api-context.js`, `src/server/routes/gift-routes.js`
- Test: `test/gift-frame-config.test.js`

**Interfaces:**
- `buildGiftFrameEvent(item, settings)` returns a plain event or `null`.
- `normalizeFrameSettings(settings)` returns validated `{ enabled, thresholdRmb, themeId, motionMode }`.
- `POST /api/gifts/frame/preview` accepts `{ userName, giftName, num, totalPriceRmb, themeId, motionMode }` and broadcasts a `preview: true` frame event without consulting settings or the live dedupe set.

- [ ] **Step 1: Add failing contract tests** for default keys, integer-cent threshold boundaries, stable IDs, authoritative `total_price`, disabled/invalid events, motion/theme allowlists, and preview payload validation.
- [ ] **Step 2: Run `node --test test/gift-frame-config.test.js`** and confirm the new module/routes are absent or failing.
- [ ] **Step 3: Implement `frame-config.js`** with `20` RMB default, `woodland-bloom` allowlist, `auto/full/reduced` allowlist, `Math.round(totalRmb * 100)` conversion, safe text normalization, and `gift-frame:<id>` IDs.
- [ ] **Step 4: Add the four settings defaults** and route normalization for non-negative threshold, allowed theme, and allowed motion mode; reject malformed preview bodies with HTTP 400.
- [ ] **Step 5: In the finalized-gift callback**, broadcast the frame event only when `buildGiftFrameEvent` returns one; leave the old MP4 resolver isolated for its compatibility endpoints.
- [ ] **Step 6: Run `node --test test/gift-frame-config.test.js test/gift-effect-config.test.js`** and verify both new and legacy contracts pass.

### Task 2: Inline frame renderer and playback lifecycle

**Files:**
- Modify: `public/pages/overlays/gift-effects.html`
- Modify: `public/css/overlays/gift-effects.css`
- Replace/modify: `public/js/overlays/gift-effects.js`
- Test: `test/gift-effects-overlay.test.js`, `test/gift-frame-overlay-runtime.test.js`

**Interfaces:**
- `GiftFrameController.handle(payload)` validates `gift:frame` payloads and owns queue/dedupe.
- `FrameController.prepare(payload, motionMode)`, `playEnterTimeline(session)`, `playExitTimeline(session)`, `reset()` own only SVG/DOM visuals.
- `ParticleController.start(theme)`, `stop()`, `resize(width, height)` are optional and capped at six particles.

- [ ] **Step 1: Add focused source/runtime tests** for transparent markup, inline SVG layer IDs, frame-only event consumption, queue replacement/expiry, safe text nodes, motion precedence, overlapping enter offsets, and cleanup after normal/error/watchdog/cancel paths.
- [ ] **Step 2: Run the focused tests** to record the initial failures.
- [ ] **Step 3: Replace the overlay stage** with `particleStage`, inline `gift-frame-svg` (four corners/four edges/highlight groups), and `gift-info` bottom plate; preserve debug background/status and the public URL.
- [ ] **Step 4: Implement the bounded queue** (`MAX_PLAYING = 1`, `MAX_PENDING = 3`, 12-second age), stable-ID dedupe, amount-aware pending replacement, preview bypass, and WebSocket reconnect.
- [ ] **Step 5: Implement `PlaybackSession` and `FrameController`** with one frozen `{ enterDuration: 900, holdDuration: 2600, exitDuration: 650, watchdogGraceDuration: 500 }` timeline; schedule corners, edges, highlights, and info in one overlapping enter group; use textContent and fixed amount column.
- [ ] **Step 6: Implement reduced-motion behavior and optional low-count particles**, then run the focused runtime/source tests and `npm run check`.

### Task 3: 礼物姬 controls and preview workflow

**Files:**
- Modify: `public/pages/admin/toolbox/gift.html`
- Create: `public/js/admin/gift-frame.js`
- Modify: `public/js/admin/index.js`
- Modify: `public/css/admin/other-features/gift-effects.css`
- Test: `test/gift-frame-admin.test.js`

**Interfaces:**
- `window.AdminApp.giftFrame.init()` binds the Gift 姬 form and renders from `app:settings-state`.
- The form saves only `giftFrameEnabled`, `giftFrameThresholdRmb`, `giftFrameTheme`, and `giftFrameMotionMode` through `/api/settings`.

- [ ] **Step 1: Add DOM/module tests** asserting the switch is inside `otherGiftFeature`, labels describe threshold/motion, preview controls call `/api/gifts/frame/preview`, and values round-trip from snapshot settings.
- [ ] **Step 2: Run the focused admin test** and confirm the controls are missing.
- [ ] **Step 3: Add the Gift 姬 “礼物边框” card** with enable switch, RMB threshold, theme select, motion select, save status, preview button, and overlay URL copy/open controls; keep all user-facing copy in plain Chinese.
- [ ] **Step 4: Implement the module** with safe numeric normalization, `textContent` status updates, `/api/settings` save, preview request, and settings-state re-render; import it before `app.js` and initialize it from the existing admin module registry.
- [ ] **Step 5: Run the admin tests plus `npm run check`**.

### Task 4: Documentation and layered verification

**Files:**
- Modify: `docs/architecture/frontend/overlays.md`
- Modify: `docs/architecture/backend/bilibili/gift.md`
- Modify: `docs/architecture/backend/storage.md`
- Modify: `test/gift-effects-overlay.test.js` only if compatibility assertions need additive updates

- [ ] **Step 1: Document the `gift:frame` event owner, settings keys, integer-cent rule, overlay ownership, and legacy MP4 isolation.**
- [ ] **Step 2: Run `npm run verify:docs` and `npm run verify:architecture`.**
- [ ] **Step 3: Run `npm run check`, `npm run verify:quick`, and the complete focused gift/settings/admin suite.**
- [ ] **Step 4: Review `git diff`, `git diff --check`, and `git status --short`; verify no `data/`, `logs/`, `tmp/`, or `release/` output changed.**

## Self-review checklist

- The plan covers settings, event construction, preview, overlay layers, queue/session cleanup, reduced motion, admin placement, and owner documentation.
- All dynamic gift text is written with `textContent`; all themes and motion modes are allowlisted locally.
- No task introduces a framework, build step, process, port, external media, or schema migration.
