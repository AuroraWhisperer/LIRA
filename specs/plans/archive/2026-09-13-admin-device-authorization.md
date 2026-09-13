# Admin Device Authorization and Reinstall Recovery Implementation Plan

**Goal:** Keep unlimited independently authorized devices and concurrent use, restrict new device codes to Admin, and recover a reinstalled computer into its original device/license/source-code record after a fresh Admin-issued code and account credentials succeed.

**Architecture:** The LIRA Server device activation transaction owns identity recovery and code consumption. Fingerprints identify an existing record only after authorization; they never replace credentials or the fresh one-time code. The Electron client continues creating and protecting its own private key.

**Tech Stack:** Existing CommonJS Node.js server, SQLite transactions, Electron, and native HTML/CSS/JavaScript. No new dependencies.

## Current Behavior and Ownership

- Server `src/routes/device.js` and `src/modules/device/pairing.js` let DeviceBearer create codes; the existing Admin `POST /api/admin/activation-codes` already issues onboarding or account-scoped codes, default 60 minutes.
- Server `src/modules/device/activation.js` always inserts Device/License, even when the same computer is reinstalled. `fingerprint.js` owns stored machine hashes; `session.js`/`device-auth.js` enforce device key, epoch and session validity.
- Server Admin authorization rows reference code usage and the device; retaining `deviceId`, `licenseId` and `licenses.source_activation_code_id` preserves the original authorization and its revoke action.
- Client `public/pages/license.html` and `public/js/license.js` share the registration/new-device form. Existing user changes in `public/css/license.css` must be preserved.
- Normative owners: Server `docs/requirements/{system-rules,acceptance-criteria,traceability}.md`, `docs/protocol/{pairing,device-authentication-v2,session-lifecycle,client-server-api,error-codes}.md`, and Device/Management OpenAPI.

## Boundaries and Decisions

- Keep Admin code issuance, 60-minute default/configured TTL, unlimited devices, cross-device concurrent sessions, account uniqueness, tenant scoping, v2 canonical signatures, key protection, and existing user changes.
- Retire DeviceBearer code creation with explicit HTTP 403; remove its implementation. Preserve existing history/revoke compatibility, but no legacy device-issued unused code may authorize another installation.
- A same-computer match requires the same authenticated tenant, fingerprint version, at least two matching valid hashes, and no conflicting comparable hash. Never match by name or IP. Ambiguous historical matches require Admin attention rather than arbitrary record merging.
- Recover only an active device with an active original license. Reuse its IDs and original source code; rotate the submitted public key, increment device epoch, invalidate old sessions/challenges, and consume the fresh code in one transaction. Retain audit history and avoid deleting historical device data.
- Original registration codes remain used. The user was asked to confirm that “use the original code” means preserve its authorization record; reused-code authentication is not assumed.
- No deployments, commits, branches, production data edits, speculative device limits, or account-wide session revocation.

## Milestones

- [x] Restrict issuance: real HTTP test for an authorized device being refused without creating a code; Admin issuance still succeeds and follows configured TTL. Remove the device issuance helper/export and reject consumption of legacy device-issued codes.
- [x] Restore same-computer identities: regression tests for original IDs/source, new-key verification, invalid old sessions/challenges, wrong credentials/expired or reused codes, different computers/tenants, revoked/ambiguous identities, rollback and concurrent recovery. Implement within the existing activation transaction.
- [x] Clarify client registration/login entry and recovery feedback while preserving current styling and Electron security. Update existing UI tests only for changed behavior.
- [x] Update requirement, acceptance, protocol, error, traceability and architecture decision documents to explicitly replace device self-issuance and document recovery/migration.
- [x] Review scoped diffs and run proportional authorization/contract gates; record results below and archive this plan when complete.

## Verification

Server commands from `D:/Work/lira-server`:

```powershell
node --test test/device-response-contract.test.js test/device-reinstall.test.js test/account-activation.test.js test/device-auth-flow.test.js
npm run docs:check
npm test
git diff --check
git status --short
```

Client commands from `D:/Work/Live`:

```powershell
node --test test/license-ui.test.js test/license-password-ui.test.js test/license-manager.test.js test/license-protocol.test.js
git diff --check
git status --short
```

Tests use isolated temporary databases and synthetic credentials, never user data. Full Server verification is justified by changed authorization and identity/session persistence semantics. Client verification remains focused on changed renderer behavior and the established protocol.

## Failure Handling and Done When

Authorization failures leave codes unused and existing identity/keys/sessions unchanged. Recovery writes roll back together; multiple ambiguous existing records are never deleted or silently chosen. Review only task-owned diffs to reverse changes if necessary; never use destructive reset or overwrite unrelated changes.

Done when only Admin can issue usable new codes; one computer reinstall retains its original authorization record, with old credentials/sessions invalidated; distinct devices remain independent and concurrent; the UI explains registration/login; focused and justified broad checks pass with limitations recorded; final diff and status are reviewed.

## Progress and Evidence

- Initial investigation confirmed default TTL is already 60 minutes and found the active device self-issuance endpoint. Server has only pre-existing untracked output assets; Client has unrelated CSS, build/test documentation, and JS-check changes, which must remain untouched.
- Implemented recovery with a fresh Admin login code while retaining the original source authorization; the original registration code remains consumed. No production records or deployment configuration were changed.
- Admin history now labels recovery verifications and groups them under the original authorization in the Streamer detail view, preserving complete global code history and existing revoke actions. Added behavior coverage in `test/admin-authorization-history.test.js`.
- Server focused authorization tests: 153 passed. Server complete `node --test`: 1,155 passed, 0 failed. `npm run docs:check`: 33 passed. Full-suite log: `%TEMP%/lira-admin-device-authorization-tests.log`.
- Client focused page/password/manager/protocol/catalog tests: 127 passed. Scope review confirmed existing CSS artwork and unrelated user changes are preserved.
- Limitations: source changes are local, not deployed. No real user's installation/data was deleted or used for testing. Ambiguous historical machine records require Admin attention; only uniquely identified original records are recovered automatically.
