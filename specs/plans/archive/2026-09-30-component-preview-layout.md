# Component Preview Layout Implementation Plan

**Status:** Completed.

## Goal

Provide the user-confirmed browser layout: a component selector on the left, a large current-component canvas in the middle, and editable parameters on the right. Keep each component's draft when switching and retain its original explicit save path.

## Current Behavior And Ownership

The browser page currently opens one component and places its parameters to the left of the preview. `component-preview-dialog.js` bridges one desktop controller through a temporary, component-scoped session. `component-preview-remote.js` preserves browser drafts until desktop acknowledgement. Component factories own parameters and display data; the registry holds initialized desktop factories. The desktop composition root lazily initializes optional component owners.

## Scope And Compatibility

This changes the browser editor layout and component navigation. It does not add combined scene output, component instances, automatic saves, new size settings, new dependencies, or new business actions. Keep existing single-component URLs valid, keep every capability scoped to its original component, and continue to keep admin credentials out of the browser. Existing uncommitted work belongs to the earlier browser-preview change and must be preserved.

## Changes

- The registry accepts a composition-root preparation callback so clicking preview can initialize the existing optional owners once. The launcher opens one existing session per available component, preserves the selected component's existing `id`/`token` fragment fields, and adds the other scoped session references in the fragment.
- The existing HTML composer includes inert templates for the four component panels. The remote module owns each browser connection; the page mounts one panel and renderer at a time and closes every connection on page exit.
- The page uses approximately 200px / flexible / 340px columns at normal desktop sizes. Component navigation becomes horizontal on smaller windows. Use existing LIRA tokens and preserve the parameter controls and explicit save/discard behavior.
- Preparation waits for the initial server overlay address resolution before creating sessions, so its initial controller reset cannot invalidate a newly opened danmaku connection.
- Update the current page/API references and component-workspace specification with the navigation behavior and its boundary from combined scene output.

## Milestones And Verification

- [x] Establish the current rendered state using the existing isolated HTTP fixture and synthetic settings.
- [x] Implement independent session launch/cleanup and browser component selection. Extend the existing browser test with rapid switching, draft retention, exact save ownership, one visible iframe, and closure/reopen checks.
- [x] Apply and visually inspect the layout at 1440×900 and 1280×800, plus its narrow-window navigation. Verify long danmaku/queue parameters scroll independently and save controls stay visible.
- [x] Run focused component controller, registry, workspace, remote, browser, and transport tests; repository syntax, architecture and docs gates are justified by the changed public page/session composition. Run the Impeccable detector once, review only task-owned changes, `git diff --check`, and `git status --short`.

## Verification Evidence

- `node --experimental-vm-modules --test --test-reporter=spec test/danmaku/server-danmaku-settings.test.js test/admin/component-config-controller.test.js test/admin/component-preview-registry.test.js test/admin/component-preview-remote.test.js test/admin/component-workspace.test.js test/transport/component-preview.test.js test/admin/frontend-admin-runtime.test.js test/admin/frontend-admin-shell.test.js`: 66/66 passed.
- `node --experimental-vm-modules --test --test-reporter=spec test/admin/component-preview-browser.test.js test/desktop/desktop-request-auth.test.js`: 16/16 passed. The browser test also delays all desktop exchanges, accepts clock and queue saves, closes all sessions, then verifies both owners finish saving and all four sessions release independently.
- `npm run check`: syntax passed for 1122 JavaScript files; `node --check public/js/admin/app.js` passed after the preparation wiring change.
- `npm run verify:architecture`: 22/22 passed.
- `npm run verify:docs`: 9/9 passed after archiving the completed plan and updating its index.
- Final scoped source/test/document review, `git diff --check`, and `git status --short` completed. Existing and concurrent changes were preserved; screenshots remain ignored under `tmp/`.
- The one Impeccable layout detector run returned `[]`.
- Isolated Playwright inspection at 1440×900 measured 201.6 / 892.8 / 345.6 px columns; 1280×800 measured 179.2 / 788.8 / 312 px. At 850×760 the selector moves above the 550 / 300 px content columns. All four renderers were inspected, with no page errors, horizontal overflow, or hidden footer controls.
- Screenshots are under repository `tmp/component-preview-layout/`: `clock-1440.png`, `danmaku-1440.png`, `queue-1280.png`, and `overtime-850.png`. The isolated browser, contexts, and HTTP fixture were closed after inspection; no real user data was used.

## Failure Handling And Done When

Failed preparation or session creation closes every session already opened. Desktop generation/authorization changes retain the existing invalidation rules. A disconnected component disables its editing without routing commands to another controller. Switching releases its old renderer and panel subscriptions while retaining the connection/controller draft. Completion requires working three-column navigation and persistence-path tests, visual evidence under repository `tmp/`, consistent references, and no changes to user data or unrelated work.
