# Parallel JavaScript Check Implementation Plan

**Status:** Complete — 2026-09-13; local changes, not committed or published.

**Goal:** Reduce validation latency using measured bounded concurrency while
retaining the same JavaScript syntax checks and failure behavior.

**Architecture:** Keep the existing standalone CommonJS checker and native
`node --check`. A small worker loop shares the sorted file queue; no new
dependency, process service, parser, cache or test-selection algorithm.

**Tech Stack:** Node.js 24+, node:child_process, node:events, node:test.

## Current behavior and ownership

`scripts/check-js.js` recursively scans src/public/scripts/test and synchronously
launches Node once for each .js file. `package.json` wires this into check,
verify:quick and verify. The owning behavior is recorded in
docs/architecture/engineering/test.md and referenced by engineering/build.md.

The clean 4.1.1 checkout has 615 JavaScript files. On the current Windows host,
the existing checker took 40.686 seconds; the identical native checks took
17.793 seconds at concurrency 4 and 17.705 seconds at concurrency 8. The prior
full release test run took 23.996 seconds at concurrency 6, including one
18.245-second NSIS migration test with sequential fixture scenarios.

## Constraints and non-goals

- Preserve scanned directories, .js selection, native module syntax handling,
  non-execution of application code, nonzero failures and success summary.
- Bound syntax concurrency to min(4, availableParallelism, file count).
- On failure stop taking queued files, wait for already running children, keep
  diagnostics, and exit nonzero without printing a success summary.
- Preserve test process isolation, existing test cases and release guide.
- No production changes, release-directory cleanup, version bump, commit or push.
- Do not add configuration knobs or caching without measured need.

## Steps and verification

- [x] Benchmark the original checker and equivalent 4/8-worker native checks.
- [x] Add test/check-js.test.js with synthetic scheduler fixtures for bounded
  execution, full coverage, failure draining and startup/signal failures; also
  exercise the actual CLI with temporary CommonJS/ESM files and syntax errors.
  Run `node --test test/check-js.test.js` to establish the relevant baseline.
- [x] Replace only the synchronous launch loop in scripts/check-js.js with
  bounded async workers. Re-run the focused checker contract tests.
- [x] Update owning check documentation; correct the documented existing test
  concurrency from 4 to the package.json value 6.
- [x] Time `npm run verify:quick`, then compare full test runs at concurrency 6
  and 12 sequentially with identical NSIS compiler/plugin fixture settings.
  Keep concurrency 6 unless the comparison establishes a worthwhile benefit.
- [x] Review touched diffs, run `git diff --check` and `git status --short`,
  record results and archive this plan after completion.

## Failure handling

Use only temporary synthetic fixture trees; verify their resolved paths before
recursive cleanup. If native syntax behavior or failure reporting changes,
repair or reverse only this task's hunks. Do not lower detection coverage to
make the benchmark pass. Benchmark evidence stays in ignored
`tmp/check-performance/`.

## Done when

The native syntax check runs faster with measured evidence, focused contracts
and relevant full gates pass, documentation matches the commands, and final
diff review confirms the change is limited to validation tooling.

## Results and decisions

The checker uses at most four native child processes. It preserves native
CommonJS/ESM package handling, checks every selected file exactly once on a
successful run, and waits for in-flight checks after stopping the queue on
failure. Node startup failures now include a useful diagnostic. The four
focused contract tests pass; baseline tests first demonstrated serial execution
and missing startup-error diagnostics. Synthetic CLI fixtures confirm source
files are not executed and invalid ESM syntax still fails with the native error.

Measured on the current 32-logical-CPU Windows host with Node 24.15.0:

| Check | Elapsed time | Outcome |
| --- | --- | --- |
| Original serial syntax checker, 615 files | 40.686 s | Passed |
| Equivalent 4-worker syntax check, same 615 files | 17.793 s | Passed |
| Equivalent 8-worker syntax check, same 615 files | 17.705 s | Passed |
| Final npm run verify:quick, 616 JS files | 20.558 s | Docs 5, syntax 616 files, architecture 13 passed |
| Full tests, concurrency 6, NSIS enabled | 21.770 s | 1741 passed, no failures or skips |
| Full tests, concurrency 12, NSIS enabled | 21.562 s | 1741 passed, no failures or skips |

These are sequential single-run measurements, not a statistical benchmark.
Concurrency 8 did not materially beat 4 for syntax checks; concurrency 12 did
not materially beat the existing 6 for tests. Keep the test command unchanged.
The earlier release verify:quick log took approximately 52 seconds; the direct
serial-versus-parallel comparison above is the more controlled comparison.

No tests were deleted, skipped or weakened. No custom parser, result cache,
dependency graph, package script or release flow was added. Day-to-day focused
verification follows the existing root risk policy. The temporary benchmark
directory disappeared during the task; the measured timings are retained above,
and final gate logs/results are under tmp/check-performance/.

An unrelated concurrent change to public/css/admin/other-features/streamer-planner.css
was observed and left untouched. Final review is limited to this plan, the
checker, its tests and the two owning documentation files.
