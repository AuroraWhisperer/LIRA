# Resource Delivery Guardrails

**Status:** Completed

## Goal

Prevent resources owned by imported styles from silently becoming startup CDN downloads, while keeping shared fonts/images complete, repairable and compatible with released clients. Record a reusable review rule for download and recurring-request changes.

## Current Behavior And Ownership

Before this change, `scripts/export-cdn-resources.js` selected every font binary and every image larger than 10 MiB. `src/resources/resource-library.js` downloaded every declared missing resource. Three nautical animations (58.5 MiB) therefore downloaded even though `package-guard-nautical.js` already supplied all three through the validated component-media mapping. The inventory test compared the scanner with its generated catalog and could not detect that ownership error.

`src/resources/resource-packages.js` owns named package membership and now distinguishes current shared images from legacy CDN images; shared font membership comes from `src/fonts/catalog.json`. Runtime download selection remains in `resource-library.js`. Contracts live in the CDN guide, storage/API/desktop references and build reference. Existing export, CDN library, packaging, imported-style and packaged Electron tests own verification.

## Constraints And Non-goals

- Preserve the v2 published catalog, package names/hashes, old CDN files and supported old-client inventory. Do not upload, delete remote objects, build an installer or publish.
- Keep cached legacy URLs readable; current nautical rendering continues to require its complete imported ZIP. Missing legacy cache must not count as an incomplete current installation.
- Preserve shared font coverage, the 8K map, hash/ZIP validation, two download workers, rate limits, once-per-runtime checks, explicit retry and atomic replacement.
- Keep all user changes, server subscriptions, gift recovery and local connection behavior unchanged.
- Do not introduce a second runtime, generic resource framework or new dependency.

## Milestones

- [x] Add regressions proving no implicit CDN admission by file size, complete font membership, exclusion of imported images, current startup requests and offline behavior with no legacy cache. Four targeted regressions failed before implementation; all 18 resource/export cases then passed.
- [x] Declare export membership at the existing package owner, exclude legacy-only images from startup downloads/errors, retain existing-cache reads and report current versus compatibility download size.
- [x] Update the repository resource review rule and affected contracts/guidance; run focused checks and review the final diff.

## Verification

- `node --experimental-vm-modules --test test/engineering/cdn-resource-export.test.js test/desktop/cdn-resource-library.test.js` — 18 passed.
- `node --test test/engineering/packaging-scope.test.js` — 15 passed.
- `node --experimental-vm-modules --test --test-name-pattern="nautical ZIP" test/scenes/component-styles.test.js`
- `node --experimental-vm-modules --test test/desktop/bundled-fonts-electron.test.js` (isolated ASAR/profile/data and local CDN responses; all fonts, map and offline reopen).
- `npm run verify:docs`, `npm run verify:architecture`, syntax checks for changed JavaScript, `git diff --check` and final status/diff review.
- Keep generated checks and fixtures under repository `tmp/`; verify the published catalog bytes have not changed.

## Results

The four targeted regressions failed on the original implementation and passed after the change. The 35 relevant cases passed, including the imported nautical ZIP and isolated Electron ASAR test. The latter decoded all 13 font choices, displayed the 8K map, requested exactly 14 packages, reopened offline without downloads/toasts, and compared the complete export manifest with the existing catalog. No CDN or production-server access was required.

Documentation (10 cases), architecture (28 cases), changed-file syntax and diff whitespace checks passed. The existing test runner discovers the amended suites without a new testing entry point. The current catalog remains unchanged; startup package traffic falls from about 138.2 to 79.7 MiB. Existing legacy cache reads, shared-resource repair and recovery are covered.

The root AGENTS rule and CDN operator guide now require declared consumers, delivery ownership and request-cost evidence. API/storage/desktop/build references agree with the implementation. In-app guidance, component import instructions and the tour remain accurate because controls and user operating steps did not change. Other working-tree changes were preserved. No installer was built, no remote files were changed, and installed clients require a later build to receive the runtime change.

## Failure Handling And Done When

If a check fails, diagnose with its focused suite before further changes. Revert only edits belonging to this task if necessary; no reset or blanket checkout. Complete when the regression checks prove both no redundant startup fetch and no missing current resource, legacy catalog/cache compatibility remains intact, all applicable checks pass, documentation agrees, and the final diff contains no runtime/generated material. The result applies to source and the next client build, not an already installed EXE.
