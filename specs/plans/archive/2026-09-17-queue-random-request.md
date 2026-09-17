# Queue Random Request Implementation Plan

Status: Complete

## Goal

Add “随机点歌” before “切歌” in the song queue header, using the same
button styling. A click requests a random song as the currently logged-in
Bilibili account through the existing danmaku command rules.

## Current Behavior And Ownership

- `public/pages/admin/song/shell-start.html` and `public/js/admin/queue.js`
  own queue controls. Existing `primary` and `queue-action-icon` styles match
  the supplied screenshot; no CSS changes are needed.
- `src/server/bilibili-runtime.js` owns the trusted auth provider and user-info
  facade. Its new `requestRandomSong()` capability resolves the account and
  calls `domainServices.messages.handleDanmaku()` with “随机点歌”.
- `src/bilibili/bilibili-message-handler.js` retains ownership of random
  selection, cooldown and pause rules; queue-service retains queue validation.
- `src/server/runtime-api-context.js` and `src/server/api-context.js` expose
  this operation to `src/server/routes/queue-routes.js` as `queue.requestRandom`.
- `docs/architecture/backend/api.md` owns the new HTTP contract.

## Compatibility Constraints And Non-goals

Preserve all existing endpoints, Electron security, data formats, point-request
rules and unrelated working-tree changes. No new dependency, IPC, outbound
danmaku, database schema, account source or stylesheet. Ignore client-supplied
requester identity; account UID comes only from the existing auth provider.

## Changes And Milestones

- [x] Add focused regression tests using synthetic accounts and temporary data.
  Check HTTP authorization, current-account attribution, disabled/empty library,
  pause, cooldown, duplicate and queue-capacity behavior. No external services.
- [x] Add `POST /api/queue/random` with no input. On accepted requests return
  `{ok:true,data:queueItem}` and broadcast the existing `queue:add` reason.
  Return 400 `{ok:false,error}` for rejected commands and the two expected queue
  conflicts (duplicate song and full queue). Other errors retain top-level
  redaction. Wire the runtime capability through the API context.
- [x] Add the matching primary button and shuffle SVG symbol. Disable the
  button while awaiting the operation; show success or the server error and
  refresh state on success. Verify one request per pending click and recovery
  after failure using the existing frontend module/DOM test helpers.
- [x] Update the API registry, run focused checks, and review the final diff.

## Verification

Run `node --experimental-vm-modules --test test/queue-random-request.test.js
test/frontend-queue-random.test.js test/random-song-filter.test.js
test/queue-service.test.js test/bilibili-runtime.test.js
test/frontend-admin-layout.test.js test/frontend-admin-queue-copy.test.js`.
Run `npm run check`, `npm run verify:architecture`, `npm run verify:docs` and
the existing server smoke test because the new route is wired through shared
API context. Inspect the new control against existing header markup/styles and
run the scoped design detector. Finish with `git diff --check` and
`git status --short`.

## Failure Handling And Done When

Keep all tests isolated from real user data and live chat. If checks fail,
fix only task-owned causes; reverse only task-owned hunks if needed. Finish
when clicks use the logged-in account and existing random-request rules, the
button matches its neighbor, checks pass or limitations are recorded, and
the diff preserves all pre-existing changes. Archive this plan when complete.

## Results

The new frontend and HTTP regression tests pass with synthetic accounts and
isolated temporary databases. They cover pending-click suppression, error
recovery, authorization, identity spoofing, account changes, paused/cooldown/
empty-or-disabled-library/duplicate/full-queue outcomes. Existing random-song,
queue-service, Bilibili runtime, admin layout/copy and server smoke checks pass.
Syntax checks, architecture checks (22), governance checks (5), and the scoped
design detector pass. The final route edit also passed `node --check`.

Visual consistency is established by the identical existing `primary` and
`queue-action-icon` classes and unchanged CSS; no live Electron account was
used for manual clicking. All existing installer, CSS and layout-test changes
were preserved; this task only adds the button fixture to the existing layout
test. No actual danmaku was sent.
