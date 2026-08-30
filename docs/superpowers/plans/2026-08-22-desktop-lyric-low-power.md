# Desktop Lyric Low-Power Highlighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a selectable lyric highlighting mode that keeps the current continuous fill, supports a discrete low-power “逐字点亮” mode, and presents the choice in a clearer desktop lyric settings layout.

**Architecture:** Keep the existing shared lyric clock and timeline ownership. Extend the shared word animator with an explicit `discrete` mode that toggles completed/upcoming states at timed boundaries, while the preview settings resolve a three-state mode (`off`, `continuous`, `discrete`) and preserve the existing boolean setting as a compatibility fallback. Reorganize only the content/display settings group and add styling that makes the mode choice and its two visual states legible without changing the desktop overlay contract.

**Tech Stack:** Vanilla JavaScript ES modules, native CSS, Electron renderer assets, `node:test`.

## Global Constraints

- Preserve the existing Electron desktop client as the primary UI target.
- Preserve HTTP, WebSocket, settings keys, persisted JSON, and overlay URL contracts unless the new setting is additive.
- Keep CommonJS backend style, Vanilla JavaScript ES modules, native CSS, and Node.js 24+.
- Use text nodes for lyric content; do not introduce `innerHTML`.
- Keep the existing automatic performance profile for continuous mode; an explicit discrete mode must not be silently restored to continuous animation.
- Treat timed lyric tokens as the available granularity; do not fabricate per-character timing when a source token contains multiple characters.

---

### Task 1: Define mode resolution and regression coverage

**Files:**

- Modify: `public/js/admin/desktop-lyric-defaults.js`
- Modify: `src/storage/settings-store.js`
- Modify: `public/js/admin/desktop-lyric-preview.js`
- Modify: `test/desktop-lyrics.test.js`

**Interfaces:**

- Produces `desktopLyricKaraokeMode` persisted setting with values `off`, `continuous`, and `discrete`; default `continuous`.
- Produces `resolveDesktopLyricSettings(...).karaokeMode` with compatibility mapping: missing mode + old boolean `true` → `continuous`; old boolean `false` → `off`.

- [ ] **Step 1: Write failing tests** for storage/frontend default parity, mode normalization, and compatibility mapping.
- [ ] **Step 2: Run the focused tests** with `node --test test/desktop-lyrics.test.js`; verify the new assertions fail before implementation.
- [ ] **Step 3: Add the additive storage and frontend defaults** and resolve the mode in `resolveDesktopLyricSettings` without removing `desktopLyricKaraokeEnabled`.
- [ ] **Step 4: Update form collection/loading** so the new select/radio value is persisted and legacy settings still render as continuous/off.
- [ ] **Step 5: Re-run `node --test test/desktop-lyrics.test.js`** and confirm mode/default assertions pass.

### Task 2: Implement explicit discrete word animation

**Files:**

- Modify: `public/js/shared/lyric-word-animator.js`
- Modify: `public/js/admin/desktop-lyric-preview.js`
- Modify: `public/css/admin/desktop-lyric-preview.css`
- Modify: `test/desktop-lyrics.test.js`

**Interfaces:**

- `LyricWordAnimator` accepts `mode: 'waapi' | 'manual' | 'static' | 'discrete'`.
- In `discrete` mode, each timed token receives a `data-word-state`/state class of `upcoming` or `complete`, with no per-frame `clip-path` interpolation.

- [ ] **Step 1: Add failing animator tests** that mount timed words, sync before/after `startMs`, and assert only the state boundary changes while `waapi`/`manual` behavior remains unchanged.
- [ ] **Step 2: Run the focused test** and verify the discrete-mode assertions fail.
- [ ] **Step 3: Implement discrete state updates** using `startMs` as the reveal threshold, preserving correct behavior on pause, seek, backward correction, and remount.
- [ ] **Step 4: Make preview mode selection authoritative**: `off` clears word layers, `continuous` uses the existing performance profile, and `discrete` keeps the animator discrete while still allowing line/timeline updates.
- [ ] **Step 5: Add CSS for two explicit states** using the existing gold highlight and user-selected lyric color; avoid a third “current word” treatment.
- [ ] **Step 6: Re-run the focused tests** and inspect `git diff --check`.

### Task 3: Redesign the settings column’s display strategy section

**Files:**

- Modify: `public/pages/admin/song/desktop-lyric.html`
- Modify: `public/js/admin/desktop-lyric.js`
- Modify: `public/css/admin/desktop-lyric-preview.css`
- Modify: `test/desktop-lyrics.test.js`

**Interfaces:**

- Replaces the ambiguous “逐字歌词模式” boolean presentation with an accessible segmented control labelled “逐字高亮方式”.
- Keeps existing group order and all unrelated controls/IDs stable.

- [ ] **Step 1: Add failing markup/style assertions** for the three options, the “已唱/未唱” visual legend, and the renamed display-strategy copy.
- [ ] **Step 2: Run `node --test test/desktop-lyrics.test.js`** to confirm the assertions fail.
- [ ] **Step 3: Update the content group** with the mode selector, a concise low-power explanation, and a two-state preview legend; keep translation, hide-passed, traditional mode, and interlude controls below it.
- [ ] **Step 4: Update settings collection/loading and autosave wiring** for the new input while preserving existing boolean behavior and reset defaults.
- [ ] **Step 5: Add restrained visual treatment**: one accent card inside the content group, existing LIRA gold for completed text, muted text for upcoming text, clear focus states, and reduced-motion-safe transitions.
- [ ] **Step 6: Re-run focused tests and review the settings markup for keyboard/label accessibility.**

### Task 4: Verify the complete change

**Files:**

- No new source files.

- [ ] **Step 1: Run `node --test test/desktop-lyrics.test.js`.**
- [ ] **Step 2: Run `npm run check`.**
- [ ] **Step 3: Run `npm run verify:quick`.**
- [ ] **Step 4: Review `git diff`, `git diff --check`, and `git status --short`; confirm only the plan, lyric settings, animator, preview, styles, and focused tests changed.**
