# Account OBS capability URL plan

## Goal

Both desktop OBS address fields display/copy/open the same server-issued `/overlay/<16-character token>` on initial authorized profile load.

## Non-goals

No client-generated key, new synchronization scope, credential storage or preview redesign.

## Current behavior and ownership

`server-overlay-url.js` derives `/overlay` from the profile song origin. `license-ipc.js` rejects other paths. Two UI consumers observe this shared module; the existing Device overlay-settings bridge owns the authenticated request.

## Contract and compatibility

Server ADR-0056 and public-overlay v0.8 require a persisted per-account capability. Explicit user authorization permits this narrow read-only OBS URL to reach the renderer for display/copy, not Device credentials. Replace bare paths; no fallback. Clear on account changes and discard late replies. Local preview stays independent.

## Steps and verification

- [x] Change IPC path validation and shared URL resolver to accept only the token path on the authenticated profile origin.
- [x] Fetch via existing `getOverlaySettings()` after profile/state arrival and fan out the complete address; invalidate outstanding requests on account change/pagehide.
- [x] Test correct paths, invalid responses, two observers, initial load, account switches and late replies; run IPC and existing draft/copy/preview tests.
- [x] Update preload contract and frontend overlay specification; inspect diff and run relevant architecture checks.

## Done when

Both consumers receive one stable server URL; no bare URL is constructed, no secret generated client-side, and focused tests pass. Deploy server and client together; existing OBS sources need the newly copied URL.


## Verification outcome

18 focused IPC, shared URL observer, copy/open/preview and draft tests passed. `verify:quick` passed documentation and syntax; architecture checks passed 21/22 with the unrelated pre-existing `public/pages/admin/toolbox/danmaku.html` at 619 lines requiring a file-specific review. No unrelated file-size change was made. Diff whitespace check passed. Implementation complete; server/client deployment and replacing existing OBS URLs remain release actions outside this task.
