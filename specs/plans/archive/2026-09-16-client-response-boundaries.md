# Client Response Boundaries Implementation Plan

Status: Complete.

**Goal:** Resolve audit F06/F08/F09 without losing valid local state or HTTP authorization facts.

**Architecture:** The remote client owns HTTP error metadata. Cloud and gift controllers own recovery scheduling and snapshot application. Existing license-manager rejection policy consumes preserved HTTP status.

**Tech Stack:** CommonJS, Node test runner, existing controller fixtures.

## Constraints and ownership

- Preserve unrelated work and existing wire contracts; no commits or new dependencies.
- Read server protocol and accepted client specs. Fix implementations to conform: Retry-After is a minimum wait; SongListResponse requires an array; HTTP 401 remains a rejection regardless of body.
- Own remote-license-client.js, cloud-sync-controller.js and focused tests. Coordinate only retry sections of remote-gift-controller.js with the owner-isolation worker. License manager and shared server requirements remain with their assigned workers.

## Milestones and verification

- [x] Preserve valid Retry-After delta seconds and HTTP dates as error.retryAfterMs for JSON, malformed and SSE errors. Test real Response headers and invalid headers.
- [x] Schedule gift and cloud recovery with Math.max(localBackoff, retryAfterMs); retain the local exponential cap. Test real client errors reaching controllers and preserved dirty data.
- [x] Reject non-array songs with INVALID_RESPONSE before local replacement or revision advancement; test missing/null/object and legal empty arrays, then successful retry at the same revision.
- [x] Verify SSE 401 null/array/text through the real parser and license manager clears authorization/token.
- [x] Update cloud specification requirements and acceptance; coordinate gift/license and server text with their owners.
- [x] Run node --test test/client-response-boundaries.test.js test/cloud-sync-controller.test.js test/remote-license-client.test.js test/remote-gift-controller.test.js test/license-manager-renewal.test.js, inspect scoped diff and git diff --check.

## Failure handling and completion

Malformed snapshots leave local songs and revision untouched. Temporary failures retain dirty state and valid identity. Authorization failures stop maintenance through existing manager policy. Revert only task-owned hunks if needed; do not reset other workers' edits. Done when focused boundaries pass and contracts agree.

## Verification result

Completed 2026-09-16. `node --experimental-vm-modules --test test/client-response-boundaries.test.js test/cloud-sync-controller.test.js test/remote-license-client.test.js test/remote-gift-controller*.test.js test/license-manager-renewal.test.js test/gift-interaction-controls.test.js` passed 95/95; `git diff --check` passed. Cloud test fixture moved to `test/helpers/cloud-sync-controller-fixture.js` to keep tests inside reviewed size. Parent worker owns source-size review registrations and combined repository verification. Includes restart/old-timer fences, long timer chunking and dirty retry recovery.
