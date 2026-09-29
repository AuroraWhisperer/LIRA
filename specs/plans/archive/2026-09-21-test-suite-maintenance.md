# Test Suite Maintenance Implementation Plan

**Status:** Completed.

**复核日期：** 2026-09-28。按原文完成/执行及验证记录归档；原测试结果仅代表记录时点，本次未重跑历史任务。

当前依据：[所属规格或参考](../../../docs/reference/engineering/test.md)。状态索引见 [计划入口](../README.md)。

## 原始计划与执行记录

以下保留原计划时点的行为、命令和验证记录；它们不覆盖上述状态或当前契约，历史未勾选项不直接等同于当前缺陷。

**Goal:** Reduce duplicated test and helper maintenance across the desktop and server repositories while preserving independent behavior and accepted security, timing, caching and layout requirements.

**Architecture:** Keep the existing Node test runner, VM helpers and Playwright/Electron isolation. Tests retain ownership at their current domain boundary. Separate batches own disjoint test files; shared execution scripts, contract fixtures and the final report are integrated centrally.

**Tech Stack:** Node 24 desktop, Node 20+ server, CommonJS test helpers, existing Playwright and Electron.

原状态记录：**Status:** Implemented. First-round changes and the second authorized reduction of server HTTP/device-gift fixtures are verified. On 2026-09-26, J01 client adoption and the daily-bot/fan-facts/PK-report fixture consumers were verified against real server commit `a28db3a2ccf5f0fec1626a4fe3bd97a7eb402d1b`; the client contract group passes 133/133. Earlier execution evidence remains in the audit report.

## Constraints and current evidence

- Scope and acceptance come from the user's implementation request and `docs/reports/2026-09-21-test-suite-maintenance-audit.md`, checked against current normative owners before deletion.
- No production refactoring, dependencies, commits, branches, publishing, skipped tests or weakened contract locks.
- Desktop starts at `bb3881bb61bf66fcc5a56cdccb22aa17a756830a` with existing business/test changes; server starts at `80f0271fd457fca7616ec5508df58a9f37cabdfa` with untracked illustration/design resources. Preserve all of them.
- Initial statuses, unstaged/staged diffs, test/helper line counts and file snapshots are stored outside both repositories at `C:/Users/Tom/AppData/Local/Temp/lira-test-maintenance-349Yj9`.
- Initial JS test/helper totals: desktop 94,972; server 65,284. Count each path once, including new helpers, without counting an end-of-file newline twice.

## Ownership and milestones

- [x] Desktop shell/overlay/queue/lyrics: C01, C05–C06, BC01–BC04. All candidates reviewed; 183/183 final affected scenarios pass. Retained initial catalog generation, pointerup and host/geometry wiring where executable consumers do not cover the responsibility.
- [x] Desktop AI/danmaku/gift/helpers: C02–C04, C07, BC05–BC07. Small isolated fixtures and named behaviors implemented; final scope 74/74, direct consumers 31/31 and five deliberate faults detected.
- [x] Server tests: S01–S08, BS01–BS05. Explicit password success, scoped HTTP setup and browser replacements implemented. Final related Node 121/121 and browser 113/113; required matrices retained with 18 pre-existing game geometry failures recorded.
- [x] Execution and parameter tables: C08–C12, S09–S11. All original real entries preserved; five client and seven server browser groups verified. Node 20 collection/preload/isolation/exit codes verified. Offline group passes with an unavailable server checkout.
- [x] J01 server preparation: fixed case/whitespace vectors added, old vectors retained, fixture version advanced without changing wire protocol. Server consumers pass.
- [x] J01 client adoption: `server-contract.lock.json` pins real commit `a28db3a2ccf5f0fec1626a4fe3bd97a7eb402d1b` and the committed fixture SHA-256. The existing golden consumer now reads both base and normalization vectors through `readServerFixture`, maps Server input names to the client API and preserves independent canonical-payload/signature assertions. All six previously locked fixture hashes remain unchanged.
- [x] J02: existing locked commit already contains the identical 28 samples. Added its actual fixture hash, removed the client JSON copy and verified three independent client boundaries. No revision update required.
- [x] J03: independent client/server limits remain covered; actual pinned HTTP roundtrip passes 5/5.
- [x] Integrate: every C/S/BC/BS/J item has an implemented, specifically retained or blocked disposition in the original report. Affected/full entries, final quick gates (48.465s), discovery, syntax, YAML and diff checks are recorded with actual timings and limits. The owned detached roundtrip worktree was removed after use.

## Verification

Focused desktop command: `node --experimental-vm-modules --test --test-concurrency=6 <owned test paths>`.

Focused server command: `node --require ./test/support/test-mode.cjs --test <owned test paths>`; browser command: `npx playwright test <owned e2e paths> --workers=1`.

Each batch records exact expanded paths, exit status, elapsed time and pre-existing failures in the external evidence directory, then runs `git diff --check`. Integration verifies discovery file-set equality, independently invoked probes, `npm run verify:quick`, both complete Node entries, applicable browser groups, `npm run verify:contracts` and `npm run verify:roundtrip` with the actual pinned inputs when available. No unavailable check is counted as passing.

## Failure handling and done conditions

An unrelated failure is recorded and excluded from the claimed passing result; only task-owned regressions are corrected. Fault experiments restore exact task-owned source bytes in `finally` and do not touch existing user changes. Rollback is limited to task-owned hunks using the initial snapshot as evidence; never use destructive reset or blanket checkout.

Done when all C/S/BC/BS/J entries have an implemented, concretely retained or blocked disposition; all feasible confirmed reductions are implemented; replacements demonstrably detect the protected failure; final diff and status are reviewed; no runtime/generated or sensitive files enter the task diff. A server-commit dependency may remain explicitly pending while all independent work completes.

## Results and material findings

- Unique-path JS tests/helpers after both rounds: 160,256 → 158,446, net reduction 1,810 (first round 1,611; second round 199). Three execution scripts add 167 lines, so the net including them is 1,643. JSON fixture deletion/addition is separately accounted for in the report.
- Full server Node suite: 1,665/1,665. CI browser subset: 121/121. Full client entry: 2,681 pass, one pre-existing Windows TCP ownership-query failure, four pre-existing installer skips; isolated desktop group passes 6/6. This is not recorded as an entirely green full client run.
- The initial overtime catalog generation mutation survived picker tests because initial loading and picker requests are different paths. The original static protection was restored, its mutation then failed, and the normal affected group passed.
- Accepted nine homepage viewports, six game viewports, geometry, caching, auth, tenant isolation, rollback, idempotency, cancellation and late-response timing remain protected. Specialized picker loader/DOM and full lyric host wiring remain where broader extraction would add cost or lose coverage.
- Initial tracked user diffs and staged content were unchanged in the original reduction rounds; evidence remains outside the repositories. J01 adoption is closed by the 2026-09-26 follow-up above.

## Second reduction round

Snapshot: `C:/Users/Tom/AppData/Local/Temp/lira-test-maintenance-349Yj9/round2` records both worktrees, staged content, existing-file hashes and original bytes for this round. Start totals are desktop 93,862 and server 64,783 JS test/helper lines.

- [x] Reuse the existing `test/support/http-client.cjs` in `management-auth`, `song-page-appearance`, `public-song-rate-limit`, `streamer-gift-api`, `gift-image-delivery` and the two `support/device-gift-{api,history}.cjs` helpers. Keep Host, forwarded IP, cookie, bearer, 2-second management timeout and each response parser in its owning wrapper. Raw-body tests, SSE and process lifecycles are retained. Baseline and repeat command: `node --require ./test/support/test-mode.cjs --test --test-reporter=tap test/management-auth.test.js test/song-page-appearance.test.js test/public-song-rate-limit.test.js test/streamer-gift-api.test.js test/gift-image-delivery.test.js test/device-gift-events.test.js test/device-gift-identity.test.js test/fan-facts.test.js test/gift-card-profiles.test.js test/gifts/gift-display-profile.test.js test/gift-effect-device.test.js test/device-gift-history.test.js test/device-gift-history-clear.test.js`. Before/after: 70/70, 3.654s/3.652s. Net reduction: 173 lines.
- [x] Extract only the duplicated streamer/device/session inserts and JWT construction into `test/support/device-gift-seed.cjs`, taking the owning database and secret explicitly. Preserve API/history ID prefixes, runtime IDs, display names, return shapes, token claims and each helper's separate environment and cleanup. Before/after command: `node --require ./test/support/test-mode.cjs --test --test-reporter=tap test/device-gift-events.test.js test/device-gift-identity.test.js test/fan-facts.test.js test/gift-card-profiles.test.js test/gifts/gift-display-profile.test.js test/gift-effect-device.test.js test/device-gift-history.test.js test/device-gift-history-clear.test.js`. Before/after: 39/39, 1.401s/1.384s. Two isolated probes confirm exact DB identity, JWT and return-shape equivalence. Net reduction: 26 lines including the 68-line helper.
- [x] Review both scoped diffs and update audit section 11. Eight syntax checks, architecture 9/9 and client docs 5/5 pass. Both scenario-name sets are unchanged; unique paths including the new helper total 2,161 → 1,962 lines. Both `git diff --check` and original-file/staged/HEAD preservation pass. The previous full-suite evidence remains scoped to the first round; this follow-up verifies direct consumers only.

The session/authentication normative documents and tenant boundaries were checked. These are synthetic authenticated gift-consumer fixtures, not tests of verify's token issuance; their existing one-hour TTL and claim set remain unchanged. On 2026-09-26, the daily-bot/fan-facts/PK-report consumers were migrated to the same verified commit and their identical local JSON copies removed. The four migrated test files now belong to the `contracts` group, not `offline`.
