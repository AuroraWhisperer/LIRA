# Browser Component Preview Correction

**Status:** Completed.

**Goal:** Clicking the existing danmaku, clock, queue or overtime preview action opens an editable local webpage in the system default browser. Remove the added toolbox workspace/scene buttons. The desktop app remains the owner of configuration and saving.

**Architecture:** Reuse the existing parameter panels, component renderers and configuration controllers. A bounded, memory-only preview session relays configuration state and edit/save/discard commands between the browser and its originating desktop controller. Browser capabilities cannot access admin APIs, IPC, scene management or business actions.

**Tech Stack:** Existing Node HTTP, vanilla ESM/CSS and Electron external navigation policy. No dependency, process or database changes.

## Requirement And Current Behavior

The user explicitly corrected the earlier interpretation: preview means the local webpage opened by the system default browser, with editing added there. The previous implementation creates a desktop dialog and adds two toolbox actions. Its passing Electron tests do not establish the requested browser behavior.

## Ownership And Constraints

- `public/js/admin/component-preview-dialog.js` currently owns the incorrect launch surface; replace the launch with an external browser session.
- Component owners retain their exact existing controller and persistence adapters, including cloud danmaku IPC. Extract reusable panel/preview definitions only where needed by the browser entry.
- A new local preview page composes inert parameter templates from existing fragments, with no admin bootstrap or preload dependency.
- The HTTP transport owns memory-only relay sessions. Fixed command types, bounded payload/queue/session counts, exact origin checks, private random capability, parent heartbeat expiry and authorization identity/generation changes constrain them.
- Do not expose the desktop admin token or weaken `/admin`, existing overlay HTTP/WS or Electron navigation policies. Do not migrate or delete persisted scene data.
- No added toolbox entry, unrelated UI redesign, remote server migration, commits or deployment.

## Milestones

- [x] Remove the two toolbox actions, handlers and their now-unused button styles.
- [x] Add the scoped browser relay and focused tests for authentication, cross-session denial, expiry, identity changes, queue ordering, acknowledgement and bounded inputs.
- [x] Reuse component panels in a standalone browser page; launch it through existing `window.open` external navigation. Keep preview examples separate from real business actions and keep existing saves authoritative.
- [x] Verify browser edits, save success/failure, close/reopen, four renderers and the Electron external-open policy using synthetic isolated data.
- [x] Update current contract references, run relevant tests/gates, review final diff and archive this plan when complete.

## Verification

Run focused Node tests for preview sessions, browser controller/launcher, existing component controller/preview contracts and toolbox composition. Run affected HTTP access-policy and desktop-request-auth tests. Use an isolated local HTTP fixture and real browser UI for the four components; use the existing isolated Electron fixture or direct policy tests for the `shell.openExternal` handoff. Run `npm run check`, `npm run verify:architecture`, `npm run verify:docs` because this changes a public page/API boundary, followed by `git diff --check` and `git status --short`.

## Failure Handling And Done When

Lost/expired desktop sessions disable browser editing and ask the user to reopen preview. Commands are acknowledged in sequence and never replayed after acknowledgement. Failed domain saves preserve drafts. Closing or replacing the parent session releases listeners and timers; expiry removes abandoned sessions. Revert only task-owned hunks if needed, preserving existing configuration/data. Completion requires actual external-browser editing/save evidence and no remaining toolbox additions or desktop modal launch on these four preview paths.

## Evidence And Limits

- All four real browser page tests passed in `test/admin/component-preview-browser.test.js`, including visible parameter changes, authoritative controller saves, clock save failure/retry, overtime sample isolation, disconnection and reopening. The browser context has no desktop token/preload; synthetic desktop persistence is deliberate and does not contact real accounts.
- Session/remote/controller/registry/preview contracts passed. Added coverage proves that browser closure drains already accepted edits/saves before the parent releases the session, and that owner/generation changes, expired/forged/cross-component capabilities, opaque/foreign origins, oversized bodies and queue overflow cannot bypass the boundary.
- The existing isolated Electron probe passed after adding asynchronous `window.open` for all four preview types. It captures the real main-process handoff to `shell.openExternal` and proves no new Electron window opens. The probe does not launch the user's OS browser or manipulate their running app.
- `npm run test:admin`: 114 passed; `npm run verify:architecture`: 22 passed; `npm run verify:docs`: 9 passed. Repository syntax checking and final changed-source syntax checks passed. Existing HTTP/WS access-policy, scene HTTP/runtime, workspace and desktop policy tests passed.
- Actual local preview route returned HTTP 200 before navigation. The in-app browser displayed the standalone clock page with its renderer, parameter panel and save footer; visual inspection passed. Its temporary tab and the synthetic HTTP process were closed. No production account, persisted user configuration, commit, packaging or release action was performed.
- API documentation and the earlier component-workspace specification now record the corrected browser entry. One reviewed composition line passes the existing trusted authorization owner to preview sessions; its modularity ceiling was explicitly reviewed and updated.
