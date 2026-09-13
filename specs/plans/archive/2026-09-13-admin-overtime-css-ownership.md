# Admin Overtime CSS Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the oversized admin overtime stylesheet with an ordered compatibility entry that gives shared layout, console, rule editor, gift picker, and adaptive overrides explicit owners without changing the rendered surface.

**Architecture:** Keep `public/css/admin/overtime.css` as the stable entry imported by `styles-admin.css`. It will import five files under `public/css/admin/overtime/`: shared page/layout rules, console rules, rule-editor rules, gift-picker rules, and a final responsive/accessibility override module. Existing tests that validate composed behavior will resolve the entry recursively; direct ownership assertions will read the focused files.

**Tech Stack:** Native CSS, nested ordered `@import`, Node.js frontend contract tests, Prettier 3.7.4.

## Global Constraints

- Preserve every existing selector, declaration, value, breakpoint, and rule body.
- Keep `public/css/admin/overtime.css` and `public/css/styles-admin.css` URLs unchanged for consumers.
- Load shared variables/layout first and responsive/accessibility overrides last.
- Keep the rule editor below the server-owned `.overtime-admin` custom properties it consumes.
- Update tests only to follow the new ownership/composition boundary; do not weaken or delete assertions.
- Do not change HTML, JavaScript, settings keys, runtime behavior, dependencies, or commits.
- Preserve unrelated dirty-worktree changes.

---

## Non-goals

- No visual redesign or selector cleanup.
- No changes to overtime state, settlement, timer, rule, or picker JavaScript.
- No per-control CSS fragmentation inside the rule editor.
- No change to the OBS overtime stylesheet.

## Current Behavior

- `public/css/admin/overtime.css` contains 1,040 lines and is imported once by `styles-admin.css`.
- Console rules occupy the current contiguous block from `.overtime-console` through the console action disabled state.
- Rule ownership consists of the catalog/action toolbar block and the contiguous rule-list/editor block.
- Gift-picker rules form one contiguous block; the final focus and media rules span components and must load last.
- Shared page, section, initial-duration, screen-preview, and settlement rules remain shared layout.
- `frontend-overtime`, `overtime-overlay`, and `toolbox-sidebar` currently pass 30/30 together.

## Ownership

- Stable compatibility entry: `public/css/admin/overtime.css`.
- Shared page/section/time/screen/settlement owner: new `public/css/admin/overtime/shared.css`.
- Console owner: new `public/css/admin/overtime/console.css`.
- Rule toolbar/list/editor owner: new `public/css/admin/overtime/rule-editor.css`.
- Gift dialog owner: new `public/css/admin/overtime/gift-picker.css`.
- Final focus and responsive overrides: new `public/css/admin/overtime/responsive.css`.
- Composed contract tests: `test/frontend-overtime.test.js`, `test/overtime-overlay.test.js`, and `test/toolbox-sidebar.test.js`.

## Compatibility Constraints

- Entry import order must be shared → console → rule editor → gift picker → responsive.
- Every routed source segment must compare exactly with its formatted Git baseline segment.
- Shared custom properties must remain available to all component files.
- Cross-owner repeated selectors from the original early flex group must retain shared-before-component order.
- The existing `content-visibility` optimization stays in shared ownership.
- Tests spanning multiple owners must inspect the recursively resolved compatibility entry.
- All resulting files must stay below 800 lines.

## Proposed Changes

- Add a red/green ownership test to `frontend-overtime.test.js` and use the existing CSS bundle helper for composed assertions.
- Route unchanged source blocks into the five focused files.
- Replace `overtime.css` with the five ordered imports.
- Update `overtime-overlay.test.js` and `toolbox-sidebar.test.js` to resolve the compatibility entry where they currently read the monolith.

## Milestones

### Task 1: Lock composition and current behavior

**Files:**

- Modify: `test/frontend-overtime.test.js`

**Interfaces:**

- Consumes: `readCssBundle(...relativeSegments)` and direct owner files.
- Produces: a test enforcing entry order and representative selector ownership.

- [x] Run the three affected test files and record a 30/30 baseline.
- [x] Import `readCssBundle` and add `overtime styles keep shared, console, rule editor, picker, and responsive ownership`.
- [x] Assert the five-entry order and representative selector ownership.
- [x] Run the named test and confirm it fails because the focused entry/files are absent.

### Task 2: Create focused owners and compatibility entry

**Files:**

- Modify: `public/css/admin/overtime.css`
- Create: `public/css/admin/overtime/shared.css`
- Create: `public/css/admin/overtime/console.css`
- Create: `public/css/admin/overtime/rule-editor.css`
- Create: `public/css/admin/overtime/gift-picker.css`
- Create: `public/css/admin/overtime/responsive.css`

**Interfaces:**

- Consumes: the current formatted monolith and its semantic source ranges.
- Produces: the same CSS through the stable `overtime.css` URL.

- [x] Copy all source segments into their semantic owner without editing rule bodies.
- [x] Compare every copied segment with the current source before replacing the monolith.
- [x] Replace `overtime.css` with only the five ordered imports.
- [x] Run the ownership test and confirm it passes.

### Task 3: Update composed test consumers

**Files:**

- Modify: `test/frontend-overtime.test.js`
- Modify: `test/overtime-overlay.test.js`
- Modify: `test/toolbox-sidebar.test.js`

**Interfaces:**

- Consumes: the stable compatibility entry.
- Produces: unchanged cross-component assertions against recursively composed CSS.

- [x] Replace direct monolith reads used for composed assertions with `readCssBundle`.
- [x] Keep every existing regex assertion unchanged.
- [x] Run the three affected files and expect 31/31 tests after adding the ownership test.

### Task 4: Verify routing and cascade safety

**Files:**

- Modify: this plan with execution results.

**Interfaces:**

- Consumes: formatted Git baseline plus focused owner files.
- Produces: exact segment routing and focused regression evidence.

- [x] Compare each formatted routed segment with its formatted Git baseline source.
- [x] Confirm all files are below 800 lines and imports resolve recursively.
- [x] Run `npm run test:admin` plus the three affected test files.
- [x] Run Prettier 3.7.4 on all touched files and `npm run check`.
- [x] Run `git diff --check` and inspect `git status --short` plus the scoped diff.

## Verification

- Red/green ownership test in `test/frontend-overtime.test.js`
- Exact per-segment comparison against formatted Git baseline
- `node --experimental-vm-modules --test test/frontend-overtime.test.js test/overtime-overlay.test.js test/toolbox-sidebar.test.js`
- `npm run test:admin`
- Prettier 3.7.4 `--check`
- `npm run check`
- `git diff --check`

## Execution Results

- Recorded a 30/30 baseline across the three affected test files, then observed the ownership test fail before the focused files existed and pass after routing.
- Confirmed all five formatted owner files exactly match their routed Git-baseline segments.
- Final line counts are 6 for the compatibility entry and 141, 142, 555, 80, and 108 for the five owners; recursive composition leaves no unresolved imports.
- The three affected test files pass 31/31 and `npm run test:admin` passes 81/81.
- Prettier 3.7.4 checks pass for every touched file, and `npm run check` passes for 620 JavaScript files.
- `git diff --check` reports no errors after filtering line-ending warnings; scoped status and diff review show only the intended compatibility entry, owners, and test-consumer changes. A pre-existing danmaku assertion change in `test/toolbox-sidebar.test.js` remains untouched.

## Rollback Or Failure Handling

If a selector, rule body, import, or composed assertion changes, stop and compare the five owner files with the recorded Git ranges. Reverse only the new directory files, compatibility entry, and task-owned test read changes with `apply_patch`; do not reset or checkout the dirty worktree.

## Done When

- The stable `overtime.css` entry explicitly composes five focused owners in the required order.
- Every original rule is present once in an owner, with exact bodies and all files below 800 lines.
- Existing composed assertions and the new ownership contract all pass.
- Formatting, JavaScript checks, diff checks, and scoped review pass without production behavior changes.
