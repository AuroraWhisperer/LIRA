# Release Installer Build Implementation Plan

**Goal:** Build the requested v4.1.0 Windows installer after the release attempt exposed an unavailable NSIS macro.

**Architecture:** Keep electron-builder's existing GetInQuotes function and stack contract. Replace the premature macro expansion with its three equivalent instructions; do not change registry selection, migration, or installer behavior.

**Tech Stack:** NSIS, electron-builder, Node.js tests.

## Constraints and evidence

- The published main commit and v4.1.0 tag are 0756e53; the release attempt failed before uploading installer assets.
- installer.nsi expands customInit before including installUtil.nsh, so GetInQuotes is unavailable as a macro at that point. NSIS function calls support forward references.
- Preserve all existing user changes and existing public contracts. Do not rewrite main history.

## Implementation and verification

- [x] Replace `!insertmacro GetInQuotes $R4 "$R3"` in build/installer.nsh with `Push "$R3"`, `Call GetInQuotes`, `Pop $R4`.
- [x] Update test/installer-registry.test.js to assert that stack sequence and reject the unavailable macro; retain registry safety assertions.
- [x] Run npm test and build with npm run dist:win:local. The full installer compiler is the regression reproduction; do not run the installer against user data.
- [ ] Review the diff, run git diff --check, and record results. Publish only after the release tag and source commit consistently identify the corrected source.

## Failure handling and completion

On build failure inspect the compiler error and preserve the existing tag. Do not upload a package under a tag identifying different source. Completion requires a successful local build, passing tests, and verified release assets; correcting an already pushed tag requires explicit user approval.

## Verified results

- npm test: 1681 passed, zero failed/skipped/cancelled.
- npm run dist:win:local: exit 0, produced lira-setup-4.1.0.exe and its blockmap.
- git diff --check: passed. The initial GitHub release has zero assets; no installer from the failed source was uploaded.
- Source fix is ready; release completion is pending correction of the already pushed v4.1.0 tag.
