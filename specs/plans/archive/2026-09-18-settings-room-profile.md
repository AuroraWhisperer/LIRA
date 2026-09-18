# Settings room profile implementation plan

**Status:** Complete.

**Goal:** Show matching account and room cards above six settings in a three-column, two-row layout.

**Architecture:** Keep the existing settings form and authentication flow. A read-only local Bilibili route resolves the saved room through the existing API client and user-info owner; the renderer uses the existing avatar proxy.

**Tech stack:** Electron, CommonJS Node backend, native HTML/CSS, browser ES modules.

## Scope and current behavior

The account card already shows the authenticated account's identity. The room is currently a plain settings input, and the remaining six controls span uneven rows. The existing sender state has only a room name, so it cannot supply the requested avatar. No changes to remote services, credentials, listener configuration, persisted formats, or settings keys are needed.

## Owners and compatibility

- UI: `public/pages/admin/song/settings.html`, `public/css/admin/workspace/base.css`, `public/js/admin/settings-room-profile.js`, and the existing `settings.js` composition root.
- Room data: `src/server/bilibili-runtime.js`, using `BilibiliApiClient.resolveRoomInfo()` and `UserInfoService.ensure()`.
- Transport: the existing runtime/API composition roots and `src/server/routes/bilibili-routes.js`; document the additive route in `docs/architecture/backend/api.md`.
- Add `GET /api/bilibili/room/profile`, protected by existing local management authentication. It accepts no client-selected room and returns only `{roomId, uid, name, avatarUrl}` for the saved room; an empty room returns empty fields.
- Keep the existing account controls, settings IDs, `POST /api/settings`, avatar allowlist/proxy, form validation, and responsive grid behavior. Do not touch pre-existing toolbox edits.

## Milestones

- [x] Add the read-only profile projection and wire it through the existing contexts. Verify saved-room lookup, owner/account separation, empty room, and lookup failure with isolated mocks.
- [x] Reuse account profile styling for the room card, move room input into it, and arrange the remaining six fields in one grid. Bind profile refresh to saved room/auth changes, reject stale responses, and label unsaved room edits. Verify the focused renderer tests and existing account/profile tests.
- [x] Review the rendered desktop layout, run the mechanical design scan, focused contract/composition checks, syntax and architecture gates, and inspect the final diff/status.

## Verification

Use `node --experimental-vm-modules --test` with the affected room/profile, settings/auth, runtime/context, admin composition, and avatar tests. Run `npm run check`, `npm run verify:architecture`, and `git diff --check`. Tests use synthetic identities and mocked network access, without real user data.

## Failure handling and completion

Missing optional owner details keep the room number visible; lookup failure shows a retry hint without changing saved settings. A later room edit invalidates earlier pending results. Reverse only this task's reviewed edits if needed; never reset unrelated changes. Complete when the requested layout and actual owner profile work, focused evidence passes, contracts are documented, and no generated/runtime data is in the diff.

## Results

- Profile/backend, renderer, existing auth/avatar, Bilibili runtime, admin composition/style ownership, settings save/blindbox, toast, runtime-context, and desktop request-auth tests passed. The new HTTP integration test starts an isolated server and checks anonymous rejection and authenticated profile retrieval.
- `npm run check` passed (900 JavaScript files); `npm run verify:architecture` passed. Changed renderer modules were syntax-checked after the final wiring adjustment.
- A hidden Electron 43 preview loaded the actual settings fragment, CSS, and profile adapters with synthetic identities. At a 1426px content width, both cards were 691px wide; the six controls formed two aligned three-column rows without horizontal overflow. Input, save, clear, and restore transitions passed.
- The design detector reported only the two intentionally hidden avatar images whose sources are assigned after profile loading; loaded avatars were visually verified. No new design artifacts or fixture data were added to the repository.
- Live Bilibili network responses were mocked. The existing account/authentication and settings persistence flows remain intact.
