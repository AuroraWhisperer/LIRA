# Blind-box card attribution implementation record

**Status:** Completed in source on 2026-09-12; deployment and installed-client update remain separate release work.

**Goal:** Heart-box outputs retain their source box, artwork, mapped value and signed profit through server detection, desktop import and recent-card rendering. One cotton candy is worth ¥9 against ¥15 cost (−¥6); one heart pillow is worth ¥16 (+¥1).

**Architecture:** Keep the existing server-authoritative event contract. Distinguish direct gifts, box products and box outputs. Catalog `isBlindBox` classifies the box product; exact-ID verified output relationships classify outputs. Event `isBlindBox` identifies server-confirmed box output events, including recovered missing upstream flags. Keep `blindBoxId`, name, cost and profit separate from the output gift ID. No third numeric tag or renderer-side matching/settlement.

**Tech stack:** Existing CommonJS services, SQLite, native ESM renderer and Node/VM tests.

## Constraints and current evidence

- Preserve all pre-existing work in both repositories; no branch, commit, release or deployment.
- Installed-client diagnostic reads found remote cotton/pillow rows with flag 0 and null source/cost/profit. Cotton was recorded at ¥15. The local catalog has cotton ¥9, pillow ¥16, heart box ¥15, and the heart-box artwork file exists.
- Historical server diagnostics identify the old V2 parser's unconditional false flag. Current worktree already contains V2 source propagation and valuation repairs from earlier work; do not claim these as new changes.
- Current directly related server tests pass (35); desktop importer/panel tests pass (12). These are isolated synthetic checks, not proof that the running server contains these changes.
- Current card code additionally gates profit on a nonempty source name, although the event contract allows a known ID/cost/profit with an empty name. A named box with unknown profit is incorrectly rendered as zero. Add focused regression coverage before changing this renderer condition.
- Read-only diagnosis is separate from tests. Tests must not use installed-client databases, caches, raw packets or identities.

## Scope and ownership

- Server parser/detector remain the source of event classification and mapped valuation. Add regression cases to `D:/Work/lira-server/test/bilibili-blind-box-valuation.test.js` for both outputs and the final DTO.
- Server `src/lib/gift-blind-box-config.js` owns exact-ID v2 recovery; `src/lib/gift-variant-valuation.js` owns verified activity recovery, ambiguity and identity guards. `src/modules/bilibili/gift-detector.js` applies them when a new group is created.
- Desktop `test/processed-gift-import.test.js` verifies the received metadata survives import and snapshot projection.
- Desktop `public/js/admin/gifts/recent.js` owns profit text and artwork selection; `test/frontend-gifts-panel.test.js` executes the real renderer.
- Shared synthetic scenarios live in `D:/Work/lira-server/test/fixtures/heart-blind-box-events.json`.
- Existing IDs, HTTP/SSE/WS shapes, prices in historical rows, transaction ownership and source isolation remain unchanged. No historical backfill or migration.
- User clarification during implementation explicitly supersedes the previous rule that every mapped output requires an upstream flag. Exact ID plus matching name in an effective v2 relationship may establish an output; activity-aware inference additionally requires a uniquely matched output activity and a verified relation. Shared outputs remain blind-box events with unknown source/cost until disambiguated. Legacy name-only settings alone cannot infer an output; the verified activity catalog can support legacy-mode tenants. Box product entries are not mistaken for their own outputs.

## Work and verification

- [x] Add shared cotton/pillow scenarios and server final-event assertions in legacy, official/custom v2 and activity-aware paths. Verify source attribution, cost/value/profit, and no duplicate final on replay.
- [x] Import the same cases in the desktop and assert snapshot metadata. Run actual recent-card rendering for profit/loss, source-ID-only metadata and unknown profit; assert exact box artwork, color classes and amount text.
- [x] Correct the renderer's profit condition using finite authoritative profit, independent of the optional source name. Keep unknown profit distinct from zero.
- [x] Run server parser/valuation/variant tests and desktop import/panel/gift tests. Review both task diffs and `git diff --check`, preserving concurrent edits.
- [x] Record results and archive this plan. Report separately what was already fixed in source, what this task changed, and what still requires deployment or real-platform verification.

## Commands

Server: `node --test test/bilibili-gift-parser.test.js test/bilibili-blind-box-valuation.test.js test/gift-variant-valuation.test.js test/bilibili-gift-detector.test.js`

Client: `node --experimental-vm-modules --test test/processed-gift-import.test.js test/frontend-gifts-panel.test.js test/frontend-gifts.test.js test/governance-docs.test.js`

Server contracts/governance: `npm run docs:check`.

Both: review scoped diff, `git diff --check`, `git status --short`. No full suite unless a failure establishes a wider regression.

## Results and limitations

- Red/green evidence reproduced omitted-flag server failures and the renderer's empty-source-name failure before the fixes. A further regression reproduced v2 fallback bypassing contradictory activity price/bag evidence; the activity resolver now rejects that inference.
- Server focused checks: 52 passed. Client focused plus documentation checks: 57 passed. Renderer verification executes the actual module in the existing VM harness; CSS checks cover heart-card, profit and loss colors. No installed Electron runtime or live-platform packet verification was performed.
- Server contract/governance checks: 31 passed, 1 pre-existing unrelated failure. `test/room-monitor-overlay.test.js` has 602 lines against the 600-line cap; this task did not edit that file. The protocol, requirement metadata, architecture reachability and source-export checks passed.
- Syntax checks passed for the four changed runtime files. Both repositories passed `git diff --check`; scoped diffs were reviewed against pre-task copies where files already contained other work. No generated runtime data, private identities or captured packets were added.
- Normative REQ-GIFT-006, acceptance criteria, upstream/activity/client-server protocols and desktop ownership/specification text now describe the three roles and the same recovery constraints. No new DTO field, numeric tag, database format or migration was introduced.
- Current worktree V2 parsing/source propagation repairs predated this task. This task added guarded classification recovery, the recent-card profit fix, shared synthetic end-to-end evidence and contract clarification. Deployment must include the pre-existing parser work as well as these changes; deploying only the renderer cannot repair server rows already flagged as ordinary.
- Source updates do not change the installed LIRA binary or the running server. Old misclassified rows are not rewritten, revalued or replayed by this change.

## Failure handling and done condition

Reverse only this task's hunks if necessary; never restore entire dirty files. Completion requires the two expected cards and null/empty metadata cases to pass deterministic tests, with no changed wire/persisted contract and no real data writes. Deployment and reconstruction of old incorrectly classified rows require separate work.
