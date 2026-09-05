# Packaged Media Slimming Implementation Plan

## Goal And Accepted Decisions

- Use WebP siblings for the 18 PNG-suffixed gift-frame and danmaku resources.
  Convert 15 actual PNGs losslessly; three bubble frames already contain WebP
  bytes and only need the correct suffix. Keep originals but exclude their PNG
  paths from release packages. The four song-board themes are unchanged WebP.
- Keep the gift composite: the current renderer loads it directly along with
  three accents. Do not replace the animation with a different layered design
  or remove any gift-frame image from the selected set of WebP equivalents.
- Opening audio and character are upload-only, with empty URL/name defaults.
  Move the existing three bundled samples to `test/fixtures/opening/` for manual
  upload testing; no opening sample remains in public assets or a release.

## Ownership And Scope

- Image conversion worker: only new WebP siblings in `public/img/overlays/`
  gift-frame, danmaku-ranked, and danmaku-guard; references in gift-effects HTML
  and danmaku CSS; directly affected gift-effects tests.
- Primary: opening routes, overlay and Admin controls, opening tests, sample
  relocation, package filters, owning docs/spec, and final build acceptance.
- Existing `src/server/routes/opening-routes.js` owns upload validation and
  persisted filenames; no settings schema or media-serving changes are needed.

## Frontend, Backend, And Security

- Frontend: empty character means a hidden image without src; empty audio means
  no load/play attempt. Upload and clear continue to refresh the preview.
- Backend: no selection or a missing selected file returns empty media values;
  successful uploads and existing saved user media retain their current URLs.
- Security: preserve auth and origin checks, upload limits/signature checks,
  basename confinement, selected-file-only serving, and textContent rendering.
  Test samples are outside the HTTP public root and package allowlist.
- Clear buttons reset the current selection only, as before; do not delete
  user-uploaded files or touch real user data for tests.

## Milestones

- [x] Generate actual PNG conversions with `cwebp -lossless -exact`; preserve
  the bytes of the three mislabeled WebP files. Verify dimensions, single-frame
  status, and decoded RGBA equality. Update only corresponding HTML/CSS
  references and the existing asset assertions.
- [x] Update opening tests for empty defaults, clear-to-empty behavior, missing
  selections, safe renderer URLs, and private manual fixtures. Confirm failure
  before changing runtime behavior.
- [x] Change opening route defaults, prevent empty-src playback/image requests,
  and change Admin reset wording to clear. Preserve upload validation and paths.
- [x] Relocate only the three original opening samples, preserving their hashes,
  into `test/fixtures/opening/`; update the accepted opening spec and owning docs.
- [x] Add precise package exclusions for converted PNGs and the opening sample
  directory; do not change unrelated image or dependency filters.
- [x] Run focused opening, gift-effects, danmaku, queue, packaging, and Admin
  composition checks; run relevant syntax and architecture/documentation gates.
- [x] Build Windows x64 with local Electron and `--dir --publish never` in a
  separate output directory. Verify WebP counterparts, no bundled opening
  samples or test fixtures, unchanged production dependencies, and media totals.
- [x] Inspect the actual changed diff, run `git diff --check`, inspect status,
  and archive this plan with results and limitations.

## Verification And Failure Handling

Use isolated fixture state and no external services. Use the existing overlay
test path plus targeted browser inspection if needed to verify blank-default
and uploaded states. Do not publish or overwrite existing release artifacts.
Retain recoverable originals rather than deleting assets. On failure, inspect
only task-owned changes and do not use broad rollback or cleanup commands.

## Verification Results

- Completed 2026-09-05. The new opening expectations failed before runtime
  changes, then the combined opening, packaging, gift-effects, queue, and Admin
  composition run passed all 56 tests. Danmaku's 8 tests also passed.
- `npm run verify:quick` passed: 5 documentation tests, syntax checks for 566
  JavaScript files, and 13 architecture tests. The final three original-WebP
  byte copies were rechecked with 11 danmaku/packaging tests, all passing.
- All 18 image counterparts have identical dimensions, decoded RGBA pixels,
  alpha, and single-frame status. No source PNG has a color profile to lose.
  The three bubble-frame sources are already WebP and their new files preserve
  their complete original bytes. Final total: 20,191,372 original bytes versus
  14,363,012 WebP bytes, saving 5.558 MiB.
- The three opening samples were moved without byte changes to
  `test/fixtures/opening/`; before/after SHA-256 values matched.
- A final Windows x64 unpacked artifact excludes all opening samples, the test
  directory, and the converted PNG paths. All 18 WebP files match source hashes,
  and every production dependency matches the previous verified artifact.
- Packaged media: 37.124 MiB -> 23.803 MiB. ASAR: 45.195 MiB -> 31.874 MiB.
  These are uncompressed archive measurements, not installer size claims.
- Existing release files and user data were not touched. Verification output
  remains git-ignored at
  `tmp/media-packaging-verify-cf89625eaa3e4a2dbc3d5d3de8508112/`. No installer was
  published or installed and no real user Electron instance was launched.
- The touched changes and status were reviewed; `git diff --check` passed.
  Static original PNGs and manual opening fixtures remain recoverable in source.
