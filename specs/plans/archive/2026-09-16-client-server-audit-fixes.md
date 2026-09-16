# Client/server audit fixes implementation plan

**Status:** complete (B1/B2; A1/A2 follow-up prerequisites recorded)

**Goal:** Fix the confirmed B1 account-switch race and B2 song-library roundtrip
failure from the 2026-09-16 architecture audit, with isolated regression evidence.

**Architecture:** Keep the desktop and server modular monoliths. The license
manager owns request authorization lifetime; the existing remote transport and
song contract own bounded upload/download compatibility. The audit is evidence,
not a replacement for accepted requirements or protocol documents.

**Tech stack:** Node.js 24, CommonJS desktop services, node:test, the existing
Express server and isolated SQLite test stores. No new runtime dependencies.

## Global constraints

- Preserve both working trees' existing uncommitted edits; no commit or branch.
- Keep tokens and secrets in the main process. Preserve IPC result/error shapes,
  authenticated streamer ownership, and same-owner token-renewal behavior.
- Keep song replacement atomic and retain canonical fields and legacy aliases.
- Use synthetic identities and temporary/in-memory stores; never production data.
- Follow the server's normative documentation update rules for any behavior change.
- Run the work with the native subagents explicitly requested by the user;
  assignments have disjoint source ownership and the parent reviews integration.

## Current behavior and ownership

The audit's isolated probes reproduce three B1 interleavings: an A write retries
with B's token, A's late profile overwrites B's displayed profile, and A's late
revocation blocks B. `withAuthorizedToken` currently compares tokens but does not
bind the request to its initiating identity/lifetime. `getProfile` only checks
disposal before writing shared state. Same-owner token replacement must remain
retryable.

B2 accepts a 1,983,901-byte upload of 5,000 songs through the 2 MiB server parser,
then produces a 4,251,750-byte aliased DTO that exceeds the desktop's 4 MiB reader.
The existing audit adapter exercises real parser, transaction, store,
serialization and desktop transport; it does not exercise production auth.

| Work | Owner | Contracts/consumers | Verification |
| --- | --- | --- | --- |
| B1 | `src/electron/license/license-manager.js`, `license-operations.js` | `docs/architecture/desktop/auth.md`; cloud sync, IPC, gift and overlay operations | license-manager, renewal, revalidation, operation and account-isolation tests |
| B2 | `src/electron/license/remote-license-client.js`; server song-library normalizer/store/sync if required | server `docs/protocol/client-server-api.md`, device OpenAPI and requirements; cloud song sync | transport boundary tests and an explicit two-checkout HTTP roundtrip |
| A1/A2 investigation | cross-repository fixture consumers and CI definitions | engineering test/build/modularity docs; server fixture authority | identify reproducible pinned inputs without claiming dirty files are published |

## Non-goals

No renderer sandbox switch without desktop compatibility evidence, global Admin
rewrite, mechanical adapter split, capacity claim, multi-instance deployment,
release or production operation. A4/A5 remain incremental maintenance; A6 needs
a concrete load target. A1/A2 implementation follows only if fixed inputs can be
established without inventing a published version or silently dropping current
working-tree contract changes.

## Milestone 1: Bind protected requests to their initiating owner

Files: the license manager and operations above, directly related license tests,
and the owning auth documentation. Keep changes inside this owner unless a
specific lifecycle dependency requires a small supporting edit.

- [x] Reproduce B1 with deferred fake remote calls and the real manager harness.
- [x] Capture a request owner before the first authorization wait. Check it
  after every await, before executing/retrying, and before applying results or
  auth-error effects. Carry the same owner through the retry.
- [x] Bind shared profile updates to that request owner as well, including the
  continuation after the transport promise resolves.
- [x] Invalidate outstanding operations on account/device/session replacement,
  blocking and disposal; reject A-to-B-to-A stale work even when IDs match again.
  Do not invalidate ordinary same-owner token refresh merely because its token
  bytes change.
- [x] Verify delayed write retry, delayed profile, delayed revocation,
  same-owner renewal, blocked state and disposal.

Focused command starts with:

```powershell
node --test test/license-manager.test.js test/license-manager-operations.test.js test/license-manager-renewal.test.js test/license-manager-revalidation.test.js test/danmaku-overlay-ipc.test.js
```

Add the new owner-isolation regression file to the recorded final command.

## Milestone 2: Establish a bounded song-library roundtrip

Files: remote transport, focused byte-budget tests and a repeatable integration
test using explicit checkout inputs; server contract/requirements/acceptance
documents and the minimal runtime validation only if the budget requires it.

- [x] Derive a finite response bound from the actual DTO, alias expansion,
  server request/count/field limits, UTF-8/JSON escaping, and stored metadata.
  Resolve any existing contract conflict explicitly in the same change.
- [x] Preserve response resource limits, song atomicity and old aliases. If a
  proposed accepted input cannot fit, reject before replacing stored data.
- [x] Convert the 5,000-song historical failure into an assertion that upload
  and full read both succeed. Include Chinese, escaping, field/count boundaries,
  and a response exceeding the documented finite reader budget.
- [x] Ensure the HTTP test uses production parser/transaction/store/DTO plus the
  actual desktop client, with local-only networking and deterministic cleanup.
- [x] Update the owning contract documentation and focused acceptance evidence.

Focused commands include:

```powershell
node --test test/remote-license-client.test.js
# In D:\Work\lira-server:
node --test test/song-library-sync.test.js test/app-lifecycle.test.js
npm run docs:check
```

Record the exact new cross-checkout regression command after locating its test
entry point. This is a new positive regression; the historical audit attachment
retains its original defect assertions and is not a passing acceptance gate.

## Milestone 3: Integration review and audit status

- [x] Review A1/A2 findings and record a concrete next step or implement the
  minimal reproducible gate if its inputs are already available.
- [x] Run affected cloud-sync, license, remote transport and Electron security
  tests together, then the client's `npm run verify` because the generic
  authorization wrapper serves multiple protected domains.
- [x] Run relevant server gates proportional to actual server code changes.
- [x] Review only task-owned deltas against captured pre-task working files;
  inspect `git diff --check` and `git status --short` in both repositories.
- [x] Append dated remediation evidence to the audit without rewriting historical
  observations as if the original review had performed the fixes.

## Rollback or failure handling

On failure, retain the reproduction and inspect its owning delta. Reverse only
task-owned hunks if needed; never use reset, blanket checkout or broad deletion.
Distinguish pre-existing failures from introduced regressions using focused
evidence. Do not claim GUI, production, or hosted-CI validation without running it.

## Done when

Both confirmed bugs have positive regression coverage and focused checks pass;
same-owner renewal and existing compatible DTOs still work; applicable contracts
agree with code; required broader checks pass or concrete pre-existing limits
are recorded; audit status and final diff/status review are complete.

## Execution notes

- Baseline: both repositories already contain substantial uncommitted changes.
  The parent captured the initial status and directly owned client files outside
  the repository before authorizing edits.
- Three gpt-6-astra/max subagents investigate B1, B2 and A1/A2 in parallel.
- B1 adds `test/license-manager-identity.test.js` (17 cases), with independent
  review confirming no blocking findings. The combined affected license,
  cloud-sync, gift, lottery and desktop checks passed 326/326.
- The final B2 design pairs an 8 MiB bounded stream reader (including BOM and
  chunked UTF-8 compatibility) with a server precommit check of the actual DTO.
  `retryable: false` classifies oversized reads; existing periodic reconciliation
  remains unchanged. Old 4 MiB clients still require upgrade for larger libraries.
- Final desktop transport/UI command:
  `node --experimental-vm-modules --test test/remote-license-client.test.js test/remote-license-song-budget.test.js test/cloud-song-sync-ui.test.js`
  passed 26/26.
- `node scripts/verify-song-roundtrip.cjs D:\Work\Live D:\Work\lira-server`
  passed 5/5: the 1,983,901-byte audit upload now reads all 4,251,750 response bytes;
  exact 2 MiB uploads, one-byte overflow, UTF-8/escaping/aliases, coercion expansion,
  count limits and empty replacement are covered.
- Server command:
  `node --test test/song-snapshot-budget.test.js test/song-snapshot-http-budget.test.js test/app-lifecycle.test.js test/cloud-sync-http.test.js test/admin-sync-compatibility.test.js`
  passed 27/27. Song sync/validation passed 13/13 and 4/4; `npm run docs:check`
  passed 34/34. New fixture, requirements, acceptance, protocol and OpenAPI agree.
- `npm run verify` completed its docs (5), syntax (781 JavaScript files) and
  architecture (22) gates successfully. Its full test run reported 1,983 passes,
  one unrelated failure and four skipped NSIS integration groups. The failure at
  `test/frontend-admin-toolbox.test.js:312` expects local `/danmaku` assignment in
  `public/js/admin/display.js`, while the existing working tree uses the server
  overlay URL. Neither file was edited in this task; a name-filtered standalone
  rerun reproduces the same static mismatch. The final BOM decoder correction
  was followed by the 26-case focused suite and 5-case roundtrip, not another
  full run of the unchanged failing suite.
- `license-manager.js` grew into the 601–800 line review band. A baseline diff
  review and independent review justified retaining the single authorization
  lifecycle owner; its exact 647-line ceiling and extraction trigger were
  registered without changing any other ceiling.
- A1/A2 remain follow-up work: no compatible committed server fixture revision
  was found for the current client, and current server modules are uncommitted.
  Record a real fixed server commit and fixture hashes after review; do not
  introduce a floating checkout or treat a dirty snapshot as a published release.
- Task-owned deltas were reviewed against saved pre-edit files; both repositories'
  whitespace/status checks passed. No generated runtime data or secrets were
  added by this task. No commit, branch, deployment or production operation ran.
