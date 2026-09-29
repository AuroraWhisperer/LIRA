# Format and split oversized source files

**Status:** Complete (2026-09-28); pre-existing gate failures recorded below.

**Goal:** Format the seven files deferred by the repository-wide formatting pass,
then separate independently maintained responsibilities without changing behavior.

**Architecture:** Keep the existing modular monolith and explicit CommonJS
boundaries. Reuse the admin fragment mechanism for complete content fragments,
and keep Electron lifecycle wiring at its current composition root.

**Tech stack:** Prettier 3.9.8 with the repository configuration, Node.js 24,
CommonJS, static HTML, existing Node/VM/Electron tests.

## Constraints and current behavior

- Preserve all existing working-tree changes, public contracts, help content,
  chapter order, DOM structure, screenshot recipes, and test assertions.
- Do not add dependencies, change user data, launch the user's app, or commit.
- The seven formatted sizes are 617/930/692/840 lines for configuration/FAQ/
  features/toolbox help, 862 for screenshot supplements, 725 for Electron main,
  and 775 for fan-profile frontend tests.
- The previous complete test baseline is 2835 passing, 13 failing, 4 skipped.
  Failures are one pre-existing usage-guide CSS size violation and twelve
  pre-existing server-contract revision mismatches.

## Ownership and decisions

- `public/pages/admin/toolbox/usage-guide-*.html` owns help content. Extract
  complete chapters or complete groups of articles/questions by subject.
  `src/server/admin-page.js` currently expands only one include level; expand
  includes recursively so chapter containers can retain their existing DOM.
  Preserve the existing include-path allowlist and final-page cache.
- `scripts/usage-guide-shots/supplement.cjs` owns capture execution and its CLI.
  Move recipes into explicit topic modules while preserving array order,
  callbacks, the `SHOTS` export and the `capture` export.
- `test/fan-profiles/frontend-fan-profiles.test.js` retains its private DOM
  fixture and archive/navigation scenarios. The independent presentation and
  settings scenarios move to `frontend-fan-profiles-view.test.js`. Inspection
  showed only the archive tests consume the fixture, so no shared helper or
  copied fixture is needed. Every test and assertion is retained.
- `src/electron/main.js` remains the single composition root. Formatting adds
  two physical lines (725 total), one beyond the reviewed ceiling. It already
  delegates domain operations, auth, updates and resource integrity to owners.
  Retain its centralized startup/shutdown ordering and record an exact 725-line
  review rather than introduce a dependency bag or relocate lifecycle wiring.
- Remove the fan-profile test size record once the test is below 601 lines.
  Update the page-owner document and the exact main-entry review only.

## Milestones and verification

- [x] Save a task-local snapshot, composed HTML, screenshot recipes and test
  inventory. Format all seven files and verify Prettier AST consistency.
- [x] Split help chapters. Verify composed DOM/content and chapter order against
  the snapshot; extend composition regression coverage for nested includes.
- [x] Separate screenshot recipes and fan-profile tests. Compare recipe values,
  callback bodies, test names and assertion-bearing bodies with the snapshot.
- [x] Record the main-entry exception and remove the obsolete test record.
  Document final file sizes and the content composition boundary.
- [x] Run focused admin/fan-profile/desktop checks, JavaScript and CJS syntax,
  formatting checks, documentation/architecture gates, and the complete suite.
  Compare failures with the established baseline and review the final diff and
  `git status --short`; `git diff --check` must pass.

## Failure handling and completion

Keep snapshots outside the repository. Repair only changes introduced here;
never reset or overwrite unrelated edits. A failing unchanged environment gate
is reported as such. Completion requires formatted files, cohesive new modules
under the normal size threshold, preserved observable behavior, an explicit
reason for the one unsplit file, and no new regression failures.

## Results

| Original file | Fully formatted lines | Final responsibility and sizes |
| --- | ---: | --- |
| `usage-guide-configuration.html` | 617 | 3-line composition; AI 275, OBS 211, shortcuts 129 |
| `usage-guide-features.html` | 692 | 3-line composition; songs 239, playback 198, gifts 253 |
| `usage-guide-faq.html` | 930 | 15-line container; four topic groups of 133–292 lines |
| `usage-guide-toolbox.html` | 840 | 48-line container; four topic groups of 84–256 lines |
| `scripts/usage-guide-shots/supplement.cjs` | 862 | 153-line runner; license/music/gifts/toolbox recipes of 76–337 lines |
| `test/fan-profiles/frontend-fan-profiles.test.js` | 775 | Archive flows 414; presentation/settings 371 |
| `src/electron/main.js` | 725 | Retained composition root, exact 725-line reviewed ceiling |

Validation:

- Prettier AST checks passed before decomposition; all affected code passes
  the final formatting check.
- Composed HTML retains the element hierarchy, attribute values and normalized
  text of the pre-task page. No extra wrapper nodes or duplicate content.
- All 102 screenshot recipes retain their order, parameters and callbacks.
  Capture/CLI/lyric helper function bodies remain identical after formatting.
- All 23 fan-profile tests retain their complete bodies and assertions; the
  private fixture is unchanged. The two new composition tests cover nested
  ordering, repeated includes, the path allowlist and circular references.
- Focused admin/fan-profile/startup/shutdown tests: 81 passed.
- `npm run check`: 1033 JavaScript files passed; affected CJS syntax also passed.
- `npm run verify:docs`: 7 passed. Architecture/module-size checks have only
  the pre-existing `usage-guide.css` 800-vs-792-line failure.
- Final complete suite: 2854 tests, 2837 passed, 13 failed, 4 skipped. Failure
  names match the prior baseline exactly: one CSS-size registration mismatch
  and twelve server-revision contract failures. Both added tests pass.
- The first complete run hit a Windows native process-query timeout; its
  isolated three-test retry and the subsequent complete run passed that check.
- Final source diff, working-tree scope and `git diff --check` reviewed; no
  generated/runtime data or dependencies added, no commit created.
