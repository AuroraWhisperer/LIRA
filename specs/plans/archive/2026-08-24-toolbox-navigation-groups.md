# Toolbox Navigation Groups Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the existing 百宝箱 sidebar into four clearly labeled workflow groups without adding a fifth top-level page or changing any feature panel contract.

**Architecture:** Keep `otherAssistantPage`, every `data-other-feature` value, every tab/panel ID, localStorage selection, and sidebar-collapse behavior unchanged. Reorder only the existing navigation buttons, add presentational group labels inside the current vertical tab list, and style those labels with the existing desktop design tokens.

**Tech Stack:** Electron 43 renderer, composed HTML fragments, native CSS, Vanilla JavaScript, `node:test`.

## Global Constraints

- Electron desktop at 1280×720 is the primary target; 1024×680 remains the minimum supported window.
- Do not add a top-level navigation item, runtime dependency, build step, settings key, page URL, or JavaScript state.
- Preserve all existing feature IDs, `role="tab"` / `role="tabpanel"` mappings, arrow-key navigation, selected-feature storage, and sidebar-collapse storage.
- Preserve unrelated dirty-worktree changes in the target CSS, test, usage guide, and architecture files.
- Do not create a commit unless the user explicitly requests one.

## Design Direction

- **Color:** reuse desktop `surface` (#fffcf8), `surface-2` (#f5eee4), `border` (#e7d9c7), `text` (#241a16), `muted` (#75665b), and the existing active `primary` (#d92d20); introduce no new color.
- **Type:** reuse the existing UI face and semantic micro/caption/control tokens; group names use the micro bold role and explanations use the micro regular role.
- **Layout:** retain the 250px sidebar and 76px collapsed rail. Expanded mode shows one-line group labels; collapsed mode hides their text but keeps separators; narrow layouts place each group label across the full navigation grid.
- **Signature:** the sidebar reads like a compact live-control route map instead of an undifferentiated toolbox list.

```text
百宝箱
├─ 直播互动  和观众实时发生
├─ 直播画面  投到直播姬或 OBS
├─ 主播工作  只在主播端使用
└─ 软件与帮助  本机维护与说明
```

The restrained treatment is intentional: another segmented control or card layer would add a click and consume vertical space without improving ownership.

---

### Task 1: Lock the grouping contract with a focused regression

**Files:**

- Modify: `test/toolbox-sidebar.test.js`
- Test: `test/toolbox-sidebar.test.js`

**Interfaces:**

- Consumes: the composed Admin HTML returned by `readAdminHtml()`.
- Produces: assertions for four ordered `data-other-feature-group` regions and the unchanged feature IDs assigned to each region.

- [x] **Step 1: Write the failing test**

Add a test that extracts the navigation fragment and checks this exact mapping:

```js
const expectedGroups = [
  [
    'live-interaction',
    '直播互动',
    ['otherDanmakuFeature', 'otherGiftFeature', 'otherGamesFeature'],
  ],
  [
    'live-scene',
    '直播画面',
    [
      'otherOvertimeMachineFeature',
      'otherGiftEffectsFeature',
      'otherStartAnimationFeature',
      'otherClockFeature',
    ],
  ],
  ['streamer-work', '主播工作', ['otherDailyTodoFeature']],
  [
    'software-help',
    '软件与帮助',
    [
      'otherPerformanceFeature',
      'otherUsageGuideFeature',
      'otherDesktopUpdateFeature',
    ],
  ],
];
```

For every group, assert that its heading exists, its features occur before the next heading, and no expected feature appears in another group. Also assert the CSS exposes `.other-feature-group-heading` and hides its text in `.sidebar-collapsed` mode.

- [x] **Step 2: Run the focused test and confirm the new assertion fails**

Run:

```powershell
node --test test/toolbox-sidebar.test.js
```

Expected: the new group-contract test fails because `data-other-feature-group` and `.other-feature-group-heading` do not exist yet; unrelated existing assertions remain unchanged.

---

### Task 2: Group the existing navigation without changing behavior

**Files:**

- Modify: `public/pages/admin/toolbox/shell-start.html`
- Modify: `public/css/admin/other-features/shell.css`
- Modify: `public/css/admin/other-features/usage-guide.css`
- Test: `test/toolbox-sidebar.test.js`
- Test: `test/frontend-admin-shell.test.js`

**Interfaces:**

- Consumes: `other.js` queries for `[data-other-feature]`, existing panel IDs, and current desktop/mobile toolbox layout.
- Produces: four presentational group headings and the same feature buttons in a clearer order; no JavaScript API changes.

- [x] **Step 1: Move all feature buttons into the existing tab list**

Remove the separate `.other-sidebar-page-links` container. Keep one `<nav class="other-feature-menu" role="tablist" ...>` and insert headings with this exact structure:

```html
<div
  class="other-feature-group-heading"
  data-other-feature-group="live-interaction"
  role="presentation"
>
  <strong>直播互动</strong>
  <small>和观众实时发生</small>
</div>
```

Repeat with:

| Group key          | Heading    | Explanation      | Existing feature buttons, in order                                                                          |
| ------------------ | ---------- | ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `live-interaction` | 直播互动   | 和观众实时发生   | `otherDanmakuFeature`, `otherGiftFeature`, `otherGamesFeature`                                              |
| `live-scene`       | 直播画面   | 投到直播姬或 OBS | `otherOvertimeMachineFeature`, `otherGiftEffectsFeature`, `otherStartAnimationFeature`, `otherClockFeature` |
| `streamer-work`    | 主播工作   | 只在主播端使用   | `otherDailyTodoFeature`                                                                                     |
| `software-help`    | 软件与帮助 | 本机维护与说明   | `otherPerformanceFeature`, `otherUsageGuideFeature`, `otherDesktopUpdateFeature`                            |

Give the existing 弹幕姬 and 礼物姬 buttons stable tab IDs plus their existing panel IDs as `aria-controls`, and keep every other button attribute and SVG unchanged.

- [x] **Step 2: Add the minimal group-label styles**

Add styles equivalent to:

```css
.other-feature-group-heading {
  display: flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
  margin: 6px 2px 0;
  padding: 9px 8px 3px;
  border-top: 1px solid var(--border);
  color: var(--muted);
}

.other-feature-group-heading:first-child {
  margin-top: 0;
  padding-top: 2px;
  border-top: 0;
}
```

Use existing micro typography tokens for `strong` and `small`. In collapsed mode, hide the text while retaining a short separator for every group after the first. At `max-width: 900px`, make each heading span the full auto-fit navigation grid. Remove only `.other-sidebar-page-links` and `.other-sidebar-page-link` rules made obsolete by the markup change.

- [x] **Step 3: Run focused navigation tests**

Run:

```powershell
node --test test/toolbox-sidebar.test.js test/frontend-admin-shell.test.js
```

Expected: all tests pass, including keyboard/storage regressions and the new exact group mapping.

---

### Task 3: Align user help and owner documentation

**Files:**

- Modify: `public/pages/admin/toolbox/usage-guide.html`
- Modify: `docs/architecture/frontend/app.md`
- Test: `test/toolbox-sidebar.test.js`

**Interfaces:**

- Consumes: the four visible navigation group names.
- Produces: user-facing help and the Admin owner document that describe the same grouping without changing any runtime contract.

- [x] **Step 1: Update the 百宝箱 guide paragraph**

Replace the flat “上方 / 下方依次” inventory with one concise sentence naming the four groups and their purpose. Keep the existing instructions for collapsing the sidebar and the guide's two-column behavior.

- [x] **Step 2: Update the Admin owner document**

In `docs/architecture/frontend/app.md` §6, state that `other.js` still owns only navigation and that the HTML shell visually groups the unchanged feature IDs into 直播互动、直播画面、主播工作、软件与帮助.

- [x] **Step 3: Run focused and quick verification**

Run:

```powershell
node --test test/toolbox-sidebar.test.js test/frontend-admin-shell.test.js test/admin-page-composition.test.js
npm.cmd run check
npm.cmd run verify:quick
```

Expected: every command exits successfully.

- [x] **Step 4: Perform desktop visual verification**

Inspect the Electron Admin 百宝箱 at 1280×720 and 1024×680 in these states:

- expanded sidebar with all four headings readable;
- collapsed sidebar with clean group separators and no clipped label text;
- a selected feature in each group;
- narrow layout where headings span the navigation grid.

Confirm there is no horizontal overflow, button clipping, ambiguous group ownership, or change to panel selection and keyboard navigation.

- [x] **Step 5: Review the final scope**

Run:

```powershell
git diff --check
git status --short
```

Review the task-owned hunks in all listed files, including their pre-existing dirty changes. Do not revert unrelated modifications.

## Verification Results

- Focused Admin and toolbox checks: 59/59 passed.
- JavaScript syntax check: 438 files passed.
- Quick gate: governance docs 5/5 and architecture checks 9/9 passed.
- Full test suite: 879/879 passed.
- Electron visual QA passed at 1280×720 and 1024×680 for expanded and collapsed sidebars; an exploratory 840px pass confirmed full-width group headings and working arrow-key navigation without horizontal overflow.
- Final diff review preserved pre-existing dirty-worktree changes; `git diff --check` reported only existing Windows line-ending warnings.

## Rollback Or Failure Handling

If a focused assertion or visual state fails, inspect only the task-owned hunks and adjust the group markup or selectors. Do not use blanket checkout, reset, or broad deletion; the worktree contains unrelated user changes in several target files.

## Done When

- The 百宝箱 sidebar visibly presents the exact four groups and feature mapping above.
- All existing feature IDs, panel IDs, selection persistence, collapse persistence, keyboard navigation, page URLs, and runtime modules remain unchanged.
- Expanded, collapsed, default-window, and minimum-window layouts remain usable without clipping or horizontal overflow.
- Focused tests, syntax checks, quick verification, documentation, final diff review, and status review pass.
