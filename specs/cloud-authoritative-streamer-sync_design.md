# Feature: Cloud-authoritative streamer state sync

## Goal

When an authorized broadcaster changes the live-room or song-request settings,
the Bilibili account, or the song library from either the Electron client or the
Streamer web console, LIRA shall persist the change to the same cloud tenant and
propagate it to the other surface. The cloud monitor shall keep consuming the
configured Bilibili room after the desktop application exits.

## Context

The desktop currently owns its settings, Bilibili Chromium partition, and song
database. The server already owns a per-streamer `RoomMonitor`, encrypted
Bilibili credential storage, and a web-editable song snapshot, but the Device API
does not connect those owners. The accepted server ADR-0004 describes the song
database as a manually uploaded display snapshot; this feature replaces that
decision with cloud-authoritative last-successful-write synchronization.

## Requirements

- While a Device session is authorized, when the desktop starts or a cloud
  revision changes, the desktop shall apply that streamer's cloud settings,
  Bilibili login state, and song library.
- While the desktop is authorized, when a synchronized local setting, Bilibili
  login, or song mutation succeeds locally, the desktop shall upload the new
  tenant snapshot and retry transient failures without accepting an older cloud
  snapshot over a pending local write.
- While a Streamer web session is authenticated, when the broadcaster edits the
  synchronized settings or songs, the server shall update only that session's
  tenant and advance its revision.
- While a Streamer web session is authenticated, when the broadcaster requests a
  Bilibili QR login, the server shall obtain and poll the QR challenge, keep all
  resulting cookies out of browser responses, and encrypt a successful login in
  the tenant database.
- While a non-empty room, enabled monitor, active tenant and Bilibili login are
  saved, the cloud shall restart that tenant's `RoomMonitor`; clearing the room,
  disabling monitoring or successfully synchronizing Bilibili logout stops it.
- Before Bilibili credentials are saved in the authorized tenant, the cloud
  shall not poll the room or capture danmaku/gifts anonymously. Local login alone
  is not proof of successful cloud synchronization.

## Synchronized data

The settings scope is intentionally limited to the controls in the current
Bilibili/song-request settings card:

- `roomId`
- `enableBilibili`
- `paused`
- `queueLimit`
- `userCooldownSeconds`
- `onlyFromLibrary`
- `allowDuplicate`

The song scope is the complete library of at most 5000 songs. The Bilibili scope
is the cookie-backed account identity required by server-side Bilibili requests.

## Architecture

### Frontend

- The Streamer `/manage` page gains a settings form, Bilibili QR login/status,
  and existing song management remains the remote song editor.
- The Electron renderer never receives cloud Bilibili cookies. Existing local
  settings and song routes remain the UI write surface.
- Save, loading, QR expiration, scanned-but-unconfirmed, success, and error states
  are explicit and rendered with text-safe DOM operations.
- Desktop login help explains current-LIRA-account ownership, successful upload
  plus configured/enabled room as prerequisites, and the difference between
  closing the app and explicitly logging out. The local status label does not
  claim cloud readiness; offline logout takes effect remotely only after sync.

### Backend

- `streamerId` comes only from Device Bearer or Streamer Cookie authentication.
- A streamer-state module normalizes settings, writes `streamers.room_id` and
  tenant `streamer_settings`, advances per-scope revisions, and calls
  `monitorManager.syncStreamer(streamerId)`.
- Song writes advance a per-tenant song revision. Existing Device and Streamer
  song APIs return that revision without changing the 5000-song ceiling.
- A Bilibili QR module calls Bilibili's generate/poll endpoints, holds only the
  short-lived pending QR challenge in memory, parses successful response
  cookies, verifies the account, and persists AES-GCM ciphertext.
- The Device API exposes credential material only to an authenticated device.
  The Streamer browser API exposes only `loggedIn`, UID, update time, and QR
  state.

### Desktop main process

- A single sync controller keeps one authenticated SSE stream for revision-only
  invalidations and reads authoritative cloud metadata immediately after
  authorization, resume, or stream reconnection. A 10-minute metadata poll is
  retained only as an automatic fault fallback.
- Per-scope dirty flags and local mutation generations serialize writes. A
  dirty local scope is retried and is not overwritten by polling until its
  latest upload succeeds. A mutation that occurs during an upload remains dirty
  for another upload, and a remote payload is checked again after any awaited
  content fetch before it may replace local state.
- Sync work is bound to the authenticated remote origin and LIRA accountName,
  not a Bilibili UID or room. Switching account/origin aborts old work and clears
  its dirty/revision baselines; late old-account responses are discarded. A
  same-account temporary authorization interruption retains pending retries.
- Cloud settings are written into the local settings store and reconfigure the
  local Bilibili runtime. Cloud songs replace the local library transactionally.
- Cloud Bilibili cookies are imported into `persist:bilibili`, saved with
  `safeStorage`, and never cross preload/IPC into a renderer.

## Conflict semantics

The cloud revision is monotonic per scope and the last successful cloud write
wins. There is no field-level merge or CRDT. A desktop local mutation that has
not reached the cloud remains dirty and is retried; remote changes made during
that window may subsequently be overwritten by the later successful desktop
write. This limitation is visible in the specification and tests.

## Security

- Device and Streamer routes derive tenant scope from verified authentication;
  payload `streamerId`, paths, roles, and ownership are ignored.
- Settings and song payloads are independently validated server-side and use
  parameterized SQLite statements.
- QR creation is rate-limited and pending login identifiers are random,
  tenant-bound, single-use, and expire with the upstream QR.
- QR cookies, CSRF values, refresh material, ciphertext, Device tokens, and raw
  event payloads never enter Streamer browser responses, renderer IPC, logs, or
  audit detail.
- Cloud credential import occurs only in Electron main and the local encrypted
  cookie snapshot remains protected by `safeStorage`.

## Compatibility

- Existing local routes, settings keys, song schema, Streamer song CRUD URLs,
  public song page, Device authentication, and local Bilibili listener remain.
- Existing song IDs are snapshot-local and are not used as stable cross-device
  identifiers. Applying a cloud snapshot clears stale local `song_id` references
  while preserving textual queue/request history.
- A settings/songs scope with no initialized revision is seeded from the first
  authorized desktop. Existing non-empty cloud song, room and credential data
  stays initialized. An uninitialized Bilibili scope clears the unowned local
  Cookie instead of seeding it; the user must explicitly log in for the current
  LIRA account. Existing cloud login state restores normally. This narrows the
  original credential-seeding rule under server ADR-0026.
- Bilibili upstream disconnect windows still have no historical replay guarantee.

## Non-goals

- Syncing music-provider accounts, playback queues, gift-effect themes, all
  desktop appearance settings, or arbitrary local files.
- Exposing Bilibili cookies to the browser or Admin actor.
- Zero-loss Bilibili event recovery, field-level conflict merging, or offline
  multi-device editing guarantees.

## Acceptance Criteria

1. A Device cannot read or mutate another Streamer's settings, songs, or
   credentials by submitting an ID.
2. A room URL saved in either surface is normalized to its numeric room ID,
   advances the settings revision, and immediately starts/stops the cloud monitor
   according to `enableBilibili` and saved Bilibili credentials.
3. The web QR flow reports not-scanned, scanned, expired, and success states; on
   success the browser receives no Cookie/CSRF while the tenant has encrypted
   credentials and an account UID.
4. A local Bilibili login uploads to the tenant; a remote login or unlink is
   imported by Electron main on the next sync without credentials entering the
   renderer.
5. Web song add/edit/delete and desktop song mutations advance a revision and
   converge to the same complete library, with no partial replacement.
6. A pending transient desktop upload is retried, a mutation during upload is
   uploaded again, and polling/content fetches do not replace that dirty scope
   with an older cloud snapshot.
7. Closing Electron stops only its local listener; the independently deployed
   server monitor remains eligible and running.
8. An online Streamer web write emits only the changed scope revision and causes
   Electron to reconcile without waiting for fallback polling. Offline Devices
   have no server-side notification queue and reconcile current revisions after
   startup or reconnection.
9. A's login/logout changes only A's cloud credentials and monitor. A pending
   upload cannot be retried under B, a late A response cannot replace B's local
   Cookie, and switching back to A restores A's saved state independently of B's
   revision. An empty B account never receives unowned local credentials.

## Done When

Server requirements, acceptance criteria, traceability, protocol Markdown,
Device/Management OpenAPI, the superseding ADR, client architecture docs, source,
and focused automated tests all describe and verify the same behavior. Both
repositories pass their justified full verification gates and final diffs contain
no secret or generated runtime material.
