# Interaction overlay appearance

## Completed follow-up: optional title and appearance controls

Remove the sample/session title fallback: an empty overlay title hides it. Keep custom titles and all existing appearance settings. Add whole-card opacity (`interactionOverallOpacity`, 0–100, default 100), base type size (`interactionFontSize`, 16–24px, default 20), card radius (`interactionCornerRadius`, 0–32px, default 20), status and participant visibility (`interactionShowStatus` and `interactionShowParticipants`, both default true). Background opacity remains independent. These settings use the existing settings owner, validator and interactions-only snapshot projection; no migration or new service is needed.

The desktop editor uses three flat groups for content, color, and layout/display, next to a persistent preview on a transparency grid. Changes remain drafts until applied; visibility uses checkboxes. Borrow Material 3 supporting-pane layout and Fluent 2 hierarchy/control semantics while retaining the native project controls. Preserve multiline rules, paging geometry, reception warnings and score privacy.

- [x] Add defaults, bounded values/boolean validation and explicit scoped projection. Extend focused tests for defaults, opacity independence, persistence/reinitialization, invalid-patch atomicity and scope isolation.
- [x] Update shared styles and both renderers; rebuild editor groups and outputs. Verify empty/custom titles, transparent background versus whole-card opacity, colors, typography/radius and visibility in isolated Electron and the OBS browser route. Check narrow layout and multiline rules.
- [x] Update API/storage/overlay docs; run affected interaction/settings/admin tests, JS syntax checks, architecture/modularity/docs checks justified by settings/projection changes, and final diff/whitespace/status review. Record results, close owned QA processes, note any cleanup limitation and archive this plan.

Done when saved controls match the preview and overlay after reload, the default title is absent, privacy/pagination remain intact, and the scoped diff is reviewed. On failure retain draft settings and revert only follow-up hunks; never touch real user data or restart the user's app. Existing contract-gate revision mismatch in the adjacent server checkout is unrelated and must not be modified for this task.

Completed verification: 37 focused tests passed (`interaction-appearance`, `settings-contract`, `interactions-overlay`, `interaction-routes`, `admin-page-composition`, `admin-style-ownership`, `overlay-projection`). `npm run check` passed for 956 files; architecture (22 tests), modularity and documentation (5 tests) checks passed. Electron with real preload/request authorization and the separate browser overlay confirmed draft-only changes, save/reload, blank and custom titles, 50% background alpha independent of 70% whole-card opacity, all four colors, 24px type, square corners, header/footer collapse, checkbox persistence/reset and failed-save retention. Hidden participants preserve reception warnings; collecting ratings hide aggregates. At 24px, multiline rules wrap within 408px with no horizontal overflow. A 943px-wide editor stacks the preview above controls; long options remain inside the 76px tracks. No renderer errors. Screenshots are outside the repository. The design detector's only finding is the existing absolute poll fill width transition with reduced-motion handling. Final diff/whitespace/status review found no generated data or unrelated changes.

The browser and owned Electron QA processes were closed. A tool session reset left an extra isolated Electron process; its exact PID and command line were verified before stopping it separately. Combined process/recursive-directory cleanup was rejected by automatic policy review without a more specific reason, so the temporary directory `C:/Users/Tom/AppData/Local/Temp/lira-appearance-qa-bkq9kI` remains. Concurrent edits to other features appeared during final status review and were left intact; the diff review above refers to this task's files.

## Completed follow-up: editable rating rules

The user clarified that the three rule lines are defaults, not a fixed layout. Add `interactionRatingRules` as one plain-text appearance setting with the current three lines as its default. The existing settings store, shared appearance validator, scoped projection and editor own this extension. Preserve multiline text, normalize CRLF to LF, render through `textContent`, wrap at the card width and let the card grow with its content. An empty value hides the rules. This changes displayed copy only, not scoring inputs or settlement.

- [x] Add the default, string normalization and explicit overlay setting projection. Verify storage reinitialization preserves multiline values, invalid types reject the whole patch, and other overlay scopes do not receive the text.
- [x] Replace static rules with a textarea, shared preview and overlay text; use `white-space: pre-wrap` and `overflow-wrap: anywhere`. Verify manual newlines, long unbroken text, clearing, restore defaults, applying and reload in isolated Electron/browser QA.
- [x] Update owning docs, run `node --experimental-vm-modules --test test/interaction-appearance.test.js test/settings-contract.test.js test/admin-page-composition.test.js test/interaction-routes.test.js`, relevant syntax checks, and final diff/whitespace/status review. Cleanup owned test data and return this plan to the archive after completion.

No migration, new dependency, credential or session contract change is needed. Use the existing defaults insertion behavior. Preserve the original user changes and undo only follow-up hunks if validation fails.

Follow-up verification: 21 focused tests, 22 architecture tests, 5 documentation tests and targeted syntax checks passed. Isolated Electron/browser QA confirmed six entered lines wrap to nine displayed lines inside a 408px content width (scroll width also 408px), blank lines remain, literal markup creates no elements, clearing hides rules while retaining the score area, reset remains a draft until applied, and reload restores saved rules. No browser errors; owned runtime and temporary data were removed. The only design-detector finding remains the pre-existing poll fill transition.

## Goal

Make the poll overlay compact and readable, with labels inside result bars and editable title, optional hint, text/bar/track/background colors and background opacity. Preview edits before applying them to the live overlay.

## Current behavior and ownership

`public/js/shared/interaction-view.js` owns the shared result rows. The overlay renderer and stylesheet fix the stage at 800×600 and always show the full participation rule. `public/js/admin/interactions.js` owns the host form. Appearance currently has no persisted settings.

Settings belong to the existing settings store and `/api/settings`; `src/server/settings-contract.js` validates writes and `overlay-projection.js` restricts each overlay's snapshot. Storage/API/overlay architecture documents own these contracts. Existing settings, projection, interaction and paging tests cover these boundaries.

## Scope and compatibility

- Keep existing session endpoints, voting/scoring rules, default duration, the earlier minutes/seconds controls and 1/2/5 minute presets.
- Keep the 800×600 OBS recommendation, 352px maximum list, 88px rows and existing pagination timing; shrink unused stage/list space.
- Keep score aggregation private until finished, session revision ordering, warning states and safe text rendering.
- Add seven flat appearance settings, using the store's existing insert-if-missing defaults; no schema migration or new dependency.
- Expose only these display settings to the interactions overlay, through its existing scoped state snapshots. No changes to auth, IPC, cloud synchronization or session storage.
- No redesign of other games or unrelated settings.

## Implementation and verification

- [x] Shared appearance defaults and validation; persist through existing settings endpoint, with invalid-patch atomicity, restart/default preservation and projection-isolation tests.
- [x] Compact overlay and shared result rows; title/hint and color settings update through snapshots without rebuilding rows or restarting pagination. Verify zero votes, winners/ties, long labels, scoring and empty states.
- [x] Host appearance editor with draft preview, reset and explicit apply; load failure can be retried, failed saves preserve draft, edits remain local until applied. Verify in an isolated Electron renderer and OBS browser surface.
- [x] Update owning architecture documents. Run focused tests, JS checks, contract/modularity gates, inspect the final diff, `git diff --check`, and `git status --short`.

## QA inventory

Use synthetic sessions/settings and temporary storage only. Check title/hint controls, all four color pickers, opacity, reset/apply/reload, persisted reload and live snapshot updates. Check two-option compact layout, long options/title, a list requiring pagination, all-zero results, tied winners and rating secrecy. Save screenshots of default and custom appearance. Close owned browsers/Electron/test servers after verification.

## Failure handling and done when

Keep draft on load/save failure and show a short inline error. Do not change user data or restart the user's app for QA. Reverse only this task's hunks if needed. Done when the requested controls persist and update the overlay, focused checks pass, runtime evidence is recorded, and the reviewed diff contains no generated data or secrets.

## Progress

User confirmed white background, dark text and soft teal bars, with editable title and optional hint. Design follows Fluent 2's hierarchy, concise content and readable color contrast; existing desktop controls remain the host UI vocabulary.

Completed on 2026-09-21. Storage defaults remain in the storage owner; a test keeps browser fallbacks consistent without importing frontend modules into storage. The worst-case long-title/hint/disconnection layout was reduced from 601px to 593px by using 24px stage padding, retaining the recommended 800×600 source size.

Verification passed:

- `node --experimental-vm-modules --test test/interaction-appearance.test.js test/interactions-overlay.test.js test/interactions.test.js test/frontend-interactions.test.js test/settings-contract.test.js test/overlay-projection.test.js test/overlay-http-access.test.js test/overlay-auto-pages.test.js` (36 tests).
- `node --experimental-vm-modules --test test/admin-page-composition.test.js test/admin-style-ownership.test.js test/frontend-admin-toolbox.test.js test/interaction-routes.test.js test/interaction-appearance.test.js` (24 tests).
- `npm run check`, `npm run verify:architecture`, `npm run verify:modularity`, `npm run verify:docs`, and final whitespace/diff/status inspection.
- Isolated Electron with the real preload, desktop request authorization, composed admin fragment, real settings HTTP route and WebSocket projection; separate Chromium overlay. Verified preview-only drafts, all color controls, opacity, apply/live updates, refresh restoration, failed save retention, failed load retry, reset, safe literal markup text, row/scroll preservation, paging, zero votes, ties, hidden live rating aggregates, finished ratings and empty-stage transparency. No browser errors. Synthetic SQLite/profile/server data stayed in a temporary directory.

Limitations: `npm run verify:contracts` could not start because adjacent `D:/Work/lira-server` is at `b082961da5e151235fceff8041da14f1c747fcfc`, while the check requires `5ea7b01c8fc7b1cec34a43b01f99c403fd9d1577`. That checkout was not modified. The design detector reported the existing progress-fill width transition; it remains scoped to the absolute fill, with reduced-motion support.
