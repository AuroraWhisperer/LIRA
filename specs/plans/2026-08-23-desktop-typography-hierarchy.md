# Desktop Typography Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED REVIEW SKILLS: use `frontend-design` for the hierarchy review and `playwright-interactive` for final Electron visual QA. Execute one milestone at a time with task-scoped agents and review the diff between milestones.

**Goal:** Give every user-visible text element in the LIRA Electron Admin a clear role—page title, section title, card title, body, label, caption, status, or data—so users can understand the interface hierarchy at a glance without relying on color or position alone.

**Architecture:** Keep the existing native CSS modular monolith. Add typography tokens only to the shared design-token owner, apply actual rules inside the Admin and playback owners with scoped semantic roles, and migrate pages in reviewable batches. Preserve OBS/browser-source typography, user-configurable queue/lyric fonts, and third-party login pages as independent boundaries.

**Tech Stack:** Electron 43, Vanilla JavaScript ES modules, native CSS custom properties, `node:test`, Playwright-based Electron QA.

## Global Constraints

- Electron `/admin?desktop=1` is the visual source of truth; the default window is 1280×720 and the supported minimum is 1024×680.
- Preserve all HTTP, WebSocket, IPC, page, settings, storage, authentication, updater, and accessibility contracts.
- Do not add a framework, build step, runtime dependency, web font, bundled font, font download, IPC channel, settings key, or local-font permission.
- Keep the current multilingual system font fallback and preserve `--font` as a compatibility alias.
- `styles-base.css` may own tokens, but it must not add bare `h1/h2/h3/p/small/strong` rules because the file is also consumed by OBS pages.
- Do not mechanically rewrite all heading tags or all numeric font values. Visual role is determined by component context, not by tag name alone.
- Ordinary readable Admin copy must be at least 12px. An explicit 11px exception is allowed only for short eyebrow labels, compact status badges, table headers, or similarly bounded microcopy.
- Common Chinese UI copy uses only 400/500/600/700. Existing 800/900 display weights may remain only for intentional metrics, timers, artwork-like headings, or other allowlisted presentation surfaces.
- Preserve user-configurable queue fonts and `--preview-font`, `--preview-size`, `--preview-weight`, `--preview-line-height`, and `--preview-letter-spacing` behavior.
- Preserve current IDs, event hooks, fragment order, focus behavior, ARIA relationships, and safe text-rendering paths.
- Treat the current dirty worktree as user-owned. Review and patch individual hunks; do not format whole files, restore whole files, or overwrite unrelated changes.
- Do not create commits unless the user explicitly requests them.

---

## Goal

Create a consistent desktop typography hierarchy across the top bar, point-song workspace, playback workspace, gift workspace, toolbox pages, dialogs, drawers, toasts, empty states, loading states, and shutdown/update surfaces. The result should feel like a compact Chinese livestream control desk: dense enough for 1024×680, but with obvious reading order and stable Chinese/English/numeric alignment.

## Non-goals

- No layout, color-palette, icon, copywriting, interaction, navigation, or information-architecture redesign beyond spacing/wrapping needed to fit the new text metrics.
- No typography normalization of OBS/browser-source pages under `public/pages/overlays/` or their theme/user-configurable variables.
- No control over QQ Music, NetEase, WeSing, or Bilibili third-party login page typography.
- No redesign of the developer-only `gift-audit.html` and `debug-gifts.html` pages.
- No replacement of responsive lyric, fullscreen-player, timer, chart, table-metric, or preview typography with ordinary Admin body sizes.
- No promise that every hard-coded numeric value disappears; specialized presentation values remain component-owned and documented by an allowlist.

## Current Behavior

The shared/common/Admin/playback styles contain 513 `font-size` declarations with 51 distinct values, 257 `font-weight` declarations with 14 values, 166 `line-height` declarations with 18 values, and 71 `letter-spacing` declarations with 33 values. The late Electron-only `public/css/overlays/desktop.css` adds another 13 size, 7 weight, 6 line-height, and 1 tracking declarations, bringing the actual desktop cascade to 526 size and 264 weight declarations. In the core 513 declarations, 492 sizes are literal pixel values, 140 are below 12px, and 344 cluster between 11px and 16px.

The shared design system defines one `--font` stack but no semantic size, weight, line-height, or tracking tokens. The Admin body therefore mixes browser-default text with local component overrides. Examples of nominally similar headings include 16px queue/gift titles, a 17px shared panel title, an 18px playback discovery title, a 23px toolbox header, and toolbox feature titles from 26px to 30px.

The composed Admin HTML currently contains no `h1`, 24 `h2`, 52 `h3`, and 8 `h4`. The same tag represents different visual jobs: `h2` can be a tool-page title, panel title, or fullscreen song title; `h3` can be a section title, card title, queue group label, or dynamic content. The top-level navigation is 13px/700 while the secondary `.tab` inherits the unscoped body size, so lower-level navigation can appear larger than the primary navigation.

There are also typography declarations outside the CSS system:

- `public/pages/admin/song/settings.html` contains inline font sizes on Bilibili status and login controls.
- `public/js/playback/ui/components.js` emits an inline `14px/700` playlist title.

The CSS load order is `styles-base.css` → `styles-admin.css` → `styles-playback.css` → `overlays/desktop.css` → `interactive-tour.css`. Token-presence tests alone cannot prove the final cascade, so representative final selectors and real Electron states must also be verified.

## Design Direction And Type Contract

LIRA is a desktop livestream operations console for Chinese streamers. The typography should be calm, compact, and operational rather than decorative: headings establish location, body text explains actions, labels identify controls, captions recede, and metrics remain quickly scannable.

### Font families

| Token | Target value | Use |
|---|---|---|
| `--font-ui` | `var(--font)` | Body, controls, labels, captions, Chinese-first interface copy |
| `--font-display` | `"Segoe UI Variable Display", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif` | Page/section headings; Chinese falls back to the existing stable UI fonts |
| `--font-mono` | `"Cascadia Mono", Consolas, monospace` | Paths, URLs, time offsets, diagnostics, and technical values only |

Do not use Bahnschrift, Georgia, Consolas, or theme-selected fonts for generic Chinese headings. Keep those faces in their current timer, decorative, technical, or user-configurable roles.

### Semantic scale

| Role | Size | Weight | Line height | Tracking | Color/behavior |
|---|---:|---:|---:|---:|---|
| Display/hero | 28px | 700 | 1.15 | -0.01em | Rare onboarding/empty-state use only |
| Page title | 24px | 700 | 1.30 | -0.01em | Primary text, `--font-display` |
| Section title | 18px | 700 | 1.40 | -0.01em | Primary text, shared panels and major sections |
| Card/subsection title | 15px | 600 | 1.45 | 0 | Primary text |
| Body/control value | 14px | 400 | 1.55 | 0 | Primary text |
| Form/control label | 13px | 600 | 1.45 | 0 | Primary or secondary text according to context |
| Caption/helper/meta | 12px | 400 | 1.50 | 0 | Secondary/muted text |
| Eyebrow/table header/micro status | 11px | 700 | 1.45 | 0.06em | Short bounded text only; no paragraph copy |
| Key metric | 20/28/36px | 700 | 1.10–1.20 | 0 | Component-owned size plus `tabular-nums` |

The shared token names and values are fixed for this plan:

```css
--font-ui: var(--font);
--font-display: "Segoe UI Variable Display", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif;
--font-mono: "Cascadia Mono", Consolas, monospace;

--type-size-display: 28px;
--type-size-page-title: 24px;
--type-size-section-title: 18px;
--type-size-card-title: 15px;
--type-size-body: 14px;
--type-size-control: 13px;
--type-size-caption: 12px;
--type-size-micro: 11px;
--type-size-metric-sm: 20px;
--type-size-metric-md: 28px;
--type-size-metric-lg: 36px;

--type-weight-regular: 400;
--type-weight-medium: 500;
--type-weight-semibold: 600;
--type-weight-bold: 700;

--type-leading-display: 1.15;
--type-leading-page-title: 1.3;
--type-leading-section-title: 1.4;
--type-leading-card-title: 1.45;
--type-leading-body: 1.55;
--type-leading-control: 1.45;
--type-leading-caption: 1.5;
--type-leading-micro: 1.45;

--type-tracking-tight: -0.01em;
--type-tracking-normal: 0;
--type-tracking-eyebrow: 0.06em;
```

The scoped Admin role-class interface is also fixed:

| Class | Role |
|---|---|
| `.ui-display` | Rare display/hero text |
| `.ui-page-title` | Current content view title |
| `.ui-page-subtitle` | Direct supporting copy for the page title |
| `.ui-section-title` | Major section/panel title |
| `.ui-section-description` | Direct supporting copy for a section title |
| `.ui-card-title` | Card, field group, or subsection title |
| `.ui-body` | Normal explanatory content |
| `.ui-control-label` | Form and action labels |
| `.ui-caption` | Helper, metadata, and secondary status text |
| `.ui-eyebrow` | Short category/table/Latin eyebrow label |
| `.ui-metric` | Key data value; local modifier selects 20/28/36px |

### Role rules

- A page title, section title, card title, body paragraph, and caption must remain distinguishable in grayscale.
- A larger number alone does not become a heading; metrics keep their data role and receive a separate label.
- Descriptions use normal weight and secondary color. Do not bold whole paragraphs to create hierarchy.
- Chinese titles do not use aggressive negative tracking. Keep common title tracking at `-0.01em`; reserve wider tracking for short Latin eyebrows.
- Buttons and form labels are not headings. They use the control-label role even when the action is important.
- Heading level remains semantic for accessibility; visual role is attached through a component boundary or explicit role class.

## Ownership

- Shared typography tokens: `public/css/styles-base.css`.
- Admin shell and common semantic role rules: `public/css/admin/layout.css`, loaded by `public/css/styles-admin.css`.
- Point-song and gift workspaces: `public/css/admin/workspace/`, `public/css/admin/gifts/`, and their Admin fragments.
- Playback typography: `public/css/playback/`, `public/pages/admin/playback/`, and dynamic templates under `public/js/playback/`.
- Toolbox typography: `public/css/admin/other-features/`, `public/css/admin/overtime.css`, related legacy-owned styles under `public/css/admin/toasts/`, and `public/pages/admin/toolbox/`.
- Electron-only late overrides: `public/css/overlays/desktop.css`; despite its path, it styles `/admin?desktop=1` and must be included in the desktop cascade review.
- Contracts: `docs/architecture/frontend/pages.md`, `docs/architecture/frontend/app.md`, and `docs/architecture/desktop/main.md`.
- Route owners: `ROUTE-ADMIN` and `ROUTE-PLAYBACK`. `ROUTE-OVERLAYS` remains an explicit compatibility boundary.
- Focused tests: `test/admin-page-composition.test.js`, `test/frontend-admin-shell.test.js`, `test/frontend-playback.test.js`, `test/frontend-gifts.test.js`, `test/toolbox-sidebar.test.js`, `test/ui-surface.test.js`, and `test/desktop-lyrics.test.js`.

## Compatibility Constraints

- `--font` remains available to all existing consumers.
- Shared tokens may be visible to overlays, but no shared element rule may change overlay computed typography.
- Admin headings may gain classes and missing page headings may be added using existing navigation names, but IDs, tab mappings, panel IDs, and event hooks stay unchanged.
- Any new page header must fit the fixed desktop shell without hiding primary controls at 1280×720 or 1024×680.
- Playback and desktop lyric CSS are shared with `/lyrics`; every change in those files requires the lyric-window regression tests and a browser-source visual check.
- Existing local font discovery remains limited to configurable presentation surfaces and must not become a dependency of the Admin chrome.
- Existing accessible dialogs, `aria-labelledby`, `aria-describedby`, focus traps, keyboard navigation, and heading order must remain valid.

## Proposed File Map

### Create

- `test/frontend-typography.test.js`: deterministic token, role mapping, inline-style, minimum readable size, allowed-weight, and overlay-isolation checks.

### Shared files to modify

- `public/css/styles-base.css`: add the font family, size, weight, line-height, and tracking tokens; keep element styling unchanged except compatibility aliases.
- `public/css/admin/layout.css`: give `.app-shell` an explicit base typography and define scoped semantic role classes; map top bar, status, common panel header/body, and shared heading/description pairs.
- `public/css/admin/workspace/base.css`: normalize primary navigation, theme legends, and shared workspace labels.
- `public/css/admin/tabs.css`: normalize secondary navigation and shared `.hint` behavior.
- `public/css/components/confirmation-dialog.css`: map title/context/body/details/actions to the semantic scale.
- `public/css/admin/modals.css`: map legacy confirmation/logout surfaces to the same roles without changing behavior.
- `public/css/admin/responsive.css`: make only wrapping/min-height adjustments proven necessary by the new text metrics.

### Point-song and gift files to modify

- `public/pages/admin/song/shell-start.html`
- `public/pages/admin/song/library.html`
- `public/pages/admin/song/settings.html`
- `public/pages/admin/song/queue-theme.html`
- `public/pages/admin/song/song-board.html`
- `public/pages/admin/song/overlay-addresses.html`
- `public/pages/admin/song/import-export.html`
- `public/pages/admin/song/desktop-lyric.html`
- `public/css/admin/workspace/song.css`
- `public/css/admin/collapsible.css`
- `public/css/admin/song-filters.css`
- `public/pages/admin/gifts/page.html`
- `public/pages/admin/gifts/blindbox-analysis.html`
- `public/pages/admin/gifts/history.html`
- `public/css/admin/workspace/gifts.css`
- `public/css/admin/workspace/notifications.css`
- `public/css/admin/blindbox-analysis.css`
- `public/css/admin/gifts/detection.css`
- `public/css/admin/gifts/recent.css`
- `public/css/admin/gifts/blindbox-stats.css`
- `public/css/admin/gifts/blindbox-mapping.css`
- `public/css/admin/gifts/blindbox-broadcast.css`

### Playback files to modify

- `public/pages/admin/playback/page.html`
- `public/pages/admin/playback/drawer.html`
- `public/pages/admin/playback/queue-popup.html`
- `public/pages/admin/playback/fullscreen.html`
- `public/css/playback/header.css`
- `public/css/playback/panels/discovery.css`
- `public/css/playback/panels/search.css`
- `public/css/playback/panels/match.css`
- `public/css/playback/panels/queue.css`
- `public/css/playback/panels/user-and-health.css`
- `public/css/playback/panels/wesing.css`
- `public/css/playback/song-row.css`
- `public/css/playback/player.css`
- `public/css/playback/drawer.css`
- `public/css/playback/queue-modal.css`
- `public/css/playback/dialogs.css`
- `public/css/playback/fullscreen.css`
- `public/css/playback/responsive.css`
- `public/js/playback/ui/components.js`
- `public/js/playback/ui/queue-popup.js`
- `public/js/playback/operations/playlist-operations.js`

### Toolbox and transient-surface files to modify

- `public/pages/admin/toolbox/shell-start.html`
- `public/pages/admin/toolbox/shell-end.html`
- `public/pages/admin/toolbox/onboarding.html`
- `public/pages/admin/toolbox/danmaku.html`
- `public/pages/admin/toolbox/gift.html`
- `public/pages/admin/toolbox/games.html`
- `public/pages/admin/toolbox/overtime.html`
- `public/pages/admin/toolbox/gift-effects.html`
- `public/pages/admin/toolbox/planner.html`
- `public/pages/admin/toolbox/start-animation.html`
- `public/pages/admin/toolbox/clock.html`
- `public/pages/admin/toolbox/performance.html`
- `public/pages/admin/toolbox/usage-guide.html`
- `public/pages/admin/toolbox/desktop-update.html`
- `public/css/admin/other-features/shell.css`
- `public/css/admin/other-features/danmaku-tool.css`
- `public/css/admin/other-features/ai-assistant.css`
- `public/css/admin/other-features/danmaku-editors.css`
- `public/css/admin/other-features/gift-effects.css`
- `public/css/admin/other-features/onboarding.css`
- `public/css/admin/other-features/streamer-planner.css`
- `public/css/admin/other-features/games.css`
- `public/css/admin/other-features/start-animation.css`
- `public/css/admin/other-features/clock.css`
- `public/css/admin/other-features/usage-guide.css`
- `public/css/admin/other-features/interactive-tour.css`
- `public/css/admin/overtime.css`
- `public/css/admin/toasts/system.css`
- `public/css/admin/toasts/gifts.css`
- `public/css/overlays/desktop.css`
- `public/js/admin/settings.js`: add the semantic role classes to the runtime shutdown screen without changing its copy or behavior.

### Documentation to modify

- `docs/architecture/frontend/pages.md`: document the Admin typography role owner, token scale, and OBS/user-configurable-font exclusions.
- `docs/architecture/engineering/test.md`: register `test/frontend-typography.test.js` in the frontend test inventory.

Every listed file is reviewed. Change only its user-visible generic text-role declarations or markup; if an existing shared selector already supplies the complete role, record that result in the plan and leave the file unchanged. Specialized declarations remain component-owned.

---

## Milestones

### Task 1: Lock the typography contract with a failing test

**Files:**

- Create: `test/frontend-typography.test.js`
- Read: `test/helpers/css-bundle.js`
- Read: `test/helpers/admin-html.js`

**Interfaces:**

- Consumes: the composed Admin HTML and recursively expanded CSS bundles.
- Produces: a deterministic contract for semantic tokens, scoped role mappings, inline-style removal, minimum readable sizes, standard weights, and preserved overlay boundaries.

- [x] Add a test that reads `styles-base.css` and asserts the exact family, size, weight, leading, and tracking tokens listed in this plan.
- [x] Add monotonic assertions: page > section > card > body > label > caption > micro, with body exactly 14px and caption exactly 12px.
- [x] Add a test that reads the Admin CSS bundle and requires scoped consumers for page title, page subtitle, section title, section description, card title, body, label, caption, eyebrow, and metric roles.
- [x] Add a test that verifies no bare shared `h1/h2/h3/h4/p/small/strong` typography rule is introduced into `styles-base.css`.
- [x] Scan composed Admin HTML and runtime template sources for inline `font-size`, `font-weight`, `font-family`, `line-height`, or `letter-spacing`; fail on the current declarations in `song/settings.html` and `playback/ui/components.js`.
- [x] Implement an explicit allowlist for 11px microcopy and `<12px` presentation exceptions. Require all normal descriptions, paragraphs, form help, and error text to be at least 12px.
- [x] Implement an explicit allowlist for 800/900 presentation weights and dynamic font variables. Reject new 650/750/850 common UI declarations.
- [x] Add representative cascade assertions for common panel titles, point-song subpages, playback queue groups, gift headings, toolbox page headers, confirmation dialogs, and captions.
- [x] Run `node --experimental-vm-modules --test test/frontend-typography.test.js` and confirm it fails for missing tokens, unmapped roles, and the two known inline typography sites.

### Task 2: Add tokens and the scoped Admin foundation

**Files:**

- Modify: `public/css/styles-base.css`
- Modify: `public/css/admin/layout.css`
- Modify: `public/css/admin/workspace/base.css`
- Modify: `public/css/admin/tabs.css`
- Modify: `test/frontend-typography.test.js`

**Interfaces:**

- Consumes: existing `--font`, color tokens, `.app-shell`, `.panel`, `.panel-header`, `.tabs`, `.tab`, `.pill`, and `.hint` contracts.
- Produces: the semantic token scale and Admin-scoped role mappings used by later page batches.

- [x] Add the exact token values from “Design Direction And Type Contract” to `:root`, with `--font-ui: var(--font)` and no new element selectors.
- [x] Set `.app-shell` to the body role: `var(--font-ui)`, 14px, 400, line-height 1.55, and normal tracking.
- [x] Define the exact `.ui-display`, `.ui-page-title`, `.ui-page-subtitle`, `.ui-section-title`, `.ui-section-description`, `.ui-card-title`, `.ui-body`, `.ui-control-label`, `.ui-caption`, `.ui-eyebrow`, and `.ui-metric` classes in `admin/layout.css`, all scoped under `.app-shell` or the specific top-level transient-surface owner.
- [x] Map `.panel-header h2` to section-title tokens and `.panel-body` prose to body/caption roles without styling arbitrary nested data values.
- [x] Map primary navigation to control-label typography and secondary tabs to the same or lower scale; verify secondary navigation never appears larger than primary navigation.
- [x] Map `label`, `legend`, `.hint`, `.pill`, table headers, and buttons by function. A group `legend` uses card-title or label role according to its structural level, not a blanket element rule.
- [x] Replace generic common negative tracking and non-standard 650/750/850 weights with the semantic values where they describe ordinary UI copy.
- [x] Re-run `test/frontend-typography.test.js`; confirm the token/foundation tests pass while page-migration assertions remain intentionally failing.
- [x] Run `npm.cmd run test:admin` and confirm existing shell/composition behavior still passes.

### Task 3: Migrate point-song and gift workspaces

**Files:**

- Modify: the point-song and gift files listed in “Proposed File Map”.
- Modify: `test/frontend-typography.test.js`
- Modify: `test/frontend-admin-shell.test.js`
- Modify: `test/frontend-gifts.test.js`

**Interfaces:**

- Consumes: the Task 2 role classes/tokens and existing tab/panel composition.
- Produces: consistent content anchors and text hierarchy for the point-song and gift main pages.

- [x] Add one compact visible page-heading role to each point-song subview that currently begins directly with fields. Reuse existing navigation names (`歌库`, `设置`, `点歌板`, `展示板`, `直播画面`, `导入导出`, `桌面歌词`) and do not invent marketing copy.
- [x] Add or map a gift-workspace page heading, then classify the seven existing gift panels as sections/cards beneath it.
- [x] Preserve the two queue panels’ equal header height and existing controls while changing only title, eyebrow, status, song, requester, and empty-state text roles.
- [x] Fix the gift heading selector drift where HTML uses `h2` but component CSS still targets `h3`; bind the class/container role instead of the tag name.
- [x] Map form labels, fieldset legends, URLs, helper text, empty states, song metadata, gift metadata, blind-box labels, and metric values to their correct roles.
- [x] Remove inline typography from `song/settings.html`; keep the existing Bilibili colors, button types, IDs, and visibility behavior in scoped CSS classes.
- [x] Raise all non-allowlisted 8–11px readable copy in these views to caption or label size. Keep only bounded status/eyebrow/table-header exceptions at 11px.
- [x] Keep queue-theme and desktop-lyric user-selected fonts/sizes out of the Admin chrome contract; normalize only the surrounding configuration labels and descriptions.
- [x] Run `node --experimental-vm-modules --test test/frontend-typography.test.js test/frontend-admin-shell.test.js test/frontend-gifts.test.js test/admin-page-composition.test.js` and confirm the batch passes.
- [x] Use Electron at 1280×720 and 1024×680 to inspect all seven point-song subviews plus empty/dense gift states before continuing.

### Task 4: Migrate playback, drawers, queue popups, and fullscreen chrome

**Files:**

- Modify: the playback files listed in “Proposed File Map”.
- Modify: `test/frontend-typography.test.js`
- Modify: `test/frontend-playback.test.js`
- Modify: `test/desktop-lyrics.test.js`

**Interfaces:**

- Consumes: the shared semantic scale and current playback DOM/classes.
- Produces: a consistent playback page, card, song, metadata, queue-group, drawer, dialog, and fullscreen-control hierarchy.

- [x] Give the playback workspace a clear content anchor without crowding the source tabs and account controls at 1024px width; reuse `播放`/`播放助手` copy already present in navigation/product language.
- [x] Map discovery/search/match/WeSing panel headings to section roles; map result-card names to card titles and artist/source/reason text to captions.
- [x] Correct the reverse hierarchy in queue popups: popup title > queue group title > song title > song metadata. Do not let a group heading remain smaller than its song rows.
- [x] Remove the inline playlist title typography emitted by `playback/ui/components.js` and replace it with a stable class consumed by playback CSS.
- [x] Apply the same role names to dynamic playlist picker, drawer loading/error/empty states, queue empty states, and pending request groups.
- [x] Normalize playback buttons, source tabs, status pills, quality menus, and technical values without changing click targets or menu accessibility.
- [x] Preserve fullscreen song/artist/lyric responsive sizes, playback progress metrics, and `desktop-lyric` custom variables. Normalize only surrounding chrome, labels, and help text.
- [x] Run `node --experimental-vm-modules --test test/frontend-typography.test.js test/frontend-playback.test.js test/playback-layering.test.js test/desktop-lyrics.test.js` and confirm all pass.
- [x] Inspect QQ/NetEase/WeSing, logged-out/error states, long mixed-language song names, drawer depth, queue popup, playlist picker, and fullscreen in Electron.

### Task 5: Give every toolbox feature a common page hierarchy

**Files:**

- Modify: the toolbox HTML and CSS files listed in “Proposed File Map”.
- Modify: `test/frontend-typography.test.js`
- Modify: `test/toolbox-sidebar.test.js`
- Modify: `test/frontend-admin-ai.test.js`

**Interfaces:**

- Consumes: the Task 2 semantic scale, the existing toolbox sidebar, and each feature’s component-owned visual styling.
- Produces: one common page-heading structure plus consistent section/card/body/caption roles across all toolbox modules.

- [x] Introduce one shared toolbox page-header structure and apply it to onboarding, danmaku, gift, games, overtime, gift effects, planner, start animation, clock, performance, usage guide, and desktop update. Reuse existing page titles and descriptions.
- [x] Map feature-level `h2`, major section `h3`, card/subsection `h4` or `strong`, body copy, labels, captions, eyebrows, and metrics to the semantic roles. Do not infer visual role from the tag alone.
- [x] Bring currently missing page anchors (`弹幕姬`, `主播工作台`, `性能检测`, `桌面更新`) into the common header contract.
- [x] Retain the individual visual identity of games, overtime, clock, onboarding, and the usage guide through their existing surfaces/icons, but remove their independent base title scales.
- [x] Raise the streamer planner’s 8–10px readable labels and descriptions to the label/caption minimum; reflow grids instead of shrinking text to preserve fit.
- [x] Normalize AI advanced settings, danmaku editors, overtime rule cards, game configuration cards, hardware cards, update cards, and guide sections independently so dense states remain readable.
- [x] Preserve mono fonts for host/path/diagnostic values, tabular numbers for metrics/timers, and short Latin eyebrows at the 11px exception.
- [x] Verify sidebar expanded/collapsed states still fit and the page heading remains visible in both states.
- [x] Run `node --experimental-vm-modules --test test/frontend-typography.test.js test/toolbox-sidebar.test.js test/frontend-admin-ai.test.js test/overtime-rule-editor.test.js test/frontend-games.test.js` and confirm all pass.
- [x] Inspect every toolbox feature at 1280×720 and 1024×680; for AI, overtime, games, planner, performance, and usage guide also inspect the densest reachable state.

### Task 6: Normalize transient UI and preserve special typography

**Files:**

- Modify: `public/css/components/confirmation-dialog.css`
- Modify: `public/css/admin/modals.css`
- Modify: `public/css/admin/toasts/system.css`
- Modify: `public/css/admin/toasts/gifts.css`
- Modify: `public/css/admin/other-features/interactive-tour.css`
- Modify: `public/css/overlays/desktop.css`
- Modify: `public/js/admin/settings.js`
- Modify: `test/frontend-typography.test.js`
- Modify: `test/ui-surface.test.js`

**Interfaces:**

- Consumes: shared role tokens and existing accessible modal/toast/tour/shutdown behavior.
- Produces: consistent transient hierarchy without changing timing, focus, actions, or Electron-specific behavior.

- [x] Map dialog title, optional context, description, detail list, warning/keep text, and action labels to page/card/body/caption/control roles.
- [x] Map toast title/body/action, interactive-tour title/body/note, desktop update state, and shutdown title/subtitle/hint to the same hierarchy.
- [x] Keep semantic warning/success colors and accessible focus states; typography must not become the only status indicator.
- [x] Preserve hardware metric, timer, and status-number sizes in legacy-owned `toasts/gifts.css`; change only generic labels/descriptions/headings.
- [x] Review the final source order so `overlays/desktop.css` and `interactive-tour.css` do not reintroduce non-standard common weights or undersized body text.
- [x] Run `node --experimental-vm-modules --test test/frontend-typography.test.js test/ui-surface.test.js test/frontend-admin-shell.test.js test/update-manager.test.js`.
- [x] In Electron, inspect normal/caution/destructive confirmations, gift and system toasts, all tour tooltip positions, tour-exit confirmation, update states, and shutdown/restart screen with short and long copy.

### Task 7: Prove OBS, lyric, font-permission, and responsive isolation

**Files:**

- Modify only task-owned fixes revealed by the isolation checks.
- Modify: `test/frontend-typography.test.js` if the exception list needs an evidence-backed correction.

**Interfaces:**

- Consumes: the completed desktop typography cascade.
- Produces: evidence that desktop hierarchy improvements do not leak into output surfaces or privileged font behavior.

- [x] Verify `styles-base.css` contains tokens only and no bare element typography capable of changing OBS pages.
- [x] Verify `/lyrics` computed preview/timeline typography still follows user settings and that Admin-only labels use the new roles only inside the desktop renderer.
- [x] Verify point-song overlay theme variables and `overlayFontFamily`/title-size settings are unchanged.
- [x] Verify Admin core UI never calls or depends on `queryLocalFonts()` and no permission, IPC, or settings contract changed.
- [x] Run `node --experimental-vm-modules --test test/desktop-lyrics.test.js test/local-font-library.test.js test/queue-overlay-esm.test.js test/queue-overlay-responsive.test.js test/frontend-song-board.test.js test/overtime-overlay.test.js test/danmaku-overlay.test.js test/games-overlay.test.js test/clock-overlay.test.js test/gift-effects-overlay.test.js`.
- [x] Inspect representative `/queue`, `/songlist`, `/lyrics`, `/overtime`, `/danmaku`, `/games`, `/clock`, and `/gift-effects` browser-source views at their documented capture sizes; confirm no text, measurement, scrolling, transparency, or theme change.

### Task 8: Electron visual QA, documentation, and final gates

**Files:**

- Modify: `docs/architecture/frontend/pages.md`
- Modify: `docs/architecture/engineering/test.md`
- Update: this plan’s progress and verification sections as work completes.
- Temporary screenshots: ignored `tmp/` only; do not commit them.

**Interfaces:**

- Consumes: all completed typography batches.
- Produces: reviewable documentation and final functional/visual evidence.

- [x] Document the semantic scale, the Admin owner, the minimum readable-copy rule, and the OBS/user-configurable-font exclusions in `frontend/pages.md`.
- [x] Register the new focused test in `engineering/test.md`.
- [x] Launch the native Electron client and inspect the as-launched 1280×720 layout before resizing.
- [x] Repeat the full shell pass at the 1024×680 supported minimum and in a maximized window.
- [ ] Check Windows 100% and 125% display scaling; add 150% as an exploratory pass. Do not simulate correctness by changing Electron zoom factors.
- [x] Exercise the QA matrix below with real mouse and keyboard input; capture screenshots for each main workspace, each dense/high-risk state, and each transient surface.
- [x] Confirm every intended hierarchy remains legible in grayscale and that font fallback works for Chinese, English platform names, numbers, emoji, paths, and long error text.
- [x] Confirm no required controls or text are clipped, overlapped, truncated without an intentional ellipsis, hidden by the player dock, or pushed out of the initial fixed-shell viewport.
- [x] Run focused tests, `npm.cmd run verify:docs`, `npm.cmd run check`, `npm.cmd run verify:architecture`, `npm.cmd run verify:quick`, `npm.cmd test`, and `npm.cmd run verify`.
- [x] Review `git diff`, `git diff --check`, `git status --short`, and `git diff --cached` if staged content exists. Confirm every changed line traces to this typography task and no unrelated dirty-worktree content was altered.

## Electron Visual QA Matrix

| Surface | Required states | Typography evidence |
|---|---|---|
| Top bar/navigation/status | connected/disconnected, long host/room text, active main tabs | Primary nav is stronger than secondary/status text; no collision with window controls |
| Point song | seven subviews, empty/dense queues, long song/requester, SC, pinned item, dock collapsed/expanded | Page/section/card/song/meta/help roles are distinct; row heights do not crop text |
| Playback | QQ/NetEase/WeSing, logged out/in/error, discovery/search/match, drawer, queue popup, picker, fullscreen | Workspace/section/group/song/meta roles are ordered; lyric/presentation sizes remain intact |
| Gifts | loading/empty/dense, long names, large amounts, blind-box analysis/history, toast | Page/section/card/metric/label roles are distinct; data never masquerades as a heading |
| Toolbox | sidebar expanded/collapsed; every feature default state | Every feature starts with the same page hierarchy while retaining local visual identity |
| Toolbox dense states | AI advanced, multiple overtime rules, expanded games, many planner tasks, completed performance scan, long guide | 12px body floor holds; grids reflow instead of shrinking readable text |
| Dialogs/drawers/toasts | normal/caution/destructive, long text, loading/error/empty | Title > description > details > actions remains consistent; focus behavior unchanged |
| Onboarding/tour/update/shutdown | every onboarding step, four tooltip directions, exit confirm, all update states, exited screen | Hero/page/card/body/caption roles remain obvious and fit the supported window |
| Desktop lyric settings | default/custom local font, long lyric, translation/romanization | Admin controls follow the new hierarchy; preview and `/lyrics` remain user-configurable |
| OBS boundary | representative queue/song/lyric/overtime/danmaku/game/clock/gift views | No computed typography, wrapping, scrolling, or capture-size regression |

## Verification

### Execution record (2026-08-24)

- Focused typography, Admin shell, playback, toolbox, transient-surface, and overlay-isolation suites passed.
- The native Electron client was inspected at its as-launched 1280×722 viewport and maximized 1707×912 viewport on the available Windows 150% display scale; the 1024×682 layout pass also completed without changing Electron zoom factors.
- A grayscale Electron pass confirmed the 24/18/15/14/13/12/11px semantic roles and the multilingual fallback stack with Chinese, English, numbers, emoji, a Windows path, and long error copy.
- `/queue`, `/songlist`, `/lyrics`, `/overtime`, `/danmaku`, `/games`, `/clock`, and `/gift-effects` returned 200 at their representative capture sizes with no page errors or horizontal overflow; user-configurable lyric and overlay typography remained isolated.
- `verify:docs`, syntax, architecture, quick, full test, and aggregate `verify` gates passed; the full suite reported 878 passing tests and zero failures.
- Concurrent non-typography worktree changes, including the danmaku style-four work and local Codex configuration, were left intact and remain outside this task's reviewed hunks; no changes are staged.
- Windows 100% and 125% display-scale checks remain open because the current host exposes only a real 150% scale. They were not simulated with page or Electron zoom.

### Focused commands

```powershell
node --experimental-vm-modules --test test/frontend-typography.test.js
npm.cmd run test:admin
node --experimental-vm-modules --test test/ui-surface.test.js test/frontend-playback.test.js test/frontend-gifts.test.js test/toolbox-sidebar.test.js test/desktop-lyrics.test.js
```

Expected result: all tests pass; the new typography test proves the token/role contract and explicitly documents the small-size, heavy-weight, preview, metric, and overlay exceptions.

### Layered gates

```powershell
npm.cmd run verify:docs
npm.cmd run check
npm.cmd run verify:architecture
npm.cmd run verify:quick
npm.cmd test
npm.cmd run verify
```

Expected result: every command exits successfully. If the full suite exposes unrelated failures from the pre-existing dirty worktree, record the exact test, failure, and unchanged external hunk; do not hide or overwrite it.

### Diff review

```powershell
git diff --check
git status --short
git diff -- public/css/styles-base.css public/css/admin public/css/playback public/css/components public/css/overlays/desktop.css public/pages/admin public/js/admin/settings.js public/js/playback test/frontend-typography.test.js docs/architecture/frontend/pages.md docs/architecture/engineering/test.md specs/plans/2026-08-23-desktop-typography-hierarchy.md
```

Expected result: no whitespace errors, generated assets, screenshots, data, logs, or unrelated files enter the task diff.

## Rollback Or Failure Handling

- Stop at the failing milestone; do not continue page migration while a shared role or viewport regression remains unresolved.
- Inspect and revert only task-owned hunks with `git diff -- <exact-file>`. Do not use `git reset --hard`, blanket checkout, whole-file restore, or broad deletion.
- If a larger font causes clipping, first correct wrapping, local grid sizing, or minimum height in the owning component. Do not globally shrink body/caption tokens or change Electron zoom to mask a local layout defect.
- If a token leaks into OBS, remove the unscoped consumer rule and move it to the Admin/playback owner; do not fork the shared font stack or change persisted overlay settings.
- If the selected display font falls back inconsistently, retain the current multilingual system stack and distinguish hierarchy through size, weight, line height, and spacing rather than adding a font dependency.
- If current user changes overlap a target selector, preserve the user hunk and reapply only the minimum typography declarations around it. Record the deviation in this plan.

## Done When

- Every Electron Admin view has a visible and consistent page/content anchor, and every visible text element maps to a documented semantic role or explicit presentation exception.
- Page title, section title, card title, body, label, and caption are distinguishable without relying on color.
- Ordinary body/help/error copy is at least 12px; the 11px exception is short, intentional, and allowlisted; ordinary readable copy no longer uses 8–10px.
- Common UI copy uses stable 400/500/600/700 weights; non-standard common 650/750/850 declarations and inline typography are removed.
- Chinese, English, numbers, emoji, URLs, and paths render with intentional fallback and alignment.
- The 1280×720 default, 1024×680 minimum, maximized window, and required DPI passes show no unintended clipping, overlap, or player-dock obstruction.
- OBS/browser-source typography, user-configurable queue/lyric fonts, and local-font permissions remain unchanged.
- Focused tests, documentation verification, syntax, architecture, quick, and full gates pass or any unrelated pre-existing failure is precisely documented.
- Final diff/status review confirms that no unrelated dirty-worktree changes were altered.
- This plan records final verification and is moved to `specs/plans/archive/` only after all completion conditions pass.
