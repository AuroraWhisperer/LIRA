# Log Volume Phase A1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Completed and verified on 2026-09-14.

**Goal:** Stop the largest known successful-path log growth in the client repository and make the remaining AI, desktop, and terminal records byte-bounded without changing playback, gift delivery, update, authentication, or persistence behavior.

**Architecture:** This is the first independently verifiable slice of Stage A from `specs/client-server-logging-design.md`. Business owners stop emitting high-frequency detail at the source; the existing local log adapters gain narrow byte admission and AI success aggregation. The later unified JSONL stream owner, daily budget recovery, rotating directories, breadcrumbs, diagnostics UI, adjacent `lira-server` work, and production deployment remain separate milestones.

**Tech Stack:** Node.js 24 CommonJS, Electron 43 main/preload IPC, vanilla JavaScript ES modules, `node:test`.

## Global Constraints

- Preserve current Electron context isolation and all existing IPC result shapes.
- Keep `desktop:gift-display` as a compatibility no-op; do not expose a new renderer privilege.
- Do not log prompts, chat text, model output, tool arguments, gift/user detail, lyric text, or credential material.
- Normal entries are at most 2 KiB and error entries are at most 16 KiB after UTF-8 encoding.
- Do not truncate or delete legacy log contents during logger initialization.
- Do not change production configuration, PM2, Nginx, or files outside `D:/Work/Live`.
- Preserve all unrelated working-tree changes, including the active gift-toast and gift-effect work.
- Do not create commits unless the user asks.

---

## Scope And Ownership

### Files created

- `src/shared/log-size-limit.js`: UTF-8-aware record limiting and bounded synchronous append used by the two existing Electron text adapters.
- `specs/plans/archive/2026-09-14-log-volume-phase-a1.md`: this completed implementation record.

### Files modified

- `src/ai/deepseek-client.js`: emit one metadata-only success event or one safe failure event per provider operation.
- `src/ai/request-logger.js`: aggregate successes into an activity-only 15-minute summary, retain failures immediately, append rather than reset, and enforce final byte limits.
- `src/server/ai-runtime.js`: route the runtime logger to the new runtime/errors AI files while leaving legacy `ai.log` read-only.
- `src/electron/desktop-logger.js`: cap each legacy desktop entry and stop appending after the legacy file reaches its hard single-file ceiling.
- `src/electron/terminal-log.js`: retain console display, mirror only WARN/ERROR, append across sessions, and enforce byte/file ceilings.
- `src/electron/ipc/update-ipc.js`: preserve `desktop:gift-display` but remove per-toast console and disk output.
- `src/electron/main.js`: remove the gift-detail normalizer that becomes unused when the IPC handler is a compatibility no-op.
- `public/js/admin/gifts/notification.js`: stop sending every displayed gift to the diagnostic-only IPC bridge while preserving the user's current toast behavior.
- `src/server/runtime-transport.js`: stop calling the per-final-gift reporting path while preserving broadcast/frame/effect ordering and the current uncommitted gift-effect changes.
- `src/server/runtime-reporting.js`: remove the obsolete per-gift detail writer.
- `public/js/playback/core/renderer.js`: remove per-render success console output.
- `public/js/playback/ui/fullscreen.js`: remove lyric rerender/index/scroll success output and non-actionable missing-line warnings; retain the actual play-after-seek failure warning.
- `test/ai-request-logger.test.js`: cover aggregation, append behavior, redaction, final byte ceilings, and bounded queue behavior.
- `test/ai-provider-contracts.test.js`: prove the model client never emits request/response bodies and emits duration/token metadata.
- `test/desktop-logger.test.js`: cover desktop entry and compatibility-file ceilings plus non-interference for cyclic input.
- `test/terminal-log.test.js`: prove INFO/DEBUG are not mirrored, old content is preserved, and WARN/ERROR entries are bounded.
- `test/gift-diagnostics-wiring.test.js`: prove finalized gifts still broadcast and toast display still works without per-gift diagnostic writes.
- `test/frontend-playback.test.js`: prove the named high-frequency console statements stay absent.
- `docs/architecture/backend/server-core.md`: remove the obsolete per-gift logging step from the runtime transport description.
- `docs/architecture/backend/ai.md`, `docs/architecture/desktop/main.md`, `docs/architecture/desktop/preload.md`: keep owner documentation aligned with the A1 runtime behavior.
- `docs/reports/2026-09-14-log-volume-and-signal-report.md`: add a dated implementation-progress note without rewriting the original evidence.
- `specs/client-server-logging-design.md`, `specs/README.md`, `docs/architecture/adr/0018-unified-logging-and-diagnostics.md`: record user approval and the in-progress scope without claiming later stages are implemented.

### Interfaces

- `truncateUtf8(value, maxBytes, marker?) -> string` keeps the encoded result within `maxBytes`.
- `appendBoundedFileSync(filePath, line, { maxEntryBytes, maxFileBytes }) -> { written, reason, bytes }` never grows the target beyond the configured ceiling.
- `createAiRequestLogger(options) -> { filePath, log, flush, getHealth }`; `log()` accepts only `request_succeeded` and `request_failed` provider events for persistent output.
- `desktop:gift-display` continues returning `{ ok: true }` for compatibility but stores no gift payload.

## Task 1: Add failing volume and privacy tests

- [x] Update `test/ai-provider-contracts.test.js` so a successful request expects exactly `request_succeeded` with `requestId`, `provider`, `model`, `purpose`, `protocol`, `status`, `durationMs`, token counts, and function-call count. Assert that serialized events do not contain `body`, `payload`, `rawText`, `result`, the prompt, or the model answer.
- [x] Update `test/ai-request-logger.test.js` to use a fixed clock, record multiple successes, verify no empty summary is written before activity, call `flush()`, parse JSONL, and assert one `ai.requestSummary` with exact counts and observed `windowStart/windowEnd`.
- [x] Add a synthetic multibyte error with a very long message/stack and assert every emitted line is at most 16,384 UTF-8 bytes while `code`, `name`, and the truncation marker remain.
- [x] Update `test/terminal-log.test.js` to seed an existing file, emit all five console methods, and assert only the existing content plus WARN/ERROR records remain.
- [x] Update gift and playback tests to reject the known high-frequency output strings and per-toast diagnostic call.
- [x] Run:

  ```powershell
  node --experimental-vm-modules --test test/ai-request-logger.test.js test/ai-provider-contracts.test.js test/terminal-log.test.js test/gift-diagnostics-wiring.test.js test/frontend-playback.test.js
  ```

  Expected: the new assertions fail against the current verbose/resetting implementations; the pre-existing toast-key assertion is removed rather than made to match stale diagnostics.

## Task 2: Bound existing text adapters

- [x] Add `src/shared/log-size-limit.js` with UTF-8 binary-search truncation that reserves space for `...[truncated]` and a bounded append that checks the final encoded entry and current file size before calling `appendFileSync`.
- [x] Change `src/electron/desktop-logger.js` to choose 2 KiB for ordinary values and 16 KiB for `Error`/error-like scopes, then call `appendBoundedFileSync` with a 10 MiB legacy-file ceiling.
- [x] Change `src/electron/terminal-log.js` to wrap only `warn` and `error`, stop calling `writeFileSync(filePath, '')`, and use the shared helper with 2 KiB WARN / 16 KiB ERROR and a 10 MiB legacy-file ceiling.
- [x] Run:

  ```powershell
  node --test test/terminal-log.test.js test/log-redaction.test.js
  ```

  Expected: all tests pass; console output still reaches the original methods, old file content survives logger installation, and persisted entries are bounded.

## Task 3: Replace AI bodies with summaries and bounded failures

- [x] In `src/ai/deepseek-client.js`, record the operation start time locally, capture only HTTP status from `onResponse`, and emit one `request_succeeded` event after normalization. Include numeric duration, input/output token counts, finish reason, and function-call count; omit URL and all request/response bodies.
- [x] Emit one `request_failed` event at the owning catch boundary with the same stable metadata and a safe `{ code, name, message, stack }` error object; preserve `AI_SHUTDOWN` as a non-error cancellation.
- [x] In `src/ai/request-logger.js`, keep at most 128 summary groups, merge overflow into `other`, start a timer only after real activity, and write no empty windows. `flush()` clears the timer, writes active summaries, and waits for the bounded queue.
- [x] Limit pending writes to 2,000 entries / 4 MiB encoded payload with reserved headroom for errors. Expose dropped counts through `getHealth()`; logging failure never fails the AI request.
- [x] Redact before encoding, cap normal JSONL at 2 KiB and failure JSONL at 16 KiB, leave legacy `ai.log` read-only in runtime mode, and stop each new AI stream file at its A1 single-file ceiling.
- [x] Run:

  ```powershell
  node --test test/ai-request-logger.test.js test/ai-provider-contracts.test.js test/ai-provider-adapters.test.js
  ```

  Expected: all tests pass and no fixture prompt/model response appears in any captured log event or file.

## Task 4: Remove high-frequency gift and playback output

- [x] Preserve the `desktop:gift-display` channel and `{ ok: true }` result in `src/electron/ipc/update-ipc.js`, but remove its console/writeLog calls and the now-unused normalizer dependency.
- [x] Remove the diagnostic-only `reportGiftDisplay` call from `public/js/admin/gifts/notification.js`; do not change toast keys, copy, stacking, timing, or the user's current edits.
- [x] Remove the final-gift reporting import/call/export from `src/server/runtime-transport.js` and delete only the obsolete `src/server/runtime-reporting.js` module.
- [x] Remove the listed normal render/lyric console statements. Keep the warning for a rejected `audio.play()` call because it represents an actual operation failure.
- [x] Update `docs/architecture/backend/server-core.md` so the runtime transport order matches the code.
- [x] Run:

  ```powershell
  node --experimental-vm-modules --test test/gift-diagnostics-wiring.test.js test/frontend-playback.test.js test/websocket-transport.test.js
  ```

  Expected: all tests pass; gift snapshots/frame/effect broadcasts and toast behavior remain, while no per-final/per-toast/per-lyric successful-path diagnostic is emitted.

## Task 5: Record governance state and verify the slice

- [x] Mark ADR-0018 accepted by the user's 2026-09-14 instruction and the logging design `In Progress`; state explicitly that only Phase A1 source reduction and local adapter bounds are implemented.
- [x] Update the specification index to `In Progress` without changing unrelated rows.
- [x] Run the directly affected test set, `npm run check`, and `git diff --check`.
- [x] Inspect `git diff --` for every touched path and `git status --short`; distinguish pre-existing changes in `public/js/admin/gifts/notification.js`, `src/server/runtime-transport.js`, and `specs/README.md` from this task's hunks.

## Implementation Results

- Focused verification passed: 96 tests covering AI contracts/adapters, bounded loggers, gift/playback behavior, WebSocket transport, Electron lifecycle/state, and updates.
- `npm run check` passed for 734 JavaScript files; `npm run verify:docs` passed 5/5; `git diff --check` reported no whitespace errors.
- `npm run verify:architecture` passed 21/22. Its only failing gate lists pre-existing size-review drift in unrelated CSS/HTML, Bilibili provider, and storage migration files; none is touched by Phase A1.
- A baseline gift-diagnostics test initially expected the stale toast key `gift:2:1:1`; the existing user change uses `gift:2`. The updated test preserves that user behavior and verifies only removal of the diagnostic call.
- Runtime AI diagnostics use `logs/runtime/ai.jsonl` and `logs/errors/ai.jsonl`; legacy `logs/ai.log` stays read-only. Date rotation, retention, persistent daily budgets, error deduplication, and context capture remain later milestones.

## Rollback Or Failure Handling

Stop after the last passing task if a later ownership conflict appears. Inspect only this plan's paths and reverse only task-owned hunks with `apply_patch`; never use reset, blanket checkout, or deletion outside the obsolete `runtime-reporting.js` module. Legacy logs and user data are never modified by tests, which use temporary directories.

## Done When

- High-frequency gift final/display, playback render, lyric line, and lyric scroll success paths do not emit individual diagnostic records.
- AI success logging contains counts, timing, tokens, and bounded grouping but no prompts or responses; AI failures retain safe core fields.
- Normal/error entries meet 2 KiB / 16 KiB UTF-8 ceilings, pending AI writes are bounded, and logger initialization preserves prior file content.
- Focused tests and JavaScript syntax checks pass, `git diff --check` is clean, and no unrelated user change is overwritten.
- The archived plan and governance documents accurately identify Phase A1 as complete while the broader logging specification remains in progress; daily-budget persistence, rotation/retention, contexts, UI, server repository, and deployment remain explicitly pending.
