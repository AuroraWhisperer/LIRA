# Opening Animation Controls Implementation Plan

**Status:** Complete (2026-08-22)

**Goal:** Make the opening-animation toolbox controls update the preview immediately, keep the volume value and slider synchronized, present the two effect toggles as text-left/switch-right controls, use polished Chinese UI copy, and keep the Browser Source scene proportional at any source aspect ratio.

**Non-goals:** Do not change the `/opening` route or query contract, overlay animation layers, audio storage format, or unrelated toolbox panels.

**Current behavior:** `openingEnabled` is outside `#openingAnimationForm`, so the form listeners do not react to its change. The editor uses a native range input whose displayed value can drift from the persisted fractional setting during hydration. The two effect options are checkbox cards with the checkbox before their text. The page also includes decorative or explanatory labels/status text that the streamer does not need.

**Ownership:** `public/pages/admin/toolbox/start-animation.html` owns the editor markup; `public/js/admin/start-animation.js` owns config hydration, preview rendering, and settings persistence; `public/css/admin/other-features/start-animation.css` owns the control presentation; `test/opening-overlay.test.js` owns focused regression assertions.

**Compatibility constraints:** Keep the existing settings keys, `/api/settings` payload shape, fixed `/opening` source URL, `audio=browser` preview URL, safe overlay behavior, and default persisted volume (`0.35`). Disabling the master toggle must stop/hide the preview but must not overwrite the selected volume value. Visible page and default scene copy is Chinese; custom user-entered copy remains untouched.

## Milestones

1. Add focused assertions for the master-toggle event path, volume synchronization, switch markup/style, Chinese copy, removed copy, and proportional sizing.
2. Update the editor markup/CSS/JS and overlay defaults/sizing with the smallest compatible changes.
3. Run the focused opening-overlay tests, JavaScript checks, quick verification, and inspect the final diff/status.

## Verification

```text
node --test test/opening-overlay.test.js
npm run check
npm run verify:quick
node --test test/frontend-admin-shell.test.js test/opening-overlay.test.js
npm test
git diff --check
git status --short
```

All listed tests and gates passed. The local admin surface was checked; the master switch hid and blanked the preview immediately while preserving the 35% slider value, and the 16:9 overlay remained proportional inside a wider viewport.

## Done When

- Clicking the master switch immediately updates the preview without another navigation click.
- The slider position and percentage output always reflect the same persisted value after initial load and edits.
- Turning the master switch off leaves the configured volume intact while stopping/hiding the preview.
- “漂浮音符” and “音乐 EQ” are rendered as accessible text-left/switch-right controls.
- Visible editor and default overlay copy contains no English, with polished labels and no redundant status/note copy.
- The 16:9 design canvas uses proportional contain sizing against the Browser Source viewport, so changing source width/height or aspect ratio never stretches the artwork.
- No unrelated files changed.
