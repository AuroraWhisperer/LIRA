# Bundled Image Optimization Implementation Plan

**Status:** Completed

**Goal:** Reduce bundled image bytes with little visible change, remove the retired cat/bunny gift illustrations, and make 琉璃 / 杏花白 consistently display the gift's own image.

**Architecture:** Re-encode existing large WebP artwork at its original dimensions, preserving alpha exactly. Keep existing asset URLs; resize the oversized PNG gift placeholder to 512×512 RGBA without palette reduction. Extend the existing real-gift-image behavior to bubble and cream in desktop and server contracts.

**Tech Stack:** Existing Vanilla JS/CSS, Python Pillow for temporary encoding experiments, Node tests, electron-builder and browser overlay previews.

## Boundaries and current evidence

- The prior packaging cleanup is complete. Current bundled PNG/WebP baseline is 28,544,959 bytes (27.22 MiB), with concurrent user edits preserved.
- The eight queue backgrounds, four sample avatars, three aurora emblems, turntable chassis and two empty-state illustrations are lossless WebP. Trial Q90 encoding preserves dimensions and alpha while substantially reducing bytes.
- Cat/bunny PNGs remain CSS fallbacks in bubble/cream; their legacy `giftImage:theme` setting still takes effect. The user explicitly wants the gift's image here.
- Most guide screenshots are already lossy WebP. Retain screenshots and their text fidelity; the remaining three PNG screenshots total only 134,813 bytes.
- Preserve settings schemas and accept old gift-image values. Resolve them as `gift` for the two changed styles; missing or failed images leave the artwork area empty, following identity/transparent/outline.
- Do not change auth, networking, animation timing, page URLs, real user data, dependencies, fonts, or unrelated ongoing edits. Do not commit, deploy or publish.
- Save original changed assets and retired files flat in repository-root `tmp/`, with collision-safe names and a hash manifest. QA artifacts also stay in `tmp/`.

## Ownership and changes

- Desktop style defaults: `public/js/shared/danmaku-style-options.js`, `src/shared/danmaku-style-options.js`; control visibility: `public/js/admin/danmaku-parameter-view.js`, `public/js/overlays/danmaku-preview-appearance.js`.
- Artwork ownership: `public/css/overlays/danmaku/{bubble,cream}.css`, `public/img/overlays/danmaku-gifts/`; large image groups above are re-encoded in place, preserving URLs.
- Server counterpart: `D:/Work/lira-server/src/lib/overlay-style-options.js`, `public/overlay/styles/{bubble,cream}.css`, matching retired assets and focused tests. Browser style options are served from the existing server owner; no parallel implementation.
- Docs: desktop `docs/reference/frontend/overlays.md`, `docs/reference/engineering/build.md`, emblem README; server overlay protocol/OpenAPI and existing requirement/acceptance paragraphs. Check in-app guidance for old illustration claims.
- Existing focused tests: desktop style options/local preview/style ownership/gift fallback/packaging; server style options/static ownership/protocol.

## Milestones and verification

- [x] Record source hashes, inspect Q90 results on opaque backgrounds, and compare retained dimensions/alpha. Use original-size Q90 for the 18 large WebPs; resize placeholder to 512 RGBA PNG. Retain original screenshots.
- [x] Extend existing real-gift-image tests to bubble/cream, update the existing artwork ownership assertions, then update owning code and move obsolete files to tmp. Confirm old settings resolve to actual gift images, failure stays empty and the old selector is hidden.
- [x] Synchronize server rendering and affected docs. Confirm no active cat/bunny references remain.
- [x] Run desktop `node --experimental-vm-modules --test test/danmaku/danmaku-style-options.test.js test/danmaku/danmaku-local-preview.test.js test/danmaku/danmaku-style-ownership.test.js test/gifts/gift-image-fallback.test.js test/engineering/packaging-scope.test.js` and server focused overlay tests. Preserve and report unrelated pre-existing failures rather than modifying their behavior.
- [x] Inspect browser-first overlay previews with synthetic data and original/optimized artwork comparisons. Verify decoding, transparent edges and real-gift-image load/failure behavior; no real account or user app process.
- [x] Build `tmp/image-optimization-build` with electron-builder `--win --x64 --dir --publish never --config.electronDist=node_modules/electron/dist`; measure PNG/WebP bytes from the actual ASAR and verify retired assets are absent.
- [x] Run both affected documentation gates, inspect scoped diffs and `git diff --check`, inspect both repository statuses, archive the completed plan with exact evidence.

## Results and deviations

- Actual archive: 250 PNG/WebP files, 11,531,853 bytes versus 28,544,959 before this task; saved 17,013,106 bytes (16.22 MiB / 59.6%). These are resource bytes, not a claimed installer compression ratio.
- Queue backgrounds: 7,655,002 → 1,543,536 bytes; sample avatars: 4,643,230 → 562,584; emblems: 1,607,616 → 511,432; chassis: 1,131,980 → 17,426; empty states: 1,244,182 → 268,292; placeholder: 1,034,755 → 181,001. Cat/bunny removal saves 2,780,612 bytes.
- Every changed image decodes. The 18 WebPs retain original dimensions and every alpha byte; archived bytes match their source files. Original assets and retired files have verified SHA-256 backups in tmp. Q90 comparisons retain fine artwork; downscaled opaque comparisons measured 42.92–52.45 dB PSNR, supporting rather than replacing visual inspection.
- A 512px Q90 WebP placeholder measured 30,074 bytes; kept a 512px RGBA PNG to preserve the existing persisted/static URL without expanding the compatibility change. A palette PNG trial was rejected because of visible banding.
- Desktop focused tests: 49 passed; renderer/usage-guide/gift-effect tests: 29 passed. Server style/static tests: 14 passed. Documentation gates: desktop 10 passed; server 57 passed. Existing test helpers cover image-load failure; CSS assertions now require no fallback artwork for bubble/cream.
- The touched style-ownership test previously failed on the already-added shared display-font CSS import. Its strict expected import list now includes that real dependency, allowing the same test to verify this task's artwork removal; no font behavior was changed.
- CUA inspected both local preview styles through the isolated test server after exact-route HTTP 200 verification. The gift images render, controls no longer expose the retired image mode, and the temporary browser tab/server were closed. Screenshot: `tmp/image-qa-cream.png`; comparison panels and detailed report: `tmp/bundled-image-optimization-report.md`.
- Build, diffs and statuses reviewed; all source/document changes are scoped while concurrent font and other work remains intact. No production account, running user app, deployment, commit or official installer was changed.

## Rollback and done conditions

Restore only task-owned assets from the hash-verified tmp originals and reverse scoped text patches if needed. No blanket checkout/reset. Completion requires reduced actual archive image bytes, preserved visuals at display size, consistent local/server gift behavior, passing affected checks or clearly identified pre-existing limits, and synchronized documentation. A directory build does not update or publish an installer.
