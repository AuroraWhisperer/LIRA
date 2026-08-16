# Desktop Lyric Settings Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge LIRA's existing desktop lyric controls with the relevant Now Playing lyric settings, remove duplicate concepts, and make every exposed control persist and affect both the admin preview and `/lyrics` browser source.

**Architecture:** Keep the existing settings store and `/api/settings` snapshot flow. The admin form owns editing, autosave, range synchronization, and reset behavior; `desktop-lyric-preview.js` remains the shared renderer for the admin preview and standalone browser source, applying visual settings through CSS variables/classes and timing settings in its frame calculations.

**Tech Stack:** CommonJS Node.js settings store, browser ES modules, HTML/CSS, `node:test`.

## Global Constraints

- Keep the WeSing lyric-source card first and preserve its WeSing-only behavior.
- Do not alter QQ Music or NetEase Music playback lyric acquisition.
- Preserve existing saved desktop lyric values and add defaults only for new keys.
- Do not add runtime dependencies.
- Preserve the user's hover-only settings scrollbar behavior.
- Do not commit unless the user explicitly requests it.

---

### Task 1: Define the merged settings contract

**Files:**
- Modify: `src/storage/settings-store.js`
- Test: `test/desktop-lyrics.test.js`

**Interfaces:**
- Consumes: the existing string-valued `DEFAULT_SETTINGS` contract.
- Produces: defaults for typography, effects, content visibility, synchronization, layout, background, and global filter controls.

- [ ] **Step 1: Write a failing defaults test**

Assert representative new keys and exact values, including `desktopLyricFallbackFontFamily`, `desktopLyricTextAlign`, `desktopLyricShowTranslation`, `desktopLyricKaraokeEnabled`, `desktopLyricHideOnPause`, `desktopLyricTimeOffsetMs`, `desktopLyricSpringAnimation`, `desktopLyricAlignPosition`, `desktopLyricBackgroundEnabled`, and `desktopLyricBrightness`.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --experimental-vm-modules --test test/desktop-lyrics.test.js`

- [ ] **Step 3: Add defaults without migrating or rewriting existing values**

Use strings because `/api/settings` and the settings table already persist string values. Existing keys such as `desktopLyricFontSize`, `desktopLyricStrokeWidth`, `desktopLyricBgOpacity`, `desktopLyricScale`, and `desktopLyricLineHeight` remain authoritative.

- [ ] **Step 4: Run the focused test and verify the defaults pass**

Run: `node --experimental-vm-modules --test test/desktop-lyrics.test.js`

### Task 2: Reorganize the settings panel

**Files:**
- Modify: `public/pages/admin/song/desktop-lyric.html`
- Modify: `public/css/admin/desktop-lyric-preview.css`
- Test: `test/desktop-lyrics.test.js`

**Interfaces:**
- Consumes: settings keys from Task 1 and the existing `switch-control`, `parameter-range`, and color input patterns.
- Produces: grouped controls beneath the WeSing source card.

- [ ] **Step 1: Write failing structure assertions**

Assert these ordered groups: `基础样式`, `描边与阴影`, `内容与显示`, `可见性与同步`, `动画与布局`, `背景与渲染`, and `操作`. Assert all new input IDs and the `desktopLyricResetBtn` button exist below the WeSing source settings.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --experimental-vm-modules --test test/desktop-lyrics.test.js`

- [ ] **Step 3: Replace the old fragmented cards with collapsible setting groups**

Deduplicate Now Playing concepts against richer existing controls: numeric font size replaces size presets, font weight replaces a separate bold switch, stroke width `0` remains meaningful while an enable switch offers quick toggling, and existing overall scale/line height remain available. Use compact control rows, paired range/number inputs, plain-language descriptions, keyboard focus states, and responsive stacking.

- [ ] **Step 4: Add restrained section styling**

Reuse existing CSS variables and the pink/teal LIRA palette. The signature element is a narrow colored category rail on each collapsible group; avoid new global typography or unrelated page changes.

- [ ] **Step 5: Run the focused test and verify structure/styles pass**

Run: `node --experimental-vm-modules --test test/desktop-lyrics.test.js`

### Task 3: Persist, restore, and reset every setting

**Files:**
- Modify: `public/js/admin/desktop-lyric.js`
- Test: `test/desktop-lyrics.test.js`

**Interfaces:**
- Consumes: form IDs from Task 2, `window.AdminApp.utils.api`, and `window.AdminApp.forms.bindRangePair`.
- Produces: complete `/api/settings` payloads, form restoration, and style-only default reset.

- [ ] **Step 1: Extend the autosave test with new values**

Cover checkboxes, selects, text inputs, colors, range values, and reset. Verify reset does not change `weSingLyricSource` or `weSingSmartLyricMatch`.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --experimental-vm-modules --test test/desktop-lyrics.test.js`

- [ ] **Step 3: Implement a small declarative field contract**

Define style defaults and range-pair metadata once in `desktop-lyric.js`. Collect checkbox values as `'true'`/`'false'`, restore values without overwriting unsaved user edits during later snapshots, refresh range fills, and reset only desktop lyric presentation settings.

- [ ] **Step 4: Run the focused test and verify autosave/reset pass**

Run: `node --experimental-vm-modules --test test/desktop-lyrics.test.js`

### Task 4: Apply the settings in the shared lyric renderer

**Files:**
- Modify: `public/js/admin/desktop-lyric-preview.js`
- Modify: `public/css/admin/desktop-lyric-preview.css`
- Modify: `public/css/playback/desktop-lyric.css`
- Modify: `public/pages/overlays/lyric-window.html`
- Test: `test/desktop-lyrics.test.js`

**Interfaces:**
- Consumes: snapshots from `/api/settings`, lyric state, and lyric timeline messages.
- Produces: identical setting behavior in the admin preview and `/lyrics` browser source.

- [ ] **Step 1: Add failing behavior tests**

Test pure helpers for offset timing, no-lyric text/title selection, alignment target calculation, boolean normalization, and CSS setting resolution. Add source/style assertions for pause hiding, translation visibility, passed-line hiding, karaoke mode, enhancement, animation, blur, scale, background renderer, and global filters.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --experimental-vm-modules --test test/desktop-lyrics.test.js`

- [ ] **Step 3: Implement timing and content behavior**

Apply `desktopLyricTimeOffsetMs` to active-line, word, and interlude calculations; use the track title or configured no-lyric text for empty timelines; re-render when translation, karaoke, traditional glyph mode, or no-lyric settings change.

- [ ] **Step 4: Implement visual behavior with CSS variables/classes**

Apply fonts, alignment, spacing, stroke/shadow controls, base and translation opacity, pause/past-line visibility, current-line enhancement, spring/blur/scale switches, anchor position, transforms, perspective, background renderer, and opacity/brightness/contrast/saturation filters. Respect `prefers-reduced-motion`.

- [ ] **Step 5: Bump the browser-source asset query strings**

Update `lyric-window.html` so existing OBS/browser-source caches load the revised renderer and stylesheet.

- [ ] **Step 6: Run the focused test and verify renderer behavior passes**

Run: `node --experimental-vm-modules --test test/desktop-lyrics.test.js`

### Task 5: Verify the complete change

**Files:**
- Test: `test/desktop-lyrics.test.js`
- Test: `test/wesing-online-lyrics.test.js`

**Interfaces:**
- Consumes: all preceding tasks.
- Produces: a verified, reviewable working tree without a commit.

- [ ] **Step 1: Run focused lyric tests**

Run: `node --experimental-vm-modules --test test/desktop-lyrics.test.js test/wesing-online-lyrics.test.js`

- [ ] **Step 2: Run static checks**

Run: `npm.cmd run check`

- [ ] **Step 3: Run the full test suite**

Run: `npm.cmd test`

- [ ] **Step 4: Check the patch for whitespace and scope**

Run: `git diff --check`

Confirm `public/js/playback/services/lyric-service.js` and provider acquisition routes remain unchanged.
