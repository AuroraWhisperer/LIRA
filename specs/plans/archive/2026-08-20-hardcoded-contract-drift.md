# Hardcoded Contract Drift Implementation Plan

**Goal:** Remove confirmed hardcoded contract drift while preserving persisted settings, HTTP paths, response compatibility, and existing user data.

**Status:** Complete on 2026-08-20.

**Non-goals:** Do not centralize protocol URLs, overlay reconnect algorithms, CSS illustration palettes, repository metadata, installer names, or historical migration snapshots. Do not change existing persisted values for current users.

## Current Behavior

- Theme defaults disagree between storage, the ignored theme preset asset, Admin reset behavior, and overlay fallbacks. A clean checkout does not contain the ignored preset asset.
- Overtime rule validation owns `8` enabled rules and `2-10` random outcomes on the server, while the rule editor repeats them and does not consume server limits.
- The Admin overtime gift picker assigns list prices to canonical guard pseudo-gifts even though settlement uses paid protocol values.
- AI routes repeat the authoritative key list and secret list from `src/ai/config.js`; numeric HTML constraints repeat server validation.
- Several source headers contain stale application versions.
- Desktop lyric defaults are duplicated in two Admin modules and the storage defaults.
- Music TTLs, the Bilibili danmaku message limit, and wheel limits are repeated outside their owners.
- The new-install blind-box catalog is embedded in `settings-store.js`; the migration price map is a historical snapshot and must remain frozen.

## Ownership

- Theme settings: `src/storage/settings-store.js`; renderer preset asset: `public/data/theme-presets.json`; consumers: Admin theme and overlays.
- Overtime contract: `src/overtime/overtime-contract.js`; API owner: `src/overtime/overtime-service.js`; consumer: `public/js/admin/overtime-rule-editor.js`.
- AI configuration contract: `src/ai/config.js`; route filtering: `src/server/routes/ai-routes.js`; Admin form: `public/js/admin/ai-assistant-settings.js`.
- Music cache policy: `src/music/music-cache.js`; lyrics consumer: `src/music/lyrics-service.js`.
- Danmaku transport contract: `src/bilibili/danmaku/`; AI budgeting consumer: `src/ai/ai-assistant-service.js`.
- Wheel validation: `src/games/wheel-session-service.js`; Admin consumer: `public/js/admin/games.js`.
- Persisted setting defaults and migration behavior: `src/storage/settings-store.js` and `src/storage/default-blind-box-config.json`.

## Compatibility Constraints

- Keep all existing settings keys and serialized `giftBlindBoxConfig` values unchanged.
- Do not rewrite existing user theme or lyric values.
- Keep AI secrets omitted/redacted exactly as before; empty secret fields still preserve stored secrets and `null` still clears them.
- Add only additive `limits` fields to overtime and wheel state responses.
- Keep the blind-box migration `knownPrices` object unchanged as a historical upgrade snapshot.
- Preserve the current dirty-worktree changes in queue, playback, QQ provider, CSS, tests, docs, and archived plans.

## Proposed Changes

### Milestone 1: Theme, overtime, AI, and version drift

- Track `public/data/theme-presets.json` with a narrow `.gitignore` exception and align its default text/radius with the established storage and overlay defaults (`#fff7fb`, `8`).
- Make Admin theme reset use the loaded default object without re-declaring radius and related defaults; add a parity regression test.
- Export overtime random outcome bounds, include them in overview `limits`, and make the rule editor consume limits supplied by Admin state.
- Remove guard pseudo-gift prices and sort guards as a stable group before the live sale catalog.
- Derive AI route allowed/secret keys from `AI_CONFIG_DEFAULTS` and `AI_SECRET_KEYS`; mark secret inputs in HTML instead of maintaining a frontend key set; add tests that compare numeric HTML constraints with `NUMBER_LIMITS`.
- Delete only stale application-version comment lines, including the two files with unrelated user edits.

Focused verification:

```powershell
node --experimental-vm-modules --test test/frontend-admin-shell.test.js test/overtime-service.test.js test/overtime-limits-roundtrip.test.js test/overtime-rule-editor.test.js test/ai-routes.test.js test/frontend-admin-ai.test.js
```

### Milestone 2: Cache, danmaku, and wheel contracts

- Export cache TTLs from `src/music/music-cache.js` and import them in `lyrics-service.js`.
- Add a Bilibili danmaku contract module that owns the message limit; import it from sender and AI services.
- Include wheel limits in service state and use them for Admin input attributes, option counts, removal rules, and spin readiness.
- Update the owning API/Bilibili documentation for additive limits and the named danmaku contract.

Focused verification:

```powershell
node --experimental-vm-modules --test test/lyrics.test.js test/danmaku-sender-service.test.js test/ai-assistant-service.test.js test/games.test.js test/game-routes.test.js test/frontend-games.test.js
```

### Milestone 3: Default data duplication

- Export Admin desktop lyric defaults from `desktop-lyric.js` and import them in the preview module; keep a test comparing frontend defaults with storage defaults.
- Move the new-install blind-box catalog to `src/storage/default-blind-box-config.json` and serialize it into the existing setting value; leave migration prices in place.
- Update storage documentation to identify the default catalog file and frozen migration snapshot.

Focused verification:

```powershell
node --experimental-vm-modules --test test/desktop-lyrics.test.js test/blind-box-defaults.test.js
```

## Material Discoveries

- The broad `data/` ignore rule also excluded `public/data/theme-presets.json`, so a clean checkout could lose the renderer preset owner entirely. The fix adds only the two narrow unignore rules needed for this asset.
- Overtime limits were initially attached only by `getOverview()`. Global snapshots and WebSocket updates use `getSnapshot()`, which allowed Admin initialization to receive rules before limits. The additive `limits` field now belongs to every overtime snapshot.
- The Admin AI secret renderer still repeated its secret-key mapping after secret field types were introduced. The saved-key projection name now lives in the existing `FIELD_MAP` tuple, so collection and masking share one frontend mapping.
- The ESM boundary gate does not accept an aliased named import as declared in this repository's static checker. The desktop lyric preview uses the direct exported identifier.
- The first full-suite attempts overlapped the user's concurrent draw-guess and queue edits. After those files settled and task-owned stale assertions were updated, the final suite passed without changing the concurrent feature implementation.

## Verification

Run focused tests first, then:

```powershell
npm run verify:docs
npm run verify:architecture
npm run check
npm run verify:quick
git diff --check
git diff
git status --short
```

Run `npm test` if the focused and quick gates pass within the session.

Verification results on 2026-08-20:

- Combined task-focused regression: **159 passed, 0 failed**.
- Additional desktop lyric, AI, overtime, queue, and game regressions after final review: all passed.
- `npm run verify:docs`: **5 passed, 0 failed**.
- `npm run verify:architecture`: **9 passed, 0 failed**.
- `npm run check`: syntax check passed for **398 JavaScript files**.
- `npm run verify:quick`: passed.
- `npm test`: **733 tests, 732 passed, 1 skipped, 0 failed**.
- `git diff --check`: no whitespace errors; Git reported only existing LF-to-CRLF conversion warnings.

## Rollback Or Failure Handling

Inspect only task-owned hunks and revert them with `apply_patch`; never use blanket checkout or reset. If an existing dirty file conflicts, stop modifying that file and report the exact overlap.

## Done When

- Confirmed contract values have one runtime owner or a parity test across the unavoidable CommonJS/browser boundary.
- First-run/reset/fallback theme defaults agree and the preset asset is tracked.
- Overtime and wheel Admin controls consume server-provided limits.
- AI route filtering cannot drift from the AI config owner and secret handling remains covered.
- Persisted formats and migration history remain unchanged.
- Focused tests and applicable repository gates pass, and the final diff contains no unrelated changes.
