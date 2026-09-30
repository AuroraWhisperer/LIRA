# Shared Browser Preview Canvas

**Status:** Completed on 2026-09-30. Implementation, focused tests and isolated browser verification passed.

## Goal And Accepted Behavior

The browser editor owns one common live-scene canvas. Its resolution presets and custom width/height apply to every component. Adding a component creates a centered, preset-sized layer; selection and appearance changes never resize the canvas or remove other layers. Save and reopen restore the canvas and layer geometry as well as component appearance.

## Ownership And Compatibility

Reuse scene documents, validation, persistence, immutable editing model and stage from the existing scene implementation. Keep component appearance saves in their original controllers. Add a separate temporary `canvas` capability to the existing preview relay, bound by the desktop controller to one scene document; it grants no management API or publication access. The existing scene service remains the persistence owner, including account scope and revision conflicts. The browser receives no desktop credentials.

The scene editor's existing first-scene selection rule is retained. If no scene exists, create a common canvas using the loaded danmaku canvas dimensions or 1920×1080. Existing scenes and legacy danmaku settings are not rewritten on startup. Old single-component links remain previewable, but need reopening from the client to save common geometry. No database format, publication, source URL, framework, dependency or desktop-security change is needed.

## Implementation

- [x] Move the browser resolution preset list into `public/js/shared/canvas-presets.js`, keeping the danmaku export compatible. Add a validated `resizeSceneCanvas(document, canvas)` operation to `scene-document-model.js`: scale geometry for equal aspect ratio, otherwise retain sizes/positions and clamp to the new canvas. Test both transitions and invalid dimensions.
- [x] Add a desktop `component-preview-canvas-controller.js` adapter over `requestScene` and the existing config controller. Cache by component owner/generation, retain drafts, bind the scene ID, and keep revision failures visible. Extend preparation/launcher/relay to carry a distinct canvas session; test capability isolation and save/reopen.
- [x] Replace the page's single-component view with the existing scene stage plus a component library and layers. Reuse component panels with canvas controls removed from the embedded danmaku panel. Add general canvas settings, geometry controls, explicit save/discard, selection and centered addition. Component viewport projection must fit the selected layer, including danmaku, without altering stored appearance.
- [x] Verify fixed logical dimensions through adding, selecting, changing styles, dragging and resizing; verify presets/custom dimensions, independent layers, saved reopening, partial save failures, and release of all sessions. Inspect wide and narrower desktop browser layouts using only synthetic data.
- [x] Update the page/API/spec references; run affected component, scene model/editor, transport and browser tests, syntax/architecture/docs gates and final diff/status checks. Archive this plan with actual evidence.

## Failure Handling And Verification

Session setup failure releases already opened sessions. The scene ID cannot be replaced by browser edits; account/generation changes invalidate the group. Optimistic scene revision conflicts retain drafts. Component saves and scene saves report their individual results and never claim atomic publication. Browser closure drains accepted commands independently.

Focused commands: `node --experimental-vm-modules --test test/admin/scene-document-model.test.js test/admin/scene-editor.test.js test/admin/component-preview-canvas-controller.test.js test/admin/component-preview-browser.test.js test/admin/component-preview-registry.test.js test/admin/component-preview-remote.test.js test/transport/component-preview.test.js test/danmaku/danmaku-layout.test.js`. Broader justified gates: `npm run check`, `npm run verify:architecture`, `npm run verify:docs`, then `git diff --check` and `git status --short`. Scratch artifacts stay under repository `tmp/`. Preserve all pre-existing and concurrent work; no commit or deployment.

## Completion Evidence

- The directly affected run passed 112/112 tests: the focused list above plus `component-config-controller`, `component-workspace`, `component-preview-contracts`, `server-danmaku-settings`, `frontend-admin-runtime` and `desktop-request-auth` tests.
- `npm run check` passed for 1128 JavaScript files; architecture checks passed 22/22 and documentation checks passed 9/9. The layout detector returned no findings for the page stylesheet and common canvas view.
- Isolated Chromium used synthetic desktop controllers and the real preview relay/renderers. At 1440×900 and 1024×768 the 1920×1080 canvas retained its logical size, showed four renderers, fit above the footer and introduced no document overflow. The 850×760 layout moved the component library and layers above the canvas. Portrait 1080×1920 fit correctly; preset 2560×1440 and custom 2000×1200 changes were verified, and reopening restored the custom canvas and four layers. No page errors were recorded.
- The bounded interaction pass covered hide/show, lock/unlock, centering, removal, save and discard. It exposed lost action buttons after discarding a lock change and fractional center coordinates incompatible with integer position fields. The view now owns action buttons separately from the inspector and centers on whole pixels. Both cases have regression assertions; the final browser run passed 5/5 and the edited JavaScript passed syntax checks.
- Screenshots and QA output are ignored artifacts under `tmp/shared-preview-canvas/`. Verification used no real user data and did not restart a running user application. The existing scene save owner is reused; this change saves drafts and does not publish a combined source.
- Final review preserved the pre-existing working-tree changes; `git diff --check` passed. No commit, branch or deployment was made.
