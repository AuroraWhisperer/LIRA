# Complete the full test suite

**Status:** Complete (2026-09-28)

**Goal:** Run all repository tests successfully on this Windows workspace, with
zero failures and zero skipped tests.

## Current failures and ownership

- Twelve contract consumers fail because the sibling server checkout is newer
  than `server-contract.lock.json`. The verifier owns revision/hash validation;
  the lock and the server's original fixtures remain unchanged.
- Four installer integration tests skip because NSIS environment variables are
  absent. The required compiler and Unicode plugins already exist in the local
  electron-builder cache. Installer tests own isolated native fixtures.
- `public/css/admin/toolbox/usage-guide.css` is 800 lines against its reviewed
  792-line ceiling. It contains help content styles and toolbox responsive rules.

## Decisions and constraints

- Preserve all earlier formatting, decomposition and unrelated working edits.
- Prepare a separate `lira-server-contract` clone at the pinned revision from
  the available local server repository. Never switch the active server checkout.
  Resolve an existing dedicated contract checkout before the sibling development
  checkout, after explicit arguments and `LIRA_SERVER_ROOT`. Keep strict revision,
  fixture hash, repository-root and runtime cleanliness checks.
- Add a test helper for explicit NSIS paths or read-only discovery of the
  existing supported electron-builder cache. No automatic downloads or global
  environment edits; invalid explicit paths must still fail visibly.
- Separate help content from toolbox responsive CSS; preserve selectors,
  declarations and cascade behavior. Remove the obsolete size record after the
  file drops below 601 lines, without raising the threshold.
- Installer tests must use temporary directories, synthetic data and owned
  hidden processes. Inspect any newly executed destructive fixture paths before
  running them. Never run against user installations, data or registry state.
- Fix concrete additional failures at their owning layer; do not remove
  assertions, fabricate results or turn failing cases into skipped cases.
- No commits, publishing, dependencies or runtime contract changes are planned.

## Milestones and verification

- [x] Snapshot the task's inputs and prepare the pinned server clone. Verify
  all locked fixture hashes and run the contract group.
- [x] Add deterministic discovery coverage, connect the four installer tests,
  and run every installer scenario with the actual cached compiler/plugins.
- [x] Split CSS, verify affected admin tests and the modularity gate, and update
  the test environment documentation.
- [x] Run focused checks after fixes, then `npm run verify` with the full suite.
  Require no failures and no skips; investigate any timing/resource failures.
- [x] Review the final diff, `git diff --check`, and `git status --short`.
  Archive this plan with actual results and any remaining limits.

## Failure handling

Keep audit logs and snapshots outside the repository. Preserve the dedicated
contract checkout for repeatable tests. Reverse only task-owned edits if needed;
never reset the shared working tree or change the development server revision.

## Done when

The normal verification command uses the pinned contract inputs and available
Windows tools, all tests actually run and pass, the CSS size gate passes, and
the final changes and verification evidence are reviewable.

## Final implementation and evidence

- Prepared `D:/Work/lira-server-contract` at
  `a28db3a2ccf5f0fec1626a4fe3bd97a7eb402d1b`, with a clean working tree and all
  ten fixture hashes verified. The development server stays at its original
  `6fffbf2fd71f1231de6f7ba48ca44c4b23af030b` revision with its existing edits.
- The verifier now discovers the existing dedicated checkout. A synthetic Git
  fixture proves that explicit paths/environment still override it and corrupt
  fixture bytes still fail instead of falling back to the development checkout.
- Four installer tests use `test/helpers/installer-tools.js` to find the
  existing compiler and complete Unicode plugin set. Three discovery tests
  cover flat/nested extraction, missing plugins, authoritative explicit paths,
  and an unchanged caller environment. All original installer assertions remain.
- Help content styles are 487 lines; `toolbox-responsive.css` is 312 lines.
  Every selector/declaration is preserved. Notice/checklist rules now precede
  responsive rules that do not target those selectors; stylesheet loading stays
  ordered. The obsolete help CSS size record was removed, not increased.

Validation completed:

| Check | Result |
| --- | --- |
| Contract test group | 133 passed, 0 failed, 0 skipped |
| Installer integration group | 42 passed, 0 failed, 0 skipped |
| Environment/contract discovery tests | 19 passed |
| Focused admin/CSS/modularity tests | 34 passed |
| `npm run verify` contract input gate | Pinned revision and 10 hashes verified |
| `npm run verify` documentation gate | 7 passed |
| `npm run verify` JavaScript syntax gate | 1035 files passed |
| `npm run verify` architecture gate | 22 passed |
| `npm run verify` complete test suite | **3012 passed, 0 failed, 0 skipped**, exit code 0 |
| Final Prettier check | All affected code passes |
| Final diff check | `git diff --check` passes |

The total suite now includes cases previously hidden by fixture-loading failures
and skipped installer parents. No test was disabled, no contract hash or lock
revision changed, and no production installer code or user data was modified.
No commit or publication was created.
