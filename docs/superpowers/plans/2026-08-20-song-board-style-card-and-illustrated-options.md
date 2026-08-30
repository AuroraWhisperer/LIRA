# 点歌板风格卡片与插画参数 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the tinted backgrounds from style 1/2 selector cards and add useful, working typography controls for illustrated styles 3–6.

**Architecture:** Keep the existing style picker and settings snapshot flow. Add three persisted overlay settings for illustrated typography (font family, weight, and text color), expose them only for styles 3–6, and apply them through CSS variables without changing artwork layout or queue behavior.

**Tech Stack:** Vanilla JavaScript ES modules, native CSS, Node.js `node:test`, SQLite-backed settings defaults.

## Global Constraints

- Preserve the existing Electron renderer, HTTP settings contract, and illustrated artwork geometry.
- Keep style 1/2 card selection states accessible and visually distinct through borders/rings rather than colored fills.
- Preserve existing settings when the new illustrated options are unset or at their defaults.

### Task 1: Selector card neutralization

**Files:**

- Modify: `public/css/admin/toasts/gifts.css`
- Test: `test/frontend-queue.test.js`

- [x] Replace style 1/2 gradient fills with the shared neutral background while retaining their existing border/title/accent palettes.
- [x] Update the style-card regression to require neutral backgrounds for classic and identity and distinct themed fills for styles 3–6.

### Task 2: Persisted illustrated typography controls

**Files:**

- Modify: `src/storage/settings-store.js`
- Modify: `src/storage/theme-store.js`
- Modify: `public/pages/admin/song/queue-theme.html`
- Modify: `public/js/admin/theme.js`
- Modify: `public/js/admin/forms.js`
- Modify: `public/js/overlays/queue.js`
- Modify: `public/js/overlays/queue-render.js`
- Modify: `public/css/overlays/base/illustrated.css`
- Modify: `public/css/overlays/base/storybook.css`
- Modify: `public/css/overlays/base/neon-vinyl.css`
- Modify: `public/css/overlays/base/cherry-ribbon.css`
- Modify: `public/css/overlays/base/golden-lily.css`
- Modify: `docs/architecture/frontend/app.md`
- Modify: `docs/architecture/frontend/overlays.md`
- Test: `test/frontend-queue.test.js`

- [x] Add `illustratedQueueFontFamily`, `illustratedQueueFontWeight`, and `illustratedQueueTextColor` defaults and include them in overlay theme snapshots.
- [x] Add a common 3–6-only typography section with font family, weight, and color controls; collect and hydrate the values through the existing autosave path.
- [x] Apply the controls as root CSS variables, using each artwork's current colors when the color field is empty.
- [x] Make each illustrated style consume the shared font family/weight/color variables for rows, titles, ranks, and empty states.
- [x] Add regression assertions for form fields, defaults, collection, CSS variables, and style card behavior.
- [x] Update the Admin and overlay owner documents with the new style-card and illustrated typography behavior.

### Task 3: Verification

- [x] Run `node --test test/frontend-queue.test.js`.
- [x] Run `npm run check` and `git diff --check`.
