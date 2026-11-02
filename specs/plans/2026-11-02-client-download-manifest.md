# Client Download Manifest Implementation Plan

**Status:** Awaiting Verification

**Goal:** Upload the original versioned Windows installer and its unmodified
`latest.yml` once; desktop updates and the public homepage select that installer.

**Architecture:** Keep electron-updater and its existing generic CDN feed. Add a
public server redirect which resolves the top-level installer `path` from the same
manifest. The homepage and desktop manual-download help use the stable redirect.

**Tech Stack:** Existing CommonJS Node/Express server, native HTML, electron-updater.

## Scope and current evidence

The installed 5.7.6 app reads the correct CDN feed. On 2026-11-02 the public
manifest reports 5.7.7 but references `lira-setup-5.7.7.exe` (404), while the
uploaded `lira-setup.exe` returns 200 with the expected 172391857-byte size. The
manifest response also lacks the installer's `Cache-Control: no-store` header.
The old `not-available` events do not record the received remote version, so they
alone cannot prove which manifest that client received at that time.

No bucket listing, updater rewrite, dependency, installation, cloud upload,
commit, or server deployment is included. Preserve all pre-existing server edits.

## Ownership and compatibility

- Live: `package.json` owns the versioned artifact name and feed;
  `src/electron/update-manager.js` retains its update/download/integrity behavior.
- Server: `src/modules/client-download.js` will resolve the trusted configured CDN
  manifest; `src/app.js` owns HTTP wiring; `public/site/index.html` owns the link.
- Server configuration supplies `CLIENT_DOWNLOAD_BASE_URL`, defaulting to the
  existing CDN downloads directory. Request parameters never select the origin.
- Preserve native links, keyboard activation, locale-independent destinations,
  no-script use, existing auth/Host rules, hashes, settings, and persistence.
- Same-version installer bytes are immutable; publish the installer before the
  manifest. Keep prior files until the replacement is publicly verified.

## Milestones

- [x] Add server behavior coverage in `test/client-download.test.js`: configured
  manifest path becomes a 302/no-store redirect; a changed manifest selects the
  next version; failed or unsafe manifests return an uncached 503 and recover.
  Use injected fetch responses and isolated HTTP listeners, never real user data.
- [x] Implement `getClientDownloadUrl(baseUrl, { fetchImpl = fetch } = {})` with
  HTTPS base validation, one bounded 5-second/16-KiB manifest fetch, no retries,
  no prefetch or installer proxy, and a same-directory installer filename only.
  Wire `GET /download/client` and update the homepage and desktop manual link.
- [x] Extend the existing real GenericProvider test with a versioned installer;
  adapt existing homepage download/no-script cases without adding layout checks.
- [x] Synchronize server homepage requirements/acceptance, download operations,
  protocol/cache reference and navigation; update Live CDN/build/update guidance.
- [x] Run focused server Node tests, the two affected full homepage browser files,
  both documentation gates and the affected Live updater test. Inspect each
  touched diff, `git diff --check`, and status in both repositories.

## Failure handling and done conditions

An unavailable, oversized or invalid manifest yields 503 without an external
redirect. The next click retries normally. The old fixed CDN EXE remains available
for existing installed help links; do not delete it as part of this task.
Reverse only task-owned hunks if needed. Source completion requires focused checks
and synchronized current references. Public end-to-end acceptance remains pending
the maintainer's versioned EXE upload, manifest cache refresh and server deployment.

## Verification evidence

Initial focused checks: 13 server Node cases and six desktop updater cases passed;
Live documentation gate passed 10/10. Server documentation ran 58/59, revealing
the missing deployment-runtime configuration table entry; that entry is now added.
The full homepage browser pair passed 27/28: the new mock redirect bypassed the
second Playwright interception and reached the public missing EXE (404), causing
the download wait to time out. The browser fixture now intercepts the stable
download entry directly; real redirect resolution remains covered by the server
HTTP integration case. Rerun the complete affected homepage file; reuse the
unchanged preferences file's passing result.

The repository verification wrapper's preflight is blocked by a pre-existing
dependency mismatch: installed body-parser 2.3.0 versus locked 2.4.0. Focused Node,
browser and documentation files run directly through the existing supported Node
wrapper. No dependencies were reinstalled or user-running services restarted.

Final local results: server focused tests 13/13; desktop updater 6/6; server docs
59/59; Live docs 10/10; homepage file rerun 12/12 with the corrected fixture,
plus all 16 unchanged preferences cases from the preceding full-pair run. Syntax
checks passed for the new module, app/config and test. The existing app composition
root remains cohesive: it owns the small public route while manifest I/O and
selection live in the new module. Tests, current technical references, CDN
operations and in-app download guidance are synchronized; the interactive tour
and updater controls/IPC are unchanged, so they need no changes.

Public checks at 2026-11-02 22:02 Asia/Shanghai: the plain manifest URL returned a
cached 5.7.5 body with `X-Cache-Lookup: Cache Hit`, while a noCache query returned
5.7.7, also cached. Both lacked `Cache-Control: no-store`. The versioned 5.7.7 EXE
still returned 404. This establishes inconsistent cached manifest delivery and
the missing named installer; the historical app logs alone cannot identify its
exact received remote version. Remaining external acceptance: upload the original
versioned EXE, disable and refresh manifest caching, deploy the server route, and
verify live 302/download and the installed client's update. No cloud objects,
installed apps, branches, commits or deployments were changed.
