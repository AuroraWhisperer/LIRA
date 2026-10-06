# Canvas Browser Source Implementation Plan

**Status:** Completed

**Goal:** Compact the Add Component dialog and let users add external browser sources with a name, URL, and viewport resolution, retaining the canvas's move, resize, dimensions, layer and publication controls.

**Architecture:** Add one independent-only `browser` scene item to the existing scene document and renderer. Keep external page loading separate from the owned component message protocol. Reuse existing scene ownership, secret codec, publication and geometry; introduce no process, dependency, table or privileged browser access.

**Tech Stack:** Vanilla ESM, native CSS/dialog, Node.js scene service, existing SQLite store and Electron/browser fixtures.

## Boundaries and current behavior

- The current picker repeats the category heading, includes a subtitle and uses a roughly 90px header. It uses native dialog cancellation, category thumbnails and separate scrolling panes.
- `component-preview-canvas-view` owns adding/selecting layers; `scene-editor-stage` and `scene-editor-inspector` own geometry and instance controls.
- External sources do not currently exist. The component preview message handshake assumes an owned renderer. Third-party frames cannot be assumed to implement it.
- Browser viewport pixels and scene item display pixels are distinct: changing item geometry transforms the page without changing its viewport.
- OBS's official browser-source reference confirms URL and viewport width/height properties: https://obsproject.com/kb/browser-source . Default viewport is 800 × 600.
- Preserve existing unrelated work, especially the pre-existing overlay and HTTP utility changes. Do not branch, commit or publish the repository.
- No arbitrary HTML/local-file import, provider-specific parameters, FPS controls, login integration, custom CSS injection, security-policy bypass or OBS control.

## Ownership and compatibility

- UI: `public/js/admin/component-preview-picker.js`, `component-preview-canvas-view.js`, `scene-editor-stage.js`, browser source preview/panel module, and `public/css/component-preview-page.css`.
- Shared contract: `public/js/shared/scene-components.js`, `scene-browser-source.js`, `browser-source-frame.js`, `src/shared/scene-component-types.js`.
- Persistence/output: scene contract/service, existing component ports and `public/js/overlays/scene-renderer.js`.
- Template and local recovery: `public/js/admin/scene-template.js` and `component-preview-drafts.js`.
- Contracts: `specs/component-scenes.md` and the component source guide; do not overwrite unrelated edits to the overlay reference.
- Preserve version-1 existing items, shared defaults, geometry constraints, source capabilities, authorization and the opaque iframe sandbox. External URLs may carry provider capabilities only in the browser URL field; the general forbidden-credential checks remain intact.
- Browser URL persistence must use the existing scene secret codec. Exported templates remove URLs and require explicit rebinding. Persistent editor recovery must not retain plaintext URLs.

## Milestones

- [x] **Compact picker.** Keep title and close icon; header approximately 36px (2/5 of previous height), category top padding 8px. Remove duplicate section headings/count row. Scope transparent scroll tracks and arrow removal to picker panes. Verify native Escape closure and category switching without duplicate content.
- [x] **Browser source contract and persistence.** Exact config is `{ url, viewportWidth, viewportHeight }`; allow HTTP(S) absolute URLs, reject userinfo/unsafe schemes/control characters; viewport is integer 32–7680. Only independent appearance is allowed. Add encrypted URL roundtrip and template rebinding coverage. Save/publish require a complete URL.
- [x] **Import and editing.** Add a rounded dashed `+更多` category action. Show name, browser URL and viewport width/height with inline validation; import into the existing centered item flow. Inspector exposes URL/viewport plus existing geometry and layer controls, with no component-specific style parameters. Test save/reopen, multiple sources, resize without viewport changes and invalid input.
- [x] **External rendering.** Shared `configureBrowserSourceFrame(frame, config, displayWidth, displayHeight)` applies sandbox, no-referrer and viewport transform. Editor and published output never send component init/data to external frames or trust their messages. Load/timeout participates in scene publication; preserve previous output on timeout. Test combined and individual output and removal/visibility cleanup.
- [x] **Verification and documentation.** Review the rendered picker and import panel in the authorized canvas workflow; verify Electron launch integration through the existing isolated fixture. Run focused scene/canvas tests and gates justified by the persistence/security changes. Record actual results and archive after completion.

## Verification

- `node --experimental-vm-modules --test test/admin/canvas-browser-source.test.js` for picker and end-to-end source behavior using synthetic local pages.
- Focused existing picker/editing/template/draft, scene service/store/renderer/contract, and desktop canvas tests plus new browser source tests.
- `npm run check`, `npm run verify:docs`, `npm run verify:architecture`, and `npm run verify:contracts` for shared type, persisted contract and documentation consistency.
- QA inventory: compact header, no subtitle/duplicate headings, dashed More entry, transparent scrollbar track without arrows, Escape and close, URL validation, import, resolution edit, drag, resize, dimensions, hide/remove, save/reopen, combined/individual output; off-path cases are invalid URL and unresponsive external page.
- Screenshots and scratch state stay under repository `tmp/`. Use the existing authorized Electron test fixture with isolated user/session/crash directories, in-memory database and random HTTP port; close only owned processes.
- Final touched diff review, `git diff --check`, `git status --short`.

## Failure handling and done conditions

Keep the prior publication on validation, encryption, save or renderer readiness failures. Review/reverse only this task's changes if necessary. Do not claim third-party iframe restrictions or actual streaming-software rendering were verified by a synthetic source. Completion requires all four requested UI outcomes, encrypted save/reopen, focused tests, visually reviewed evidence and consistent contracts; record any external compatibility limits.

## Evidence

- Implemented the four requested picker/import behaviors without changing existing component style ownership. Shared normalizer and frame helper serve editor and output. Native dialog Escape behavior was already available and is now covered by the UI regression.
- External URL encryption uses the existing scene secret codec, with no schema migration. URLs are excluded from templates and persistent recovery snapshots; recovery uses current authorized URLs by item ID. A single boolean records unsaved URL changes without retaining their content. Clean reopening has no recovery warning.
- `node --experimental-vm-modules --test test/admin/canvas-browser-source.test.js`: 1/1 passed after the last form validation edit. Covers invalid import and inspector URLs, sequential field correction, default reset, two sources, drag/resize, viewport changes, saved reload, combined/individual output and protocol/referrer isolation.
- `node --experimental-vm-modules --test test/admin/component-preview-drafts.test.js`: 17/17 passed after the final recovery-message change.
- `node --experimental-vm-modules --test --test-concurrency=4 test/scenes/*.test.js test/admin/scene-browser-source-template.test.js test/admin/scene-component-definitions.test.js test/admin/component-preview-drafts.test.js test/admin/canvas-browser-source.test.js test/admin/canvas-editing.test.js`: 184 passing tests, with one file temporarily failing to parse while an unrelated canvas-overflow change edited `scene-renderer.test.js`. Re-running that file after the concurrent edit completed passed all 3 tests. The earlier canvas-boundary assertion conflict also passed in this later run. No unrelated geometry or clock changes were reverted or rewritten for this task.
- Existing `canvas-component-library.test.js` and `test/desktop/danmaku-canvas-electron.test.js` passed. The backend worker additionally verified existing scene service/store/HTTP/runtime/template/type contracts and new encrypted URL tests.
- `npm run check`, `npm run verify:docs`, and `npm run verify:architecture` passed. `verify:contracts` initially found the user's server checkout ahead of the pinned revision; `node scripts/verify-server-contract.js D:\Work\Live\tmp\canvas-browser-source-server-contract` passed all 10 fixtures using an isolated detached checkout at `01fb2b47d5e081f5dd559933991ade4819eb3428`, then that checkout was removed.
- Final rechecks: JavaScript syntax and `git diff --check` passed. The documentation gate passed 9/10 checks after this plan was archived; its only failure is the concurrently created, unrelated `specs/plans/2026-10-05-text-box.md` using `状态：In Progress`, which the active-plan status parser does not recognize. The earlier full documentation gate passed before that file appeared. This task leaves that parallel plan intact.
- Persistent interactive QA launched the existing isolated Electron fixture and followed its real desktop-generated `/c` URL (HTTP 200). At 1440 × 960, the header measured 36px, category top padding 8px, track transparent, scrollbar buttons hidden, and no duplicate section headings. Escape and X worked. Saving a synthetic external source through the real desktop bridge and reopening retained its 800 × 600 viewport and 640 × 480 display size. No page errors or page overflow were found.
- Visual evidence lives in repository `tmp/canvas-browser-source/`: picker/import/editor/single-output captures from the automated fixture and `desktop-picker.png`, `desktop-import.png`, `desktop-editor.png` from the real desktop entry. Owned Electron/browser processes were closed. No production account, user database or actual streaming-software session was used.
- Third-party compatibility remains bounded by iframe policy, opaque-origin behavior and provider availability. Load events cannot establish provider business readiness. These limits are described in the UI and source guide.
