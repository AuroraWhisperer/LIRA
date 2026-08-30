# Usage Guide Layout, Overlay Copy, And Screenshot Privacy Implementation Plan

> **For agentic workers:** Implement this plan task by task in the current worktree. Steps use checkbox (`- [ ]`) syntax for tracking. Do not create commits unless the user explicitly requests one.

**Goal:** Restore normal horizontal text flow in the usage guide's "主流程" steps, describe overlay use for both 直播姬 and OBS, and remove the owner's avatar and WeChat display name from the DeepSeek screenshots.

**Architecture:** Keep the change inside the Admin frontend owner. Replace the step row's two-column grid, which treats the direct text after `<strong>` as a separate anonymous grid item, with a normal inline text flow and an absolutely positioned number marker in a fixed left gutter. Update only usage-guide copy whose meaning applies to both overlay hosts, redact identity pixels directly in the three affected PNG assets, and add focused Admin shell regressions; no JavaScript, public route, or persistence contract changes are needed.

**Tech Stack:** Vanilla HTML/CSS, CommonJS `node:test`, Node.js 24+

## Global Constraints

- Preserve the modular monolith and the no-build Vanilla JavaScript frontend.
- Preserve the usage guide fragment order, section IDs, anchors, accessibility behavior, and sidebar states.
- Preserve the desktop two-column table-of-contents mode and the narrow single-column layout.
- Do not add images; modify only DeepSeek screenshots that contain the owner's identity row.
- Keep the diff limited to the owning stylesheet and fragment, the three affected images, the focused regression test, and this plan.

---

## Goal

When a user opens `百宝箱 -> 使用文档 -> 主流程`, every numbered step shall display its full sentence across the available content width. The text shall not wrap one Chinese character per line in the 26px number column.

## Non-goals

- Redesigning the usage guide, table of contents, cards, typography, or colors.
- Rewriting usage-guide copy or adding screenshots to the main-flow section.
- Changing sidebar collapse behavior or the `1120px` and `900px` responsive breakpoints.
- Changing overlay runtime behavior or claiming support beyond the existing browser-source compatibility.
- Editing DeepSeek screenshots that do not contain the owner's avatar and display name.
- Refactoring unrelated Admin CSS or JavaScript.

## Current Behavior

- `public/pages/admin/toolbox/usage-guide.html` renders each main-flow step as one `<li>` containing an inline `<strong>` followed by a direct text node.
- `public/css/admin/other-features/usage-guide.css` makes that `<li>` a two-column grid: `26px minmax(0, 1fr)`.
- The `::before` number marker occupies the first grid cell, `<strong>` occupies the second, and the following anonymous text item is auto-placed into the next available cell: the first 26px column on the next grid row. Chinese text therefore wraps almost character by character, matching the supplied screenshot.
- The main-flow section contains no `<img>`. The guide's only `.usage-guide-image` nodes are in the earlier "电脑上已经安装过 LIRA" section, so an image is not consuming the missing width.
- `test/frontend-admin-shell.test.js` currently verifies that the usage-guide panel exists but does not protect the step layout.
- The overlay section and several related instructions name only OBS even though the same local browser-source URLs also work in 直播姬.
- `deepseek-api-keys.png`, `deepseek-usage.png`, and `deepseek-recharge.png` contain the owner's avatar and WeChat display name in the lower-left account row. The other four DeepSeek screenshots do not contain that row.

## Ownership

- Owner: `public/css/admin/other-features/usage-guide.css` and `public/pages/admin/toolbox/usage-guide.html` under `ROUTE-ADMIN`.
- Contracts: `docs/architecture/frontend/app.md` and `docs/architecture/frontend/pages.md`.
- Consumer: the composed Admin page served by `src/server/admin-page.js`.
- Focused test: `test/frontend-admin-shell.test.js`.

## Compatibility Constraints

- No HTTP path, response shape, page URL, section anchor, persisted setting, or Electron contract changes.
- The numbered circles must remain aligned in a stable 24px box with the existing colors and typography.
- Step separators and current padding density must remain visually consistent.
- Long Chinese and Latin text must use the main content width in expanded sidebar, collapsed sidebar, and narrow layouts.
- Overlay instructions must distinguish 直播姬's `浏览器` control from OBS's `浏览器源` control.
- Redaction must replace the original identity pixels in the PNG files rather than relying on a reversible page overlay or CSS mask.

## Proposed Changes

- Modify `public/css/admin/other-features/usage-guide.css` only within `.usage-guide-steps li` and `.usage-guide-steps li::before`:
  - remove the two-column grid declarations from the list item;
  - make the list item the positioning context;
  - reserve a fixed left gutter for the marker;
  - absolutely position the existing `::before` marker in that gutter.
- Extend `test/frontend-admin-shell.test.js` with a focused assertion that the list item uses normal text flow with a marker gutter and does not reintroduce `grid-template-columns`.
- Update `public/pages/admin/toolbox/usage-guide.html` so the navigation, section heading, generic browser-source instructions, related feature copy, and FAQ cover both 直播姬 and OBS.
- Redact the lower-left identity row in `deepseek-api-keys.png`, `deepseek-usage.png`, and `deepseek-recharge.png` with the surrounding sidebar background while preserving their dimensions and all unrelated UI.
- Leave JavaScript, architecture documents, unaffected image assets, and public contracts unchanged.

## Task 1: Protect And Fix The Main-Flow Step Layout

**Files:**

- Modify: `test/frontend-admin-shell.test.js`
- Modify: `public/css/admin/other-features/usage-guide.css`

**Interfaces:**

- Consumes: the existing `.usage-guide-steps`, `.usage-guide-steps li`, and `.usage-guide-steps li::before` selectors.
- Produces: a normal inline text flow with a 38px reserved marker gutter and the existing 24px numbered circle.

- [x] **Step 1: Add a failing CSS regression test**

Add a focused test beside the existing toolbox/usage-guide assertions:

```js
test('usage guide main-flow steps keep body text out of the number gutter', () => {
  const source = readCssBundle('public', 'css', 'admin', 'other-features.css');
  const stepRule = source.match(/\.usage-guide-steps li\s*\{[\s\S]*?\n\}/)?.[0];
  const markerRule = source.match(
    /\.usage-guide-steps li::before\s*\{[\s\S]*?\n\}/,
  )?.[0];

  assert.ok(stepRule, 'usage guide step layout should remain defined');
  assert.ok(markerRule, 'usage guide step marker should remain defined');
  assert.match(stepRule, /position:\s*relative/);
  assert.match(stepRule, /padding:\s*11px 2px 11px 40px/);
  assert.doesNotMatch(stepRule, /grid-template-columns/);
  assert.match(markerRule, /position:\s*absolute/);
  assert.match(markerRule, /left:\s*2px/);
});
```

- [x] **Step 2: Run the focused test and confirm it fails for the current grid rule**

Run:

```powershell
node --test test/frontend-admin-shell.test.js
```

Expected: the new test fails because `.usage-guide-steps li` lacks `position: relative`, still contains `grid-template-columns`, and the marker is not absolutely positioned.

- [x] **Step 3: Apply the minimum CSS fix**

Change only the affected declarations:

```css
.usage-guide-steps li {
  counter-increment: usage-guide-step;
  position: relative;
  padding: 11px 2px 11px 40px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}

.usage-guide-steps li::before {
  content: counter(usage-guide-step);
  position: absolute;
  top: 12px;
  left: 2px;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--color-border-primary);
  border-radius: 50%;
  color: var(--primary-strong);
  font-size: 11.5px;
  font-weight: 700;
}
```

The existing separator and `<strong>` rules remain unchanged.

- [x] **Step 4: Run the focused test and confirm it passes**

Run:

```powershell
node --test test/frontend-admin-shell.test.js
```

Expected: all tests in the file pass.

- [x] **Step 5: Verify the rendered behavior at representative widths**

Open the Admin page, select `百宝箱 -> 使用文档`, and inspect `主流程` in these states:

- desktop width at or above `1120px`, sidebar expanded;
- desktop width at or above `1120px`, sidebar collapsed with the fixed left table of contents;
- width below `900px`, where the toolbox becomes a single column.

Expected in every state: marker circles remain on the left, bold lead text and the following sentence share the same readable text column, no character-by-character column appears, no horizontal overflow is introduced, and the section card uses the available width.

Observed: at `1440px` with the sidebar collapsed, the document layout remained `196px 902.667px`, the longer `直播姬 / OBS 投屏` table-of-contents item did not overflow, and the main-flow section did not overflow. At `860px`, the guide returned to one column and the tallest main-flow step remained about `63.46px`.

## Task 2: Generalize Overlay Copy And Redact DeepSeek Identity

**Files:**

- Modify: `public/pages/admin/toolbox/usage-guide.html`
- Modify: `public/img/usage-guide/deepseek-api-keys.png`
- Modify: `public/img/usage-guide/deepseek-usage.png`
- Modify: `public/img/usage-guide/deepseek-recharge.png`
- Modify: `test/frontend-admin-shell.test.js`

**Interfaces:**

- Consumes: the existing `#ug-obs` anchor and the existing DeepSeek image URLs.
- Produces: host-neutral overlay guidance while preserving all URLs and image dimensions.

- [x] **Step 1: Add failing copy regressions**

Add assertions for the `直播姬 / OBS 投屏` navigation label and heading, the distinct 直播姬 `浏览器` / OBS `浏览器源` instruction, and the generalized FAQ heading.

- [x] **Step 2: Update only overlay-host-specific usage-guide copy**

Keep OBS where an instruction is specifically about OBS behavior; use `直播姬 / OBS` for shared overlay behavior and name each product's browser-source control accurately.

- [x] **Step 3: Inspect all seven DeepSeek screenshots**

Confirm that only the API keys, usage, and recharge screenshots contain the lower-left identity row. Do not modify the login or three cropped dialog screenshots.

- [x] **Step 4: Permanently redact the three affected PNGs**

Replace the complete avatar/name pixel area with the sampled left-sidebar background. Preserve PNG format and these dimensions:

- `deepseek-api-keys.png`: `1440 x 695`
- `deepseek-usage.png`: `2488 x 1195`
- `deepseek-recharge.png`: `1440 x 686`

- [x] **Step 5: Verify copy, responsive layout, and image loading**

The focused usage-guide tests pass. Browser checks confirm the longer table-of-contents item does not overflow at `1440px`, the guide remains single-column at `860px`, and all seven DeepSeek images load at their expected natural dimensions. Direct image inspection confirms the three identity rows are removed without affecting adjacent menu items.

## Verification

Run in order:

```powershell
node --test test/frontend-admin-shell.test.js
npm run check
npm run verify:quick
git diff --check
git diff -- public/css/admin/other-features/usage-guide.css test/frontend-admin-shell.test.js specs/plans/2026-08-18-usage-guide-main-flow-layout.md
git status --short
```

Expected: all automated commands pass; the visual checks pass at all three layout states; the final diff contains only the plan, the focused CSS correction, usage-guide copy, the three redacted PNGs, and their regression tests.

## Rollback Or Failure Handling

If the visual result differs from the expected layout, stop after the focused CSS/test changes, inspect their scoped diff, and reverse only those task-owned hunks with `apply_patch`. Do not use blanket checkout, reset, or broad deletion. Keep the plan updated with any discovered breakpoint-specific issue before expanding scope.

## Done When

- Main-flow body text uses the full text column and no longer wraps inside the number gutter.
- Number markers, separators, copy, anchors, sidebar modes, and responsive behavior remain intact.
- Shared overlay instructions name both 直播姬 and OBS and use the correct browser-source labels.
- The avatar and WeChat display name are absent from all DeepSeek screenshots that previously contained them.
- Unaffected images and unrelated usage-guide sections do not change.
- The focused regression test, syntax check, and quick verification gate pass.
- Visual checks pass in expanded desktop, collapsed desktop, and narrow single-column states.
- `git diff --check` passes and the reviewed diff is limited to the planned files.

## Verification Results

- `node --experimental-vm-modules --test test/frontend-admin-shell.test.js`: 25 passed, 0 failed.
- `npm run verify:quick`: documentation, syntax, and architecture gates passed.
- `npm test`: 644 tests, 643 passed, 1 skipped, 0 failed.
- Browser verification: passed at `1440 x 900` with expanded and collapsed sidebars and at `860 x 900` in the single-column layout; no main-flow or table-of-contents overflow.
- Image verification: all seven DeepSeek images loaded at their expected natural dimensions; direct inspection confirmed the identity row is absent from the three affected screenshots.
- `git diff --check`: passed; only line-ending policy warnings were reported by Git.
