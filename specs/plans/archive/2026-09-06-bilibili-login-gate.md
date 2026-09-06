# Bilibili Login Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cloud capture starts only after the current LIRA account has saved Bilibili credentials; accounts never inherit each other's pending login uploads.

**Architecture:** Preserve authenticated Device/Streamer routes, encrypted tenant SQLite, and the existing revision-driven monitor replacement. Gate monitor creation on saved credentials, require a logged-in token request, and bind desktop sync generations to remote origin plus authenticated account name. No new IPC fields or dependencies.

**Tech Stack:** CommonJS Node.js, Electron main-process cookie storage, ws, SQLite, existing node:test fixtures.

## Global Constraints

- Preserve previous server authUid changes and unrelated edits in both repositories.
- Keep credentials inside Electron main and the matching cloud tenant. No Cookie/token logging or renderer transfer.
- Do not change local song data, licensing wire fields, or local Bilibili listener behavior.
- New cloud accounts must not be automatically seeded from unowned legacy Bilibili Cookies. Existing cloud credentials restore normally; explicit authorized login still uploads and retries.
- Same-account temporary authorization loss keeps pending writes; account change aborts old work, clears its pending writes and revision baselines, then reads the new account's cloud state.
- No commits, client packaging, or releases. Server deployment follows the current authorized repair workflow, with exact-file backups and hash checks.
- Existing execution sub-skills are unavailable; execute with the available tools. One bounded UI-copy subtask uses the repository's Luna workflow.

## Ownership And Current Behavior

- `D:/Work/lira-server/src/modules/bilibili/monitor-manager.js` currently starts monitors without credentials; `api.js` retains guest token requests.
- `D:/Work/Live/src/electron/cloud-sync-controller.js` retains revisions/dirty work without an account key and seeds an empty Bilibili cloud scope from local cookies.
- `public/pages/admin/song/settings.html` and `public/js/admin/settings-auth.js` describe login as optional and logout as anonymous fallback.
- Server ADR-0006 eligibility/credential seeding is narrowed by new ADR-0026; current requirement/protocol and client design updates are normative, this plan is not.

## Milestones

### 1. Require Saved Tenant Credentials

- [x] Add a two-tenant monitor fixture proving no credential means no monitor/socket/detector, login starts only its tenant, logout stops only its tenant, and restart restores only credentialed tenants.
- [x] Replace guest-token tests with rejection before upstream requests; keep public WBI-key lookup independent of account credentials.
- [x] Add a storage `hasBilibiliCredentials(db)` query on the already-resolved tenant DB and use it for creation eligibility and `waiting-login` Admin list status. The whitelisted read model still has null state without a runtime monitor.

```js
if (!creds?.cookie) throw new Error("BILIBILI_CREDENTIALS_NOT_CONFIGURED");
// After the existing active/enabled/room guards:
if (!row.hasBilibiliCredentials) return;
```

- [x] Update requirements, acceptance, Bilibili upstream, management status documentation/OpenAPI, operations, traceability and ADR; preserve old accepted ADR content.
- [x] Verify `node --test test/monitor-login-gate.test.js test/bilibili-api.test.js test/bilibili-qr-login.test.js test/room-monitor-errors.test.js test/admin-live-state.test.js` in the server repository. Initial red: 3 failures; focused green: 53 passed.

### 2. Isolate Desktop Sync Ownership And Explain It

- [x] Add account-switch tests: A's failed upload never retries under B, A's late cloud response cannot replace B's cookies, switching back reads A even with a lower revision, and two controllers do not share state.
- [x] Derive the sync key from authenticated `getSnapshot().streamer.accountName` and `getRemoteBaseUrl()`; include it in the existing asynchronous generation check.
- [x] Empty uninitialized Bilibili scope clears only the local unowned snapshot, never uploads it automatically. An explicit authorized login remains dirty/retryable; cancelled login does not mark credentials dirty.
- [x] Update login tooltip/toasts/logout confirmation without claiming local login means cloud sync succeeded.
- [x] Update `specs/cloud-authoritative-streamer-sync_design.md` and focused tests.
- [x] Verify `node --test test/cloud-sync-controller.test.js test/cloud-sync-account-isolation.test.js test/settings-auth-profile.test.js test/bilibili-startup-wiring.test.js` in the client repository. Initial red: 5 failures; focused green: 28 passed before the additional wiring assertion.

### 3. Verify And Hand Off

- [x] Run affected server/client security, lifecycle and documentation checks; server 143 passed, final client 104 passed, client verify:quick passed (573 JS syntax checks plus documentation/architecture). Focused review caught and fixed loss of newly completed same-account login/logout during temporary authorization interruption; both regressions are covered. Scoped diffs and whitespace checks passed.
- [x] Back up and deploy only changed server files after baseline hash verification. All 21 deployed hashes and JS syntax checks passed; backup is `/root/lira-login-gate-20260906-U8Qs1d/before.tar.gz`. .env, databases, credentials and package locks were untouched.
- [x] Restarted the existing single PM2 process at 2026-09-06 15:46 CST. Both logged-in production monitors authenticated, health showed total=2/wsConnected=2/reconnects=0, and the public overlay returned running plus a real danmaku event. No live user logout or synthetic login was used for testing.
- [x] Client changes are source-only and need an updated client build. Cloud logout cannot take effect before its request reaches the server; no historical event replay guarantee. Existing cloud credentials and each tenant's history remain intact.

## Rollback And Done When

Restore only the backed-up deployment files and restart the existing PM2 process if production verification fails. Do not revert unrelated work or delete tenant data. Completion requires passing focused tests, matching specifications, a verified server rollout, and a precise client-source handoff.
