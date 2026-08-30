# Contextual Help Tooltips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace persistent Admin setting explanations with one consistent question-mark help affordance, while rewriting each explanation to be shorter and clearer without losing its practical meaning.

**Architecture:** Add one no-build ESM custom element, `<lira-help>`, plus shared Admin CSS. Each migrated explanation remains authored beside its owning title, while the component moves it into a top-layer tooltip so existing cards, details, and scroll panes cannot clip it.

**Tech Stack:** Electron 43 renderer, Vanilla JavaScript ESM, Custom Elements, native CSS Popover API, `node:test`.

## Global Constraints

- Preserve every input ID, name, value, min/max/step, settings key, API call, event handler, page URL, and fragment order.
- Keep connection state, save results, validation and error messages, safety warnings, empty states, confirmation copy, onboarding, interactive-tour copy, and usage-guide prose visible.
- Use one visual treatment for every help trigger and tooltip; placement may flip above or below only to stay inside the viewport.
- Rewrite help copy in plain Chinese and keep only what the control changes, special values such as `0` or an empty value, and genuinely useful defaults or ranges.
- Add no dependency, framework, bundler, process, port, persisted setting, or public protocol.
- Use named ESM exports and do not add `window.AdminApp` dependencies.
- Preserve unrelated gift-frame artwork and test changes already present in the worktree.
- Do not create a commit unless the user explicitly requests one.

---

## Goal

Admin controls show concise titles by default. A small `?` immediately after a control or section title opens a tightened explanation on hover, keyboard focus, Enter/Space, or click. Every help surface shares one style, and the tooltip remains within the desktop viewport without being clipped by cards or internal scroll areas.

## Non-goals

- Hiding operational state, warnings, destructive-action consequences, or documentation whose primary purpose is explanation.
- Changing control labels, defaults, validation, persistence, or runtime behavior.
- Redesigning OBS overlays, developer diagnostic pages, onboarding, the interactive tour, or the usage guide.
- Replacing native `title` attributes on compact icon-only actions.
- Introducing per-page, per-feature, or decorative tooltip variants.

## Current Behavior

Explanations use several always-visible forms: `.hint`, `<small>`, section-heading paragraphs, and feature-card descriptions. The desktop-lyric page has two isolated `i` tooltips, but no reusable component exists and most field descriptions consume permanent vertical space.

## Ownership

- Owner: `public/js/admin/` renderer modules and `public/css/styles-admin.css`.
- Composition: `public/js/admin/index.js`, `public/pages/admin/` fragments, and `src/server/admin-page.js`.
- Contract documentation: `docs/architecture/frontend/pages.md` and `docs/architecture/frontend/app.md`.
- Consumers: Admin song settings, themes, display board, desktop lyrics, gifts, danmaku/AI, overtime, games, and toolbox utilities.
- Focused tests: `test/frontend-admin-ai.test.js`, `test/frontend-song-board.test.js`, `test/desktop-lyrics.test.js`, `test/overtime-rule-editor.test.js`, and `test/admin-page-composition.test.js`.

## Compatibility Constraints

The composed Admin document remains a no-build ESM page. Tooltip copy stays in the DOM and is referenced with `aria-describedby`. Dynamic text nodes such as AI capability explanations keep their existing IDs so current `setText(...)` calls continue to update them. The Popover API is acceptable because the primary runtime is Electron 43.

## Proposed Changes

- Create `public/js/admin/contextual-help.js` with a named `initializeContextualHelp()` export and a guarded `<lira-help>` custom-element registration.
- Create `public/css/components/contextual-help.css` and import it from `public/css/styles-admin.css`.
- Import the component before Admin feature modules in `public/js/admin/index.js`.
- Replace only explanatory text in Admin fragments with `<lira-help>`, tighten the copy, and preserve dynamic status and warning elements.
- Render dynamic overtime rule explanations with the same custom element through DOM APIs.
- Add regression coverage and document the component boundary.

### Task 1: Lock the help component contract

**Files:**

- Create: `test/contextual-help.test.js`
- Modify: `test/frontend-admin-ai.test.js`
- Modify: `test/desktop-lyrics.test.js`
- Modify: `test/overtime-rule-editor.test.js`

**Interfaces:**

- Produces assertions for `<lira-help>`, `role="tooltip"`, `popover="manual"`, `aria-describedby`, keyboard activation, and representative migrated consumers.

- [x] Add `test/contextual-help.test.js` with source and pure-position assertions, including that `public/js/admin/index.js` imports `./contextual-help.js` before feature modules.
- [x] Assert that Admin HTML uses `<lira-help>` for representative queue font size, color fallback, song-board size, gift filtering, AI endpoint, and desktop-lyric controls.
- [x] Assert that status elements such as `xiaomiAiSaveState`, `giftStatusLine`, and `desktopLyricAutosaveState` remain outside `<lira-help>`.
- [x] Assert that dynamic overtime descriptions create a `lira-help` element through DOM APIs.
- [x] Run the focused tests and confirm they fail before the component exists.

### Task 2: Implement the reusable top-layer tooltip

**Files:**

- Create: `public/js/admin/contextual-help.js`
- Create: `public/css/components/contextual-help.css`
- Modify: `public/js/admin/index.js`
- Modify: `public/css/styles-admin.css`

**Interfaces:**

- Produces: `initializeContextualHelp(): void`.
- Produces: `<lira-help label="字段名">说明节点</lira-help>` with generated or preserved description IDs.

- [x] Define the custom element once, preserve authored child nodes inside a `role="tooltip"` manual popover, and generate a stable description ID when none exists.
- [x] Show the popover on pointer enter and focus, support click plus Enter/Space, hide on pointer leave, blur, Escape, and disconnection, and prevent label-click side effects.
- [x] Position the tooltip above or below the `?` and clamp it within a 12 px viewport inset.
- [x] Add visible hover/focus states, top-layer tooltip styling, a small arrow, reduced-motion handling, and a hidden-until-defined fallback.
- [x] Keep one shared trigger and tooltip appearance across all consumers; do not add page-specific variants.
- [x] Import the JavaScript and CSS through the existing Admin entry points.

### Task 3: Migrate Admin explanations

**Files:**

- Modify: `public/pages/admin/song/settings.html`
- Modify: `public/pages/admin/song/queue-theme.html`
- Modify: `public/pages/admin/song/song-board.html`
- Modify: `public/pages/admin/song/overlay-addresses.html`
- Modify: `public/pages/admin/song/desktop-lyric.html`
- Modify: `public/pages/admin/gifts/page.html`
- Modify: `public/pages/admin/toolbox/danmaku.html`
- Modify: `public/pages/admin/toolbox/gift.html`
- Modify: `public/pages/admin/toolbox/games.html`
- Modify: `public/pages/admin/toolbox/overtime.html`
- Modify: `public/js/admin/overtime-rule-editor.js`

**Interfaces:**

- Consumes: `<lira-help>` from Task 2.
- Preserves: all current control and status IDs.

- [x] Rewrite range, size, opacity, blur, glow, color fallback, title fallback, sorting, filtering, and low-power explanations in concise plain Chinese, then move them immediately after their labels inside `<lira-help>`.
- [x] Replace desktop-lyric field `<small>` explanations and the two isolated `i` tooltips with the shared `?` component; preserve option differentiators such as `整句显示` and all ARIA description references.
- [x] Move section-level feature explanations in danmaku, games, overtime, gift, and overlay-address cards into help next to the relevant heading.
- [x] Keep dynamic save/connection/error/result text, warnings, counts, onboarding, usage-guide prose, and destructive import notes visible.
- [x] Create overtime rule-editor help elements with `document.createElement('lira-help')` and `textContent`; do not interpolate HTML.
- [x] Run the focused tests and confirm all pass.

### Task 4: Document and verify the result

**Files:**

- Modify: `docs/architecture/frontend/pages.md`
- Update: `specs/plans/2026-08-23-contextual-help-tooltips.md`

**Interfaces:**

- Produces discoverable guidance for future Admin settings.

- [x] Document `<lira-help>` in the shared Admin component inventory and state that it is for optional explanation only, never status, validation, warning, or required instructions.
- [x] Run focused Admin/desktop-lyric/overtime tests, then `npm run check`, `npm run verify:docs`, and `npm run verify:quick`.
- [x] Launch the Electron renderer through CDP with Playwright; inspect pointer hover, top-layer clipping, viewport placement, and help icons inside labels across desktop-lyric, AI, and overtime views.
- [x] Review `git diff --check`, scoped `git diff`, and `git status --short`; preserve unrelated concurrent worktree changes.
- [x] Record verification results and mark this plan complete only after all Done When conditions pass.

## Verification

1. `node --test test/frontend-admin-ai.test.js test/frontend-song-board.test.js test/desktop-lyrics.test.js test/overtime-rule-editor.test.js test/admin-page-composition.test.js`
2. `npm run check`
3. `npm run verify:docs`
4. `npm run verify:quick`
5. Electron desktop functional and visual QA at the launched size and a smaller supported window.
6. `git diff --check`, scoped `git diff`, staged diff when applicable, and `git status --short`.

## Rollback Or Failure Handling

Stop at the first focused regression, inspect only task-owned hunks, and reverse those hunks with `apply_patch`. Do not use reset, blanket checkout, recursive deletion, or any operation that could discard the existing gift-frame artwork and test changes.

## Done When

- Optional Admin explanations are hidden behind a `?` next to their owning titles.
- Help copy is concise and clear, and every help trigger uses the same visual and interaction style.
- Help works with pointer, keyboard, and click without toggling the enclosing setting.
- Tooltips are not clipped by cards, details, or scroll panes and remain inside the desktop viewport.
- Status, validation, warnings, safety copy, empty states, onboarding, interactive-tour text, and usage documentation remain visible.
- Focused tests and applicable quick gates pass, the component is documented, and the final diff contains only task-related changes.

## Execution Record

- Status: complete; inline execution selected because the user requested the implementation in this task and no delegation was requested.
- Focused regression: 47 tests passed across contextual help, desktop lyrics, AI settings, and overtime rule editor.
- Quick gate: `npm run verify:quick` passed, including documentation, syntax, and architecture checks.
- Desktop QA: 133 help elements upgraded successfully; lyric, AI, and overtime tooltips rendered in the top layer with no page errors. The check caught and corrected Popover overflow scrollbars and label-line wrapping before completion.
- Diff review: `git diff --check` reported only existing line-ending warnings; no whitespace errors. Unrelated storage, gift-frame, clock, and overlay worktree changes were left intact.
