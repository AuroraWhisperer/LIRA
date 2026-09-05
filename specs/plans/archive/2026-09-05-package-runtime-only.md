# Runtime-Only Packaging Implementation Plan

## Goal

Exclude Playwright and Electron's default example application from future LIRA
packages. Preserve all other packaged runtime files, including gift effects.

## Current Behavior And Ownership

- `package.json` classifies Playwright as a production dependency even though
  application sources do not import it; `package-lock.json` carries that scope.
- Local builds copy `node_modules/electron/dist`. The installed builder skips
  default-app cleanup for a directory-based `electronDist`, leaving
  `resources/default_app.asar` in the output.
- The build contract is `docs/architecture/engineering/build.md`; the focused
  regression owner will be `test/packaging-scope.test.js`.

## Constraints And Non-goals

- Keep dependency versions, production features, update metadata, Electron
  security settings, public resources, and all pre-existing user changes.
- Keep Playwright available in development; do not trim dependency internals,
  source maps, images, themes, or any other candidate from the earlier report.
- Do not publish, tag, commit, install, or overwrite existing release artifacts.
- Execute inline using the repository workflow; no additional agent is needed.

## Task: Exclude Only The Two Approved Items

- [x] Add `test/packaging-scope.test.js`. Assert that package and lock metadata
  classify Playwright and playwright-core as development-only. Load the hook
  through `build.afterPack`, create an isolated resources fixture, and assert
  only `default_app.asar` is removed while `app.asar` and `app-update.yml` remain.
  Invoke the hook again to cover normal builds that already cleaned the file.
- [x] Run `node --test test/packaging-scope.test.js` and confirm these expectations
  fail before changing the package metadata or adding the hook.
- [x] Move the existing Playwright version to `devDependencies`. Refresh only
  lock metadata with `npm install --package-lock-only --ignore-scripts --offline
  --no-audit --no-fund` and inspect for unrelated version changes.
- [x] Configure `build.afterPack` as `scripts/after-pack.js` and implement:

  ```js
  'use strict';

  const fs = require('node:fs/promises');
  const path = require('node:path');

  module.exports = async function afterPack(context) {
    const resourcesDir = context.packager.getResourcesDir(context.appOutDir);
    await fs.rm(path.join(resourcesDir, 'default_app.asar'), { force: true });
  };
  ```

- [x] Update the owning build document with the development-only dependency and
  the precise output-file cleanup. Do not change the existing resource filters.
- [x] Run focused packaging, release-script, and gift-effects tests, syntax-check
  the new scripts, and run the documentation gate.
- [x] Build a Windows x64 unpacked application in a newly created temporary
  output directory using the local Electron distribution and `--publish never`.
  Inspect the new ASAR and resources directory: neither Playwright package nor
  the default example may remain; every gift-frame image must be present with
  the same bytes as the corresponding source image.
- [x] Review the touched diff, run `git diff --check`, inspect `git status
  --short`, and archive this plan with actual verification results.

## Failure Handling And Done When

On failure, keep the existing release output untouched and inspect only the
task-owned changes. No destructive reset or broad rollback is allowed. This
task is complete when both exclusions are proven in a fresh unpacked artifact,
the focused checks pass or their limits are reported, and gift assets remain
unchanged.

## Verification Results

- Completed on 2026-09-05. The two new tests failed before implementation and
  passed afterward. Packaging, release-script, and gift-effects tests: 16 passed.
- `node --check scripts/after-pack.js` and
  `node --check test/packaging-scope.test.js`: passed.
- `npm run verify:docs`: 5 passed.
- Offline lock refresh changed only dependency scope, including Playwright's
  optional fsevents dependency; no versions or integrity values changed.
- Windows x64 `electron-builder --dir --publish never` with the existing local
  Electron distribution succeeded in an isolated output directory.
- The new archive contains neither Playwright package; its resources directory
  has no default example. The original development Electron example remains.
- All 8 gift-frame PNGs are present and their SHA-256 hashes equal the source
  files. The dependency build variants from report item 5 remain packaged.
- ASAR size: 60.592 MiB in the existing release, 45.195 MiB in the validation
  output. This is not an NSIS installer-size measurement.
- The directory-only target does not emit `app-update.yml`; installed builder
  code limits that emission to supported installer targets. Update-file
  preservation is covered by the isolated hook test. No NSIS installer was
  produced, and existing release artifacts were not overwritten.
- Touched diff reviewed and `git diff --check` passed; pre-existing changes are
  preserved. Temporary output remains in
  `tmp/packaging-verify-e377cbdea82d4677bb931e498b12f69a/` because the environment
  blocked its cleanup command. The output is git-ignored and can be rebuilt.
