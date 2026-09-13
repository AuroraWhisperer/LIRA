# Batch D Modularity Governance Implementation Plan

**Goal:** Make the reassessment's size policy executable, with reviewed file-specific debt and exceptions.

**Architecture:** A dependency-free source scanner owns physical-line measurement and registry validation. The existing architecture command runs it through Node tests; production owners and runtime contracts remain unchanged.

**Tech Stack:** Node.js 24, CommonJS, node:test, existing Prettier configuration.

## Current Behavior And Ownership

The modularity standard still describes an advisory production-JavaScript-only threshold. `package.json` runs `test/module-boundaries.test.js` and `test/esm-module-boundaries.test.js`; no size gate exists. The September 13 reassessment owns the requested batch D scope. Current working-tree changes have already reduced several batch A files, so its historical counts cannot serve as today's baseline.

Owner: `scripts/check-modularity.js`. Contract: `docs/architecture/engineering/modularity-standard.md`. Consumers: architecture/quick/full verification commands. Registry: `docs/architecture/engineering/modularity-baseline.json`. Regression: `test/modularity-size.test.js`.

## Constraints And Non-goals

Preserve existing user edits, test discovery, runtime code, URLs, settings, SQL and lifecycle ownership. Add no dependencies, formatter installation, commits or branches. Do not mechanically split state factories or rewrite historical migrations. Function complexity remains an explicitly documented review obligation, not an invented parser-based certification.

## Milestones

- [x] Test and implement physical-line scanning: 600/601/800/801 boundaries, comments/blanks, CRLF/trailing newline, all source kinds, untracked sources, registry validation, growth and expiry failures. Verify with `node --test test/modularity-size.test.js` using isolated temporary trees.
- [x] Record current per-file assessments and exactly scoped static exceptions, plus named function debt and removal triggers. Validate all registry paths, reasons, owners, dates and protection-test paths; reject wildcard exemptions and unreviewed large files.
- [x] Replace the advisory policy, record ADR 0017, wire the architecture gate, update testing docs and append batch D status to the historical report. Verify with `npm run verify:quick` and `npm test`.
- [x] Format task-owned files, inspect task diff, run `git diff --check` and inspect `git status --short`; record results and archive this plan.

## Decisions

Ordinary source and tests share a default 800-line ceiling; tests have a separate scenario/cohesion review policy, with only exact-file exceptions. Every file over 600 needs a review record. Current oversized ordinary files are frozen legacy debt, not permanent exemptions. All records have a line ceiling and a review deadline. No automatic baseline regeneration command will be shipped.

Function review uses the report's full function span, including nested callbacks: 81–120 lines needs decomposition review; over 120, branch estimate over 20 or nesting over 4 needs recorded remediation. This batch records known debt without claiming a repository-wide function audit. Historical SQL and state ownership are preserved until their documented change triggers apply.

## Failure Handling And Done When

On failures, inspect only affected gate inputs and do not expand unrelated work. Revert only task-owned edits if needed, without blanket checkout/reset. Done when boundary and bypass tests pass, current sources pass the registry gate, documentation distinguishes enforcement from manual review, and final verification results and limits are recorded.

## Completion Evidence And Limits

Completed batch D governance on 2026-09-13. The first registry now has 51 entries: 30 warning-band reviews, 19 frozen legacy overflows and 2 static exceptions. During verification, concurrent edits extracted the danmaku AI form and added cloud identity/account coordination interfaces. Inspected those diffs before removing the obsolete form record and updating the initial ceilings and reasons for the four affected files. These production changes were not made by this task.

- Architecture verification: 22 passed, including 9 size-policy tests.
- Additional focused verification: 78 passed across cloud-sync controller, license manager, server lifecycle and admin page composition.
- Documentation checks and JavaScript syntax scan passed; task-owned files checked with the existing Prettier 3.7.4. Final diff/whitespace/status review performed.
- Full suite rerun: 1744 passed, 2 skipped, 1 failed. The remaining failure is the existing playback typography test at `test/frontend-playback.test.js:251`, whose fixed CSS list omits the separately extracted `quality-control.css`. Confirmed the expected font rule exists in that CSS. No unrelated playback code or assertion was changed; full regression is not claimed green.
- Function debt remains a documented next-change review obligation. This implementation does not claim that historical migrations or large factories now satisfy the numeric function limits.
