# Packaged Main Navigation Track Implementation Plan

> **For agentic workers:** Execute this plan task-by-task in the current session. Do not delegate or commit; preserve unrelated worktree changes.

**Goal:** Make the packaged Electron Admin header show one visible shared track behind 点歌、播放、礼物、百宝箱 and move a single active pill smoothly between the four real button bounds.

**Architecture:** Keep the existing Admin fragment, no-build ESM entry, and native CSS cascade. The navigation element owns the visible track plus two pseudo-elements: `::before` is the moving active pill and `::after` is the short accent rail. `public/js/admin/app.js` publishes the active button's x-position and width as CSS variables so both layers follow unequal tab widths and DPI scaling.

**Tech Stack:** Electron 43, Node.js 24+, vanilla ES modules, native CSS, `node:test`, Playwright Electron verification, electron-builder ASAR packaging.

## Global Constraints

- Electron desktop and a fresh packaged ASAR are the acceptance surfaces; browser-only simulation is insufficient.
- Preserve page URLs, hashes, button labels, click handlers, keyboard focus behavior, window controls, status strip, preload/IPC boundaries, and persisted data.
- Do not change the server cache policy or add a build dependency; production assets already return `Cache-Control: no-store`.
- Do not stop or replace the currently running live installation on port 3000.
- Do not modify or revert unrelated worktree changes, including current song actions, toolbox persistence, settings, and tests.
- Do not commit, publish, install, or replace `D:\Work\live-exe\LIRA`.

---

## Current Behavior

- The running installation reports `rootDir` as `D:\Work\live-exe\LIRA\resources\app.asar` and uses Electron device scale factor `1.5`.
- The installed `workspace/base.css` and `main-page-tabs.css` hashes exactly match the repository files. Installed `app.js` contains `syncMainPageIndicator`; its hash differs only because the repository has an unrelated uncommitted toolbox persistence change.
- The packaged UI shows the 22px accent underline, but the navigation container remains transparent and the active button owns a static fill/shadow. There is no visible shared track or moving active pill.
- `test/frontend-admin-shell.test.js` currently treats `border: 0` and `background: transparent` on `.main-page-tabs` as success, so the test encodes the behavior the user has rejected.

## Non-goals

- No redesign of the titlebar brand, live status, refresh button, window controls, page content, or responsive breakpoint structure.
- No change to Electron startup, port ownership, ASAR layout, updater behavior, session storage, or user data.
- No general button-system refactor and no restoration of colored borders around unrelated actions.

## Ownership

- Track container: `public/css/admin/gifts/main-page-tabs.css`.
- Button and moving-layer presentation: `public/css/admin/workspace/base.css`.
- Electron-specific active-state override: `public/css/overlays/desktop.css`.
- Active geometry publication: `public/js/admin/app.js`.
- Focused contract: `test/frontend-admin-shell.test.js`.
- Production consumer: Admin HTML composed by `src/server/admin-page.js` and packed by the `package.json` electron-builder `files` rule.

## Compatibility Constraints

- `.main-page-tab`, `data-main-page`, `.active`, `aria-pressed`, and the existing hash mapping remain unchanged.
- The moving pill must follow actual button rectangles instead of assuming equal widths; 百宝箱 is wider than the other three tabs.
- At 150% Windows DPI and at the supported 1024×680 CSS viewport, the header must not overlap the status strip or window controls and must not introduce horizontal scrolling.
- `prefers-reduced-motion: reduce` must position the pill immediately without animation.

## Proposed Changes

- Give `.main-page-tabs` a subtle warm track surface, border, radius, padding, and isolation context instead of a transparent frameless container.
- Add `.main-page-tabs::before` as the shared active pill using `--main-page-indicator-x` and `--main-page-indicator-width`.
- Keep `.main-page-tabs::after` as the accent rail, centered inside the same moving pill using those two variables.
- Make active buttons transparent so they do not cover or duplicate the shared pill; keep text/icon state and keyboard focus above the moving layers.
- Update `syncMainPageIndicator(activeButton)` to publish both the active x-position and width.
- Replace the obsolete frameless-navigation assertion with checks for the visible track, shared pill, accent rail, Electron override, and geometry variables.

## Milestones

### Task 1: Lock the corrected navigation contract

**Files:**
- Modify: `test/frontend-admin-shell.test.js`

**Interfaces:**
- Consumes: the existing CSS bundle readers and `public/js/admin/app.js` source.
- Produces: a focused regression that rejects a transparent track or per-button active fill.

- [x] **Step 1: Change the top-navigation test to require a visible track**

```js
assert.match(tabsRule, /background:\s*rgba\(255, 250, 241, 0\.72\)/);
assert.match(tabsRule, /border:\s*1px solid rgba\(183, 133, 50, 0\.16\)/);
assert.match(workspace, /\.main-page-tabs::before/);
assert.match(workspace, /width:\s*var\(--main-page-indicator-width\)/);
assert.match(appSource, /--main-page-indicator-width/);
```

- [x] **Step 2: Remove `.main-page-tabs` from the generic frameless-action audit**

Keep the audit for status, toolbox, lyric, playback, and other action controls; the main navigation is now an explicit segmented track exception.

- [x] **Step 3: Run the focused test and confirm it fails**

Run: `node --test --test-name-pattern="top navigation|accent actions" test/frontend-admin-shell.test.js`

Expected: failure because the current track is transparent, `::before` is absent, and JavaScript does not publish width.

### Task 2: Implement one shared moving pill

**Files:**
- Modify: `public/css/admin/gifts/main-page-tabs.css`
- Modify: `public/css/admin/workspace/base.css`
- Modify: `public/css/overlays/desktop.css`
- Modify: `public/js/admin/app.js`

**Interfaces:**
- Consumes: `.main-page-tabs`, `.main-page-tab.active`, and `setMainPage(pageId)`.
- Produces: CSS variables `--main-page-indicator-x: <px>` and `--main-page-indicator-width: <px>` on the navigation element.

- [x] **Step 1: Make the navigation container a visible track**

```css
.main-page-tabs {
  display: inline-flex;
  gap: 8px;
  position: relative;
  isolation: isolate;
  padding: 3px;
  border: 1px solid rgba(183, 133, 50, 0.16);
  border-radius: 12px;
  background: rgba(255, 250, 241, 0.72);
  box-shadow: inset 0 1px 2px rgba(87, 58, 28, 0.05);
}
```

- [x] **Step 2: Add the moving pill and keep the accent rail centered inside it**

```css
.main-page-tabs::before {
  content: '';
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 0;
  width: var(--main-page-indicator-width, 0px);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: 0 2px 8px rgba(87, 58, 28, 0.12), inset 0 0 0 1px rgba(183, 133, 50, 0.08);
  opacity: 0;
  transform: translateX(var(--main-page-indicator-x, 0px));
  transition: opacity 120ms ease, width 220ms cubic-bezier(.2, .8, .2, 1), transform 220ms cubic-bezier(.2, .8, .2, 1);
}

.main-page-tabs::after {
  transform: translateX(calc(var(--main-page-indicator-x, 0px) + (var(--main-page-indicator-width, 0px) - 22px) / 2));
}
```

Set both pseudo-elements visible under `.main-page-tabs.indicator-ready`. Give `.main-page-tab` `z-index: 1`, and remove fill/shadow from `.main-page-tab.active` and `body.desktop-shell .main-page-tab.active` so the shared pill is the only active surface.

- [x] **Step 3: Publish the active button width**

```js
const indicatorX = buttonRect.left - tabsRect.left;
tabs.style.setProperty('--main-page-indicator-x', `${indicatorX}px`);
tabs.style.setProperty('--main-page-indicator-width', `${buttonRect.width}px`);
tabs.classList.add('indicator-ready');
```

- [x] **Step 4: Run the focused test and confirm it passes**

Run: `node --test --test-name-pattern="top navigation|accent actions" test/frontend-admin-shell.test.js`

Expected: both matching tests pass.

### Task 3: Verify source Electron and packaged ASAR behavior

**Files:**
- No production source files beyond Task 2.
- Generated artifacts remain under ignored packaging output or an isolated temporary directory.

**Interfaces:**
- Consumes: Task 2 source and the existing electron-builder configuration.
- Produces: source-Electron and packaged-ASAR evidence without touching the live installation.

- [x] **Step 1: Run direct checks**

Run:

```powershell
node --test test/frontend-admin-shell.test.js
npm.cmd run check
git diff --check -- public/css/admin/gifts/main-page-tabs.css public/css/admin/workspace/base.css public/css/overlays/desktop.css public/js/admin/app.js test/frontend-admin-shell.test.js
```

Expected: all commands exit successfully.

- [x] **Step 2: Build a fresh unpacked Windows artifact**

Run: `node_modules\.bin\electron-builder.cmd --dir --win --x64 --config.electronDist=node_modules/electron/dist`

Expected: `release/win-unpacked/resources/app.asar` is created and contains the four changed production files.

- [x] **Step 3: Verify packaged file hashes/content**

Extract or read the ASAR with the installed `@electron/asar` dependency and assert that the track CSS, moving pill CSS, Electron override, and width-setting JavaScript are present.

- [x] **Step 4: Launch an isolated packaged copy on a non-production port**

Build an isolated QA copy with a temporary port override set to `3107`, immediately restore the production source, confirm `src/electron/main.js` has no diff, and launch the copied executable through Playwright. Do not stop or replace the live `D:\Work\live-exe\LIRA` process.

- [x] **Step 5: Perform functional and visual QA in real Electron**

Check initial 点歌, click 播放、礼物、百宝箱 and back to 点歌 with normal pointer input; inspect a mid-transition frame; verify keyboard focus and reduced-motion behavior; inspect the as-launched window and 1024×680. Capture the header from the packaged Electron window and confirm the outer track, moving pill, rail, status strip, and window controls are all visible without overlap.

## Verification

- Focused: `node --test test/frontend-admin-shell.test.js`.
- Syntax: `npm.cmd run check`.
- Packaged contents: ASAR inspection of the four changed assets.
- Runtime: Playwright against an isolated packaged Electron copy, not a browser mock.
- Layout: as-launched window, 1024×680, Windows 150% DPI-equivalent packaged rendering where available.
- Hygiene: scoped `git diff --check`, scoped diff review, and full `git status --short` review.

## Rollback Or Failure Handling

- Stop the isolated QA process and retain the current live installation untouched.
- Review only the five task-owned source/test files and this plan.
- Reverse task-owned hunks with `apply_patch`; never use reset, blanket checkout, or deletion against the workspace.
- Generated release or temporary artifacts are not source changes and must not be published or installed.

## Done When

- The visible shared track and moving active pill render from a fresh packaged ASAR.
- All four real buttons move the same pill to their measured bounds; the accent rail remains centered.
- The active button no longer adds a competing static fill/shadow.
- 1024×680 has no clipping, overlap, or horizontal overflow; keyboard and reduced-motion states remain correct.
- Focused tests, syntax check, ASAR inspection, packaged Electron QA, scoped diff check, and final diff/status review pass.
- Unrelated worktree changes and the currently running live installation remain untouched.

## Verification Results

- Corrected contract failed before implementation, then passed after the shared track and pill were added.
- `node --test test/frontend-admin-shell.test.js`: 45 passed, 0 failed.
- `npm.cmd run check`: syntax check passed for 442 JavaScript files.
- Scoped `git diff --check`: passed (line-ending warnings only).
- Fresh `release/win-unpacked/resources/app.asar`: all four changed production asset hashes matched the working tree.
- Real packaged Electron QA on isolated port 3107 at device scale factor 1.5: all four tabs, pointer input, keyboard focus, deep reload, reduced motion, animation sampling, as-launched size, and 1024×680 passed with no console/page errors, overlap, horizontal overflow, or indicator geometry mismatch.
- The live installation on port 3000 was not stopped, replaced, installed over, or modified.
