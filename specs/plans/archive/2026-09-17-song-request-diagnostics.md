# Login to song request diagnostics implementation plan

Status: Complete — 2026-09-17. The user confirmed the incident recovered and
requested retaining the logging improvement for future incidents.

## Goal

Persist enough local evidence to follow a fresh Bilibili login, credential
replacement/read, live refresh, WebSocket authentication and a song request's
receipt, filtering and queue result on an affected installed desktop client.

## Scope and compatibility

This is diagnostic instrumentation. Preserve login/IPC results, session partitions,
safeStorage, connection/retry decisions, queue rules and public API shapes. Do not
publish, change versions or touch unrelated work in the working tree. The existing
connection-success and credential-reconnect behavior remains observable; this plan
does not claim to repair the remote user's unknown failure.

Reuse desktop.log/terminal.log, their run/sequence metadata, redaction and 10 MiB
file limits. Only explicitly selected Bilibili diagnostic INFO enters terminal.log;
ordinary console output remains excluded. Never record credentials, auth packets,
raw packets, viewer UID/name or chat text. Song requests use an ephemeral keyed
reference, type, timing, masked-name flags and stable outcome codes.

## Current behavior and ownership

- `src/electron/desktop-auth-controller.js` owns desktop login/auth operations;
  `bilibili-login-window.js` owns its window, snapshot and polling lifecycle.
- `src/server/bilibili-runtime.js` reads credentials and replaces the client.
  Cloud sync imports through the desktop auth controller. Existing windows/auth
  errors are in desktop.log but successful credential changes lack evidence.
- `src/bilibili/danmaku/websocket-connection.js` owns frames and heartbeat timers.
  It currently ignores operation 8 authentication replies. Add observations only,
  with missing authentication reported at the first existing heartbeat tick.
- `src/bilibili/danmaku-client.js`, message handlers, history poller and deduplicator
  own ingress and pre-business filters. `src/server/bilibili-client.js` owns the
  request dispatch and queue broadcast. Existing command console.log output is
  excluded by `src/electron/terminal-log.js`.
- Contracts: `docs/architecture/desktop/auth.md`,
  `docs/architecture/backend/bilibili/danmaku.md`,
  `docs/architecture/backend/bilibili/protocol.md`, ADR-0018 and
  `specs/client-server-logging-design.md` field privacy rules.

## Milestones

- [x] Add a domain-local safe diagnostic formatter and selective INFO file capture;
  test actual temporary log output, secret/body exclusion and console restoration.
- [x] Instrument login completion/snapshot, credential replacement/read and refresh;
  verify existing login/cloud/runtime cancellation tests plus new log assertions.
- [x] Observe authentication success/rejection/malformed/missing reply and bounded
  traffic counts using the existing heartbeat. Verify mixed frames, old sockets,
  close/replacement cleanup and unchanged transport behavior.
- [x] Trace received, stale, duplicate, ignored, failed and accepted song requests,
  including masked-name evidence and queue broadcast. Exercise real dispatch with
  synthetic messages and temporary logs; retain existing queue/dedup tests.
- [x] Document event meanings and reproduction instructions, review only touched
  changes, run `git diff --check` and inspect `git status --short`.

## Verification

Use `node --test` on terminal-log, desktop-logger, log-redaction,
bilibili-login-window, bilibili-auth-profile, cloud-sync-controller,
bilibili-runtime, websocket-connection, danmaku-client, message-deduplicator,
bilibili-message-log and the new diagnostics tests. Run governance/modularity
checks for the new module. Fixtures use fake Electron/WebSocket/auth and temporary
directories only; no real accounts, data or Bilibili services.

Results: 100 distinct focused tests passed across the listed targets plus
desktop-auth-diagnostics, bilibili-diagnostics, desktop-logger,
cloud-sync-account-isolation, server-bilibili-client-avatar,
bilibili-user-info-pollers, bilibili-superchat-log, packet-decoder, queue-service
and queue-random-request. Governance links, frontend import checks and backend
module-boundary checks passed. The modularity gate reports one pre-existing,
unrelated working-tree issue: `public/pages/admin/toolbox/danmaku.html` has 632
lines against its reviewed limit of 622. This task does not edit that file or
raise its limit. An initially added comment-only parser catch was replaced by an
explicit invalid-auth result; the boundary check and WebSocket tests then passed.

No installer or release was built. The change takes effect after it is included
in an installed build. Existing 10 MiB log file caps and absence of rotation are
documented limitations; no claim is made that this instrumentation fixed the
already-recovered remote incident.

## Failure handling and done when

Diagnostics must not alter operation results or dump arbitrary upstream objects.
Inspect and reverse only task-owned hunks if verification fails; preserve all
existing staged/unstaged work. Complete once login-to-request events persist with
safe fields, filter/auth failure cases are covered, checks pass and instructions
explain that the affected user needs a build containing these changes and must
send both log files after reproducing.
