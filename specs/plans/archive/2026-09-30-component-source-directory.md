# Component Source Directory And Standalone Output

**Status:** Completed on 2026-09-30. Native OBS/Livehime verification was unavailable; the isolated Electron and browser-source checks below establish the implemented contract.

## Goal And Boundaries

Expose the existing combined canvas source in the desktop Browser Sources directory, alongside a launcher for the unified browser editor. Keep direct, independently usable component sources for clock, queue, overtime and danmaku. Document the two workflows and verify the output without an editor session. No scene auto-publication, migration, new process, dependency, remote deployment or streaming-app configuration changes.

The directory currently lists standalone sources but has no combined scene source. Its danmaku link is remote; the legacy local `/danmaku` reads old local settings rather than the saved component appearance. A new `/danmaku?source=component` mode will reuse the already normalized, owner-scoped cloud display buffer used by scene output, without changing legacy links or creating a scene. This concrete gap requires a scoped read endpoint; adding only a URL would give the wrong saved style.

## Ownership And Compatibility

`display.js` and `song/overlay-addresses.html` own the directory. `component-preview-registry.js` and the canvas adapter retain selection, save and publication ownership. Source copying must use their bound scene and the existing source operation; credentials remain absent from documents and appear only after explicit retrieval. Clear displayed source credentials when account/source context changes.

`scene-runtime.js` already owns the cloud display buffer. Expose a read port `{config,data}` through existing runtime/API composition, and a scoped `GET /api/danmaku/display?epoch=…&cursor=…` route. Only the matching danmaku overlay capability or authorized management caller may read it. The port returns the existing sanitized config and display snapshot; it does not accept client identity, expose raw settings, create a subscription, persist data or execute business events. Keep loopback, license, Host/Origin, opaque sandbox and other capability restrictions intact.

## Work And Verification

- [x] Add the combined-source card, one unified-preview launcher and local danmaku source entry; reuse one URL formatter in the browser editor and desktop directory. Verify first-use guidance, stable copied source, no implicit publication, and account-change clearing.
- [x] Add the scoped danmaku display read port and component-source polling renderer, using existing canvas/style/feed code. Verify current settings and live data, cursors, unavailable/owner-change behavior, scope denial and legacy compatibility.
- [x] Extend the real browser-source fixture to cover cold load, refresh, transparent canvas, viewport scaling and live updates after editor closure; include independent component sources without creating a unified scene. Use existing isolated Electron verification for the desktop entry where needed. No user-app or real-data writes.
- [x] Update the user guide, frontend/API references and component specifications with exact entry names, source shapes, persistence behavior, dimensions and same-machine requirements. Explain that `/component-preview` edits and `/scene` renders the live output.
- [x] Run affected browser, runtime, transport/auth and desktop tests plus syntax/architecture/docs gates justified by the new read contract; review the touched diff and status, clean owned processes, and archive with actual evidence. OBS/Livehime installation/runtime evidence must be stated accurately; Chromium checks alone must not be called tests inside those applications.

## Failure Handling And Completion

Copying an unpublished canvas explains Save and Apply rather than publishing automatically. Publication failure keeps the prior scene source. Standalone danmaku disconnects clear live messages and recover through the existing cursor/reset contract. Late account responses cannot display or copy old scene credentials. Preserve every pre-existing workspace change and roll back only task-owned edits if necessary. Completion requires both documented import paths and isolated functional output evidence, with any unavailable native streaming-app verification explicitly recorded.

## Completion Evidence

- The desktop source directory now exposes “统一直播画布” with copy and preview actions, keeps the standalone clock/queue/overtime entries, and adds “弹幕姬 · 本机组件” alongside the online source. An isolated Electron probe exercised the real admin page, main-process request authentication, explicit source copying, external preview navigation and source-change clearing. The synthetic clipboard does not modify the user's clipboard.
- Browser checks loaded all four standalone sources without creating a scene. The combined source rendered five layers, stayed transparent, fit a 1920 × 1080 canvas into a 1280 × 720 viewport, and continued receiving queue/danmaku updates after the editor and its synthetic management page were closed and the output refreshed. The local backend remained running, as required for a 127.0.0.1 source.
- The real runtime HTTP test exercised the new read route with management/danmaku scope, denied other scopes and write methods, and checked sanitized fields, cursor reset and account changes. The display renderer reuses the existing normalized buffer; no second upstream subscription is created.
- The following directly affected run passed **87/87**:

  ```powershell
  node --experimental-vm-modules --test --test-reporter=spec `
    test/admin/frontend-admin-toolbox.test.js `
    test/admin/frontend-admin-runtime.test.js `
    test/admin/frontend-usage-guide.test.js `
    test/admin/component-preview-browser.test.js `
    test/admin/component-preview-output.test.js `
    test/overlays/component-source.test.js `
    test/scenes/scene-runtime.test.js `
    test/scenes/scene-http.test.js `
    test/scenes/scene-renderer.test.js `
    test/scenes/scene-display.test.js `
    test/overlays/overlay-http-access.test.js `
    test/desktop/desktop-request-auth.test.js `
    test/desktop/desktop-request-auth-electron.test.js `
    test/transport/component-preview.test.js
  ```

- `npm run check`: **1137 JavaScript files passed**. `npm run verify:architecture`: **22/22 passed**. The `src/server.js` size record was reviewed from 750 to 751 lines solely for the new runtime read-port composition line; its rationale records the bounded change and coverage. `npm run verify:docs`: **9/9 passed**.
- After the final guide/help wording edits, `node --experimental-vm-modules --test --test-reporter=spec test/admin/frontend-admin-toolbox.test.js test/admin/frontend-usage-guide.test.js`: **20/20 passed**. The three new Playwright files were assigned to the browser group; `node scripts/run-tests.js browser --domain=overlays --domain=admin --list` and `node --check scripts/run-tests.js` passed.
- Final touched-diff, whitespace and status review excludes temporary/runtime material. Existing workspace changes were preserved; fixtures owned and closed their browsers, HTTP/WS listeners, Electron processes and temporary stores.
- OBS Studio and Bilibili Livehime were not found in the checked executable locations or uninstall registry. No in-application streaming-software test was performed. Chromium rendering and isolated Electron verification are the evidence above, not a claim of native OBS/Livehime acceptance. The guide uses the supported URL-browser-source contract and links the official OBS instructions.
