# Gift avatar recovery implementation plan

**Goal:** Gift cards obtain missing avatars by the authenticated sender UID and recover after temporary Bilibili failures.

**Architecture:** Keep frozen gift ledger data and the server DTO unchanged. The local gift-card runtime consumes the existing Bilibili user-info facade through an injected avatar lookup; the facade remains the profile cache and request-deduplication owner.

**Current evidence:** `createGiftBanner` uses a placeholder for missing URLs. `getProfiles` copies packet-only profiles without fetching missing avatars. The server's dedicated card-profile `senderId` is a reliable UID; normal history intentionally excludes UID. `fetchUserProfile` ignores nonzero API codes and lacks a request timeout.

**Compatibility:** Preserve current-day/source/epoch fences, raw gift amounts, rank evidence, UID exclusion in ordinary history, trusted-image validation, local avatar proxy, export snapshots, and unrelated working-tree changes. Unknown UID and older history cannot be inferred by nickname. No new endpoint, storage migration, dependency, commit, or deployment.

## Implementation and verification

- [x] Add focused reproductions in `test/gift-card-runtime.test.js` for UID-only enrichment, cached avatars surviving null records, independent same-name senders, recovery, and late source/reset responses.
- [x] In `src/server/gift-card-runtime.js`, reuse known same-day avatars and resolve missing unique senders with at most four concurrent lookups and a four-second wait budget. Return available data on upstream failure; unresolved requests remain bounded by the provider timeout and are cached by the facade for the next read. Wire a narrow `getUserAvatar` facade in `src/server/bilibili-runtime.js`, `src/server/gift-export-runtime.js`, and `src/server.js`.
- [x] Cover Bilibili business failures, incomplete profiles, and bounded requests in avatar/user-info tests. Set an eight-second profile request timeout, reject nonzero upstream codes, and apply the existing 30-second negative cache to incomplete profiles.
- [x] Verify stable overlay cards retry an image after a temporary loading failure using the existing browser fixture. Also give PNG avatar loading nine seconds so it does not preempt the eight-second proxy timeout.
- [x] Update owning architecture documentation and run focused verification. Final source diff reviewed; final documentation/diff checks follow archival.

## Verification results

- Missing-avatar cases failed before the fix. The static-card image recovery reproduction also failed before the renderer fix.
- The focused run of ten avatar, user-info, gift-card, banner, feed and export test files passed all 56 tests.
- After the user's clarification that every refresh should repair missing avatars, cached metadata fallback also gained enrichment. `node --experimental-vm-modules --test test/gift-card-runtime.test.js` passed all 12 cases, including the new server-offline recovery case (57 distinct focused cases overall).
- `npm run verify:architecture`: 22 passed. `npm run verify:modularity`: zero errors. All 12 affected JavaScript files passed syntax checks.
- Existing UI changes from other work remain untouched. No real account data was changed and no application was restarted or deployed.

## Failure handling and completion

Keep placeholders for unresolvable UIDs or upstream failures; retry on subsequent reads. Never replace an already-known avatar with null or publish a late profile across a source/day/reset boundary. Tests use synthetic profiles only. Live account verification depends on the user's asuka UID, which is not in this checkout's local gift data. Reverse only this task's scoped changes if needed. Complete once the focused regressions and final review pass, with any live-verification limitation reported.
