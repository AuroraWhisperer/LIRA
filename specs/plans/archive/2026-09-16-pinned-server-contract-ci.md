# Pinned server contract and CI implementation plan

**Status:** complete (local implementation and verification; hosted activation pending)

**Goal:** Resolve audit A1 and configure A2 so the desktop's server fixtures and
song roundtrip use a reproducible, explicitly declared server revision.

**Architecture:** The server remains the contract authority. A desktop lock file
records its repository, full commit and fixture SHA-256 values. A small verifier
owns checkout validation; consumers use that verifier before reading fixtures or
loading server runtime modules. GitHub Actions separates public PR checks from
trusted checks that need access to the private server repository.

**Tech stack:** Node.js 24, node:test, Git, PowerShell and GitHub Actions. No new
runtime or test dependencies. Use the native subagents authorized by the user.

## Current behavior and ownership

At the start of this follow-up, both repositories were clean and their HEADs
matched remote main on 2026-09-16:
desktop `bd248918c79d3618eb619736a649a1bb8a7b4a52`, server
`5ea7b01c8fc7b1cec34a43b01f99c403fd9d1577`. Seven desktop tests read four
server fixtures through implicit sibling paths. The explicit song roundtrip
reads a fifth fixture and loads server runtime modules without pin validation.

The owning files are the new `server-contract.lock.json` and
`scripts/verify-server-contract.js`, their test consumers, the roundtrip script,
`package.json`, and `.github/workflows/check.yml`. Engineering test/build docs
describe use and the audit records evidence. The server repository is private;
the desktop repository is public and has no Actions repository secrets today.

## Compatibility constraints and non-goals

- Preserve application behavior, HTTP/IPC contracts, storage and auth boundaries.
- Keep fixtures authoritative in the server; do not copy them into the desktop.
- Retain the existing sibling checkout as a convenience default, but support
  `LIRA_SERVER_ROOT` and explicit integration paths.
- Never checkout/reset, install into, or otherwise mutate a user's server checkout
  from the verifier. No commit, branch, push, release or deployment.
- Never make private server code or credentials available to PR-controlled code.
- Do not provision access tokens or imply hosted CI ran before it actually ran.
- Exclude A3-A6, packaging and NSIS provisioning from this follow-up.

## Milestone 1: Declare and enforce contract inputs

- [x] Add the repository, full revision and five original-file hashes to the lock.
- [x] Implement `resolveServerRoot(serverRoot)`,
  `verifyServerContract({ serverRoot, runtime })` and
  `readServerFixture(relativePath, { serverRoot })`. Reject missing checkouts,
  wrong revisions and altered fixtures with actionable errors. Runtime validation
  additionally rejects dirty server source and dependency manifests.
- [x] Exercise these failures using temporary Git repositories and synthetic
  fixtures, with no real data or external service.
- [x] Migrate the seven fixture consumers and validate before the roundtrip script
  imports server modules. Add `verify:contracts` and `verify:roundtrip` commands;
  full verification validates contracts before running the full test suite.

Verify with the new isolated validator tests, the seven affected contract tests,
and the existing five real-HTTP song roundtrip scenarios.

## Milestone 2: Configure safe hosted gates

- [x] Add Windows/Node 24 quick checks for pushes, PRs and manual runs, including
  isolated verifier tests that require no server checkout.
- [x] Add a separate full gate only for main pushes or manual main runs. Read the
  lock, checkout the exact server commit using `LIRA_SERVER_READ_TOKEN` from the
  `server-contract` environment restricted to main, disable
  persisted Git credentials, verify before installing dependencies, then run
  desktop verification and the roundtrip. Missing credentials fail clearly.
- [x] Pin reusable actions to verified immutable revisions. Use read-only workflow
  permissions; no privileged PR trigger, private-source artifact or private cache.
- [x] Document the exact checkout/update workflow, CI trust boundary and minimum
  private-repository credential permission and environment branch restriction.

Verify workflow syntax and independently review event, checkout and secret use.
Use a fresh fixed server checkout outside the working repositories to demonstrate
that the gate does not depend on the sibling's uncommitted state.

## Verification

```powershell
node --test test/server-contract.test.js
npm run verify:contracts
npm run verify
npm run verify:roundtrip
git diff --check
git status --short
```

The fixture consumer command is the seven files listed in the implementation
review. Review generated workflow with actionlint if available, otherwise a YAML
parser plus a focused independent review. Record exact results below, including
pre-existing failures and any installer skips. Review only touched files and
confirm no task-owned changes entered the original server working tree.

## Rollback or failure handling

Keep failures visible; do not silently skip missing/mismatched server inputs.
Reverse only task-owned hunks if necessary, with no reset or broad checkout.
If remote credentials are unavailable, complete and verify the local gate and
leave hosted activation explicitly pending. Do not broaden token permissions.

## Done when

The declared server commit and fixture content are enforced, all consumers use
the verifier, focused tests and local full/roundtrip checks have sufficient
evidence, CI configuration is reviewed, docs and audit agree, and the final diff
is scoped. Hosted activation remains a separately stated operational prerequisite
until the workflow is pushed and a narrowly scoped read credential is configured.

## Execution notes

- Initial clean revisions and private-repository status were verified read-only.
- No implementation changes have been made in the server repository.
- The first full-gate attempt stopped at the size gate before running the full
  suite: the picker test grew from 760 to 761 lines with its verifier import.
  Parent and independent review confirmed it remains one picker scenario group
  with unchanged assertions and responsibilities. Its existing 601–800 `review`
  record is updated to 761 with dated rationale, keeping the owner, removal
  trigger and review deadline. No legacy ceiling is raised and no unrelated
  helper is compressed, removed or extracted to evade the count.
- Other concurrent work later changed server admin/UI/docs/output files. This
  task leaves those changes alone and validates against the independent clean
  pinned checkout instead of assuming the sibling remains clean.
- Final validation used Node v24.15.0 and the clean server checkout at
  `C:\Users\Tom\AppData\Local\Temp\lira-server-a1-310032973a9646aea14542120ee3e566`.
  It was cloned with `--no-hardlinks --no-checkout`, then detached at the locked
  SHA and installed with its own `npm ci`; in-memory SQLite initialization passed.
- `node --test test/server-contract.test.js`: 15/15. Seven consumer files:
  `node --experimental-vm-modules --test test/gift-category.test.js test/gift-identity-catalog.test.js test/overtime-gift-picker.test.js test/processed-gift-contract.test.js test/processed-gift-source.test.js test/frontend-gifts-panel.test.js test/processed-gift-import.test.js`:
  31/31. New JS files use Prettier 3.7.4; existing unrelated formatting remains.
- With `LIRA_SERVER_ROOT` set to the fixed temporary checkout, `npm run verify`
  passed: docs 5/5, syntax 785 JS files, architecture 22/22, full suite 2,005 pass,
  zero failures and 4 NSIS skips. The previous toolbox assertion now passes.
- `npm run verify:roundtrip` passed 5/5 against that checkout after the final
  verifier changes; the two explicit absolute-path entry point also passed 5/5.
- Actionlint 1.7.12 (official release download checksum verified), YAML parsing,
  PowerShell parsing and independent workflow review passed. Action SHA refs and
  Node 24 declarations were verified against their official repositories.
- The public desktop repository has no configured environments at inspection.
  Activation requires a main-only `server-contract` environment, its restricted
  `LIRA_SERVER_READ_TOKEN`, pushing this reviewed workflow, and a successful
  hosted run. No remote settings, credentials, commits or releases were created.
