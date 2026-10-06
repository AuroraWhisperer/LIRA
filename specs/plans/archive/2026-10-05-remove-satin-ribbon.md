# Remove the satin-ribbon gift frame

Status: Completed

## Goal

The user cancelled the voile-v4 work and requested deletion of this style. Remove satin-ribbon from LIRA's settings, preview, gift triggering, renderer, and shipped assets.

## Scope and ownership

- `src/bilibili/gift/frame-config.js`, settings defaults and HTTP allowlist own enabled themes and writable settings.
- `public/js/admin/gift-frame.js` and its page fragment own settings and preview controls.
- The gift overlay queue/player and component mount own playback.
- Remove the ribbon-only renderer, CSS, assets, and browser test; update shared tests and current contracts.
- Keep the woodland-bloom effect, gift queue behavior, unrelated working-tree changes, and user data intact.

## Compatibility

Only woodland-bloom remains a valid gift-frame theme. Retired satin-ribbon events are ignored by the queue; explicit preview requests for that theme are rejected. Historic ribbon setting rows remain in existing databases but are not defaults, writable settings, or triggering inputs. No migration or real-data mutation is needed.

## Milestones and verification

1. Stop owned preview/bake work and remove settings/renderer/assets. Verify no active ribbon imports, DOM roots, or resources remain.
2. Update focused tests to reject the retired theme/settings and preserve woodland behavior; update guide/API/storage/WS/spec documents and supersede the original plan.
3. Run gift frame/admin/queue/controller tests, related scene/transport tests, the existing canvas gift preview test, syntax checks, docs/architecture gates justified by contract removal, and `git diff --check`. Inspect final diff and status.

## Failure handling

Inspect and reverse only task-owned edits if needed. Do not reset the repository, remove unrelated changes, or delete stored user settings.

## Done when

The style is absent from product UI, triggering, playback, and public assets; focused regression checks pass and contracts match. Historical scratch renders are outside the shipped product.

## Completion evidence — 2026-10-05

- Removed the settings card, writable/default settings, theme selection, renderer, CSS, public media, and ribbon-only browser test. The queue and preview API reject the retired theme; historical database rows are left intact and ignored.
- Stopped the owned preview server and closed its preview tab. No render output was installed into public assets.
- `node --experimental-vm-modules --test test/gifts/gift-frame-config.test.js test/gifts/gift-frame-queue.test.js test/gifts/gift-frame-admin.test.js test/gifts/gift-frame-draft.test.js test/gifts/gift-frame-controller.test.js test/gifts/gift-effects-overlay.test.js test/gifts/guard-thanks.test.js` — 34 passed.
- `node --experimental-vm-modules --test test/settings/settings-contract.test.js test/scenes/scene-gift-events.test.js test/server/runtime-event-publication.test.js test/overlays/overlay-projection.test.js test/engineering/run-tests.test.js test/admin/canvas-gift-components.test.js` — 34 passed, including the browser canvas preview/save/live-effects check.
- `npm run check` — 1,266 JavaScript files passed syntax checks.
- `npm run verify:architecture` — 19 passed.
- `npm run verify:quick` — stopped at the docs gate: 9 passed, 1 failed because the unrelated active `2026-10-05-opening-moonlit-fan.md` plan has no recognized current status. The remaining syntax/architecture gates were run separately as recorded above. All documentation link checks passed; the unrelated plan was preserved.
- `git diff --check` passed. Reviewed the scoped diff and working-tree status; unrelated concurrent edits were preserved. Reference scanning found no active ribbon/voile references in `public/`, `src/`, or `scripts/`; the renderer, CSS, public asset directory, and dedicated browser test are absent.
