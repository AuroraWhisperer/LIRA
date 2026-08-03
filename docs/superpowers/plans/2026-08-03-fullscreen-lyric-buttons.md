# Fullscreen Lyric Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fullscreen player's combined lyric-mode button with separate, mutually exclusive romanization and Chinese-translation buttons whose visibility follows the current track's lyric data.

**Architecture:** Keep the existing single `lyricMode` state (`none`, `roma`, or `trans`) so simultaneous activation remains impossible. Give each lyric type its own DOM button, update each button's visibility from `line.roma` and `line.translation`, and reuse the existing lyric re-render path when either button changes the mode.

**Tech Stack:** Browser ES modules, HTML, CSS, Node.js `node:test`

## Global Constraints

- The romanization button appears above the Chinese-translation button.
- A button appears only when at least one lyric line contains its corresponding data.
- The two modes are mutually exclusive; clicking the active mode closes it.
- Changing tracks resets the mode to `none`.
- Do not add dependencies or refactor unrelated playback code.

---

### Task 1: Add fullscreen lyric-button regression coverage

**Files:**
- Test: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: `FullscreenPlayer._updateLyricToggles(track)` and `FullscreenPlayer._toggleLyricMode(mode)`
- Produces: Regression checks for DOM order, per-track visibility, mutual exclusion, active-mode shutdown, and track reset

- [x] **Step 1: Write the failing tests**

```js
test('fullscreen lyric buttons follow available track data in romanization-first order', async () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  assert.ok(html.indexOf('id="fsRomaToggleBtn"') < html.indexOf('id="fsTranslationToggleBtn"'));

  const { FullscreenPlayer } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'ui', 'fullscreen.js')
  );
  const player = new FullscreenPlayer();
  player.lyricTogglesEl = { style: {} };
  player.romaToggleBtn = createLyricToggleButton();
  player.translationToggleBtn = createLyricToggleButton();

  player._updateLyricToggles({ lyrics: { lines: [{ roma: 'romaji' }] } });
  assert.equal(player.romaToggleBtn.style.display, 'grid');
  assert.equal(player.translationToggleBtn.style.display, 'none');
});

test('fullscreen lyric buttons switch mutually exclusively and close the active mode', async () => {
  const { FullscreenPlayer } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'ui', 'fullscreen.js')
  );
  const player = new FullscreenPlayer();
  player.romaToggleBtn = createLyricToggleButton();
  player.translationToggleBtn = createLyricToggleButton();
  player.renderLyricLines = () => {};
  player._lastLyricLines = [{}];

  player._toggleLyricMode('roma');
  assert.equal(player.lyricMode, 'roma');
  player._toggleLyricMode('trans');
  assert.equal(player.lyricMode, 'trans');
  player._toggleLyricMode('trans');
  assert.equal(player.lyricMode, 'none');
});
```

- [x] **Step 2: Run the focused tests and verify they fail**

Run: `node --experimental-vm-modules --test --test-name-pattern="fullscreen lyric buttons" test/frontend-regressions.test.js`

Expected: FAIL because the two button IDs and `_toggleLyricMode` do not exist.

### Task 2: Implement separate mutually exclusive controls

**Files:**
- Modify: `public/pages/admin.html:1737`
- Modify: `public/css/playback/fullscreen.css:556`
- Modify: `public/js/playback/ui/fullscreen.js:41`
- Test: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: Lyric lines containing optional `roma` and `translation` strings
- Produces: `_toggleLyricMode(mode: 'roma' | 'trans')`, plus `romaToggleBtn` and `translationToggleBtn` element references

- [x] **Step 1: Replace the combined HTML control**

Add `fsRomaToggleBtn` before `fsTranslationToggleBtn`, using visible labels `罗` and `译` and precise `title`/`aria-label` text.

- [x] **Step 2: Update button layout and active styles**

Add an `8px` vertical gap, preserve the existing shared button styling, and use `mode-roma` only on the romanization button and `mode-trans` only on the translation button.

- [x] **Step 3: Replace cycling with explicit mutual exclusion**

```js
_toggleLyricMode(mode) {
  this.lyricMode = this.lyricMode === mode ? 'none' : mode;
  this._updateLyricToggleButtons();
  if (this._lastLyricLines?.length > 0) this.renderLyricLines(this._lastLyricLines);
}
```

Update `_updateLyricToggles(track)` so each button uses `display: grid` only when its data exists and otherwise uses `display: none`.

- [x] **Step 4: Run the focused regression tests**

Run: `node --experimental-vm-modules --test --test-name-pattern="fullscreen" test/frontend-regressions.test.js`

Expected: All fullscreen tests PASS.

- [x] **Step 5: Run repository validation**

Run: `npm run check`

Expected: PASS.

Run: `npm test`

Expected: All tests PASS.
