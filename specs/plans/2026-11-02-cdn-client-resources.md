# CDN Client Resources Implementation Plan

**Status:** Awaiting Verification

**Goal:** Move the 56 complete font binaries and four images larger than 10 MiB out of the installer, retaining the two tiny title subsets. Check the CDN manifest once per authorized desktop run, download only missing/changed files, and show progress only when work is needed.

**Architecture:** A device-level resource library owns the CDN manifest, verified cache, and download lifecycle. The existing font library remains the font projection and compatibility adapter; existing font progress IPC carries the aggregate resource progress. Local HTTP serves cached files at their original public paths. Gift initialization continues independently.

**Tech Stack:** Node.js built-ins, CommonJS services, existing Electron preload/IPC, named browser ESM imports, native CSS, existing node:test and Electron fixtures.

## Constraints and current behavior

- Preserve unrelated working-tree edits, authorization, Electron security, existing font IDs, CSS families, and public resource paths. No commits, deployment, runtime dependencies, or new process.
- Current font initialization prefers packaged WOFF2 and repairs from fixed external font sources. Font and gift progress already have subscriptions, toast ownership, and a download panel.
- Public fonts total 56.64 MiB. The four managed images are earth-day-8k.png and guard-nautical/{admiral,captain,governor}.webp. Videos and user-imported packages are outside this change.
- Production resources come only from https://assets.lirahub.cn/resources/manifest.json and approved named font packages/images on that origin. Manifest data never introduces executable assets or arbitrary filesystem/network paths.
- First installation requires network access for these resources. Existing validated cache remains usable during checks, updates, cancellation, or network failure.

## Owners and contracts

| Responsibility | Owner / consumers | Verification |
| --- | --- | --- |
| Export selection, manifest, upload directory | scripts/export-cdn-resources.js; src/resources/catalog.json | Export inventory, object hashes, repeatability |
| Validated manifest and atomic local cache | src/resources/resource-library.js and resource-download.js | First run, no-op next run, changed object, corruption, interrupted writes, strict origin/path/size checks |
| Original local URLs and font projection | src/fonts/font-library.js; src/server/font-assets.js; src/server/runtime-transport.js; src/server.js | HTTP font/image GET/HEAD, original URLs, old font cache compatibility |
| Startup and aggregate progress | existing desktop-readiness-controller, font-library IPC, resource-downloads and font-library-toast | One check per run, gift parallelism, quiet checks, active byte progress, retry and disposal |
| Installer and guidance | package.json; packaging-scope; bundled-fonts Electron fixture; public/fonts/README.md; owning references and usage guide | ASAR excludes every managed binary; real Electron renders from external cache |

## Milestones

- [x] Export upload-ready resources and a deterministic baseline catalog. Use original public paths as allowlisted logical keys, named/versioned remote files, and SHA-256 cache filenames. Upload only font packages, images and the manifest; retain small font licenses in the application.
- [x] Implement a single resource owner: bounded HTTPS manifest read, allowlisted file metadata, once-per-run check with explicit retry, two concurrent downloads, byte progress, verified same-directory temporary writes, atomic index publication, cancellation, and preservation of old files. Development source files may satisfy matching resources; production never depends on them.
- [x] Wire resource ownership into the existing font/runtime interfaces and local asset serving. Keep old font caches readable. Wait for an already-running resource download when a cold image request needs the file; renderer requests do not start extra CDN checks.
- [x] Adapt existing toast/panel/first-use messaging to fonts and images, with shared subscriptions and silent checking/no-op results. Preserve first-use gift initialization and authorized startup ordering.
- [x] Exclude all font binaries and the four images from packaging; update the ASAR/Electron verification to exercise first download and later offline rendering.
- [x] Update font, storage, local HTTP/IPC, build, and first-use guidance. Validate the upload directory and ZIP; report that the user must upload objects before the manifest.

## Verification

### CDN installer updates and live acceptance follow-up (2026-11-02)

The user requests that built-in client updates use the same CDN installer URL and that every uploaded file be checked. Preserve updater IPC/state fields, SHA-512 verification, the Electron HTTP executor, installation-local cache and shutdown/install behavior. The resource manifest and installer return HTTP 200 through the host's configured proxy; `downloads/latest.yml` returns CDN `NoSuchKey` (404). The Node CLI must use its environment proxy for representative public-network checks; an unproxied request reached a different 404 response.

- [x] Configure the existing updater's generic feed at `https://assets.lirahub.cn/downloads/`, with the manually uploaded CDN copy named `lira-setup.exe`. Normal build and GitHub artifacts retain their versioned names. Put the generic provider first in builder configuration; retain GitHub publication and select its owner/repository explicitly in `scripts/publish-release.js`. Do not publish, commit, install or rebuild an executable during this task.
- [x] Update affected updater and renderer messages. A missing CDN channel manifest is an error, not evidence that the installed version is current. Keep existing checksum enforcement and update/install state transitions; verify them through `update-manager`, desktop controller/frontend and publisher/packaging tests.
- [x] Use the real resource library in isolated repository `tmp/` data to download all 17 remote packages, validate archive members and all 60 logical resources, then verify a warm launch performs zero object downloads. Fully download the public installer once, compare size/SHA-512 with the existing local installer, and read its version without execution. Prepare the missing `latest.yml` from those verified bytes under `tmp/cdn-installer/` for the user to upload.
- [x] Synchronize the runtime/build/release/CDN references and affected in-app guidance; run focused tests, syntax/docs/architecture gates and final diff/status review. Mark resource live acceptance complete only after download/hash checks pass. Installer feed live acceptance remains pending until the matching `latest.yml` is uploaded and can be read publicly; source changes take effect in a subsequently built client.

Live results: all 17 CDN font/image packages downloaded through the real resource library, archive validation and per-file SHA-256 passed for all 60 logical resources; a subsequent warm run made one manifest request and zero object downloads. The 255,567,366-byte public installer downloaded completely and matched `release/lira-setup-5.7.4.exe` by SHA-512; Windows PE metadata confirms version 5.7.4. A separate isolated Electron session using `net.fetch` returned 200 for the manifest and 206 for an installer range, with the expected MZ header; latest.yml still returned 404. The generated `tmp/cdn-installer/latest.yml` parses with electron-updater and matches the downloaded bytes. Evidence is saved under `tmp/cdn-live-Y42pzR/results.json` and `tmp/cdn-electron-v2S34N/results.json`; no application or installer was launched against user data.

Verification: 51 focused updater/controller/frontend/publisher/packaging/installer-integrity cases passed, including actual GenericProvider manifest/path resolution and preservation of the Electron HTTP executor/cache. Syntax passed for 1,673 files, docs 10/10 and architecture 28/28. Build/release/CDN/runtime references and affected in-app guidance were synchronized; the interactive tour and updater IPC fields are unchanged because their controls and operating steps did not change. No EXE was rebuilt or published. Remaining acceptance: upload the prepared latest.yml (and disable caching for both fixed downloads paths), then verify the live feed; newly built clients adopt the feed, while existing uploaded 5.7.4 remains its prior binary.

Uploaded-channel acceptance (2026-11-02): after the user uploaded latest.yml, both Node and an isolated Electron session returned HTTP 200 for the public channel. The actual configured GenericProvider using ElectronHttpExecutor parsed version 5.7.4 and resolved the fixed lira-setup.exe URL; its declared size (255,567,366 bytes) and SHA-512 match the previously fully downloaded installer. Installer HEAD returned 200 and range GET returned 206 with the correct MZ header. Evidence: tmp/cdn-installer/live-feed-verification.json and tmp/cdn-electron-bb4evu/results.json. No installation or automatic full download was started. Live resource and installer-channel availability are now accepted; rebuilding/installing a client with the new source configuration remains outstanding.

Temporary-file cleanup was rejected by the tool's automatic policy (`blocked by policy`). The isolated Electron process was closed; downloaded installer/resource data and verification results remain in the repository's ignored `tmp/` directories. No alternate deletion mechanism was attempted.

### Shared font names and bundled title subsets follow-up (2026-11-02)

The user asks to register the remaining complete fonts under their real names for reuse by all components. Tiny, restricted title subsets should stay in the installer and outside the shared font menu. The two Noto Serif SC title subsets total 6,524 bytes; Nunito and the multilingual fonts are complete fonts, not title subsets.

- [x] Extend `src/fonts/catalog.json` and `public/js/shared/font-catalog.js` with Nunito, Gowun Dodum, Noto Sans (its existing language branches) and Noto Serif Tibetan. Preserve all existing IDs, source paths, Unicode ranges and lyric fallback priority. Let the shared stylesheet own their declarations, with the existing lyric/Spooky family names as compatibility aliases; use script-specific sample text when testing font readiness.
- [x] Keep `clock-moon-serif-400.woff2` and `guard-thanks-serif-400.woff2` in the installer, exclude them from the CDN export, and regenerate the approved resource catalog and upload staging. Complete fonts are packaged by their registered name; no production package remains named after lyrics or component usage.
- [x] Extend the existing export/packaging tests and ASAR/Electron fixture to verify title subsets are bundled, all shared fonts are selectable and actually render their supported text, and the next offline launch downloads nothing. Run the existing multilingual lyric playback test to preserve regular/bold shaping and on-demand local reads.
- [x] Synchronize font/upload guidance, the affected frontend/build/cache references and this plan. Run focused checks, `npm run verify:docs`, `git diff --check`, and review only this follow-up's changes. Existing live-CDN acceptance remains pending until upload.

Follow-up results: 44 focused cases passed (41 resource/font/HTTP/export/packaging cases, two browser rendering cases and the ASAR/Electron case). All 13 shared choices rendered actual custom fonts using appropriate script samples; the archive contains both tiny title subsets; an offline reopen performed zero resource downloads. Existing multilingual lyric coverage passed at regular and bold weights. Syntax passed for 1,673 files, docs 10/10 and architecture 28/28. The regenerated upload contains 13 named font ZIPs, four images and one manifest (18 files); the two old usage-named groups are superseded. Technical references, font source guidance and the two affected in-app guides were synchronized; the interactive tour has no affected font inventory or operation and is unchanged. Live CDN upload and a rebuilt EXE remain outside the completed local verification.

### Named package follow-up (2026-11-02)

The user requests fewer upload files and meaningful filenames. Keep every existing glyph and local URL, and change the download unit: nine shared font families each become one ZIP, lyric fallback fonts become one ZIP, remaining style-specific fonts become one ZIP, and each large image remains independent. The upload has 15 resource files plus one manifest. Use the font/image label and a 12-character content digest in filenames under `resources/fonts/` and `resources/images/`, preserving long CDN caching without stale replacements.

- [x] Add a shared package recipe in `src/resources/resource-packages.js`, used by export and manifest validation. Manifest v2 lists file metadata and approved package IDs/sizes/hashes; remote metadata cannot supply arbitrary destinations. Preserve v1 reads for the prior upload format.
- [x] Export deterministic font ZIPs and named images, regenerate the baseline catalog and the upload ZIP, and replace only the owned generated upload staging directory. Do not copy license text into the CDN material; original application notices remain untouched.
- [x] Download only packages containing missing or changed members. Verify each package, validate exact ZIP member paths/sizes/hashes with the existing yauzl dependency, restore files to their original hashed cache, and remove the temporary archive. Preserve the cache index format, old usable versions, cancellation and quiet unchanged checks. Progress counts network packages and received bytes. Publish each complete package's changed members in one index write; partial extracted files cannot replace a usable font family during a failed retry.
- [x] Extend export and resource lifecycle tests for grouping, readable names, unchanged launches, single-package updates, legacy manifest reads, invalid archive members and cancellation. Update the existing ASAR/Electron fixture to download actual grouped packages and reopen offline.
- [x] Synchronize the guide, storage/build/startup/font references and owner route; run focused tests, the real Electron fixture, syntax/docs/architecture checks, and final diff/status review. User upload and live CDN verification remain external acceptance.

Named-package results: 83 focused cases passed, including grouped downloads, one-package updates, invalid ZIP members, repeated failed retries preserving the old family, v1 compatibility and cancellation. The real ASAR/Electron fixture passed using the exported ZIPs/images, rendered all nine shared font families and the 8K map, and reopened offline with no object downloads or toast. Syntax passed for 1,673 files, docs 10/10 and architecture 28/28. The two auxiliary font packs are named 「歌词多语言备用字体」 and 「直播组件专用字体」 to distinguish their existing purposes from the nine selectable fonts. Current HTTP/page/IPC shapes and glyph coverage remain unchanged; references and affected upload/in-app guidance were synchronized. No new EXE or live CDN deployment was produced.

Use focused node:test files for resource lifecycle, font HTTP, toast/panel, readiness, export, and packaging. Run the modified real Electron font fixture against an isolated custom installation directory and a deterministic injected CDN fetch, then reopen from the persistent cache without network. Run npm run check, npm run verify:docs, and the relevant architecture/packaging checks because ownership, IPC state fields, and installer contents change. Inspect the final diff, git diff --check, and git status --short. Do not run unrelated full suites by default.

### Local results (2026-11-02)

- `npm run export:resources`: 58 font files and four images; 144,919,201 source bytes, upload directory and ZIP under `tmp/cdn-resources/`. Catalog and source inventory match; generated artifacts are ignored.
- Focused node:test coverage for resource lifecycle, legacy fonts, readiness, Electron modules, export, packaging, IPC, HTTP, toast/panel, and server lifecycle: 80/80 passed.
- `node --test test/desktop/bundled-fonts-electron.test.js`: passed with a custom Chinese/spaced installation path, no packaged font binaries, actual preload/IPC, nine distinct rendered font families, the 8192px map, and a later offline run with one check, zero downloads and no toast. The CDN fetch is deterministic and injected; this does not establish live CDN availability.
- `npm run check`: 1,671 JavaScript files passed. `npm run verify:docs`: 10/10 passed. `npm run verify:architecture`: 28/28 passed.
- Technical references and first-use/playback guidance were synchronized with the cache, progress, startup and packaging behavior. No client EXE was rebuilt or published.
- Earlier follow-up removed license text copies from the CDN export, reducing that format to 62 binary assets and one manifest; source/application licenses remain in their existing location. The later named-package change above supersedes that upload layout.

### Remaining external acceptance

Resource first-download and installer-channel acceptance passed on 2026-11-02 as recorded above; the real Electron updater resolved matching 5.7.4 installer metadata. The current public manifest also matches all 60 logical files and 17 packages in the approved source catalog. Preserve the manifest/fixed-download no-cache rules and publish binaries before their matching manifest. The v5.7.5 build and GitHub publication follow RELEASE_GUIDE.md; the maintainer handles CDN synchronization manually after release. Keep Awaiting Verification for installation and first-run/offline acceptance of the newly built client, since an already installed binary does not acquire source changes automatically.

### Release naming correction (2026-11-02)

The user requires the release workflow and artifact names to match v5.7.4 exactly. Restore both package.json artifactName fields to `lira-setup-${version}.${ext}` and restore RELEASE_GUIDE.md to its v5.7.4 contents. Keep CDN fonts/resources and the configured runtime update feed unchanged. CDN renaming is a maintainer operation on upload copies, including the matching manifest file paths; it does not change normal build output or GitHub names.

Owners are package.json, the existing packaging-scope regression, the build reference and the separate CDN guide. Verify the guide against the v5.7.4 Git object, run the unified verification before committing the correction, and preserve the already published v5.7.5 tag. Correct that release's asset names and manifest references using its already verified installer/blockmap bytes, checking the remote digests before and after the metadata correction. Do not repoint the tag, change installer content, bump an unrequested version or access the CDN console. Later releases use the original verify/commit/push/release:win flow.

## Failure handling and completion

Write downloads to owned temporary files, verify bytes and SHA-256 before publishing, and retain the previous asset/index until replacement succeeds. Shutdown aborts owned requests and removes incomplete temporary files. A failed check with complete local resources is quiet; missing resources or failed downloads remain retryable. Existing source changes are preserved; rollback can remove only this task's scoped edits and generated tmp material.

Done requires upload-ready files, correct startup/update/no-op behavior, usable original local URLs, meaningful progress, excluded installer binaries, synchronized contracts/guidance, focused verification, and reviewed diff. The maintainer uploads future CDN changes manually; installed-client live acceptance remains outstanding. No upload credentials are requested or embedded.
