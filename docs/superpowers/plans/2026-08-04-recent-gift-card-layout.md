# Recent Gift Card Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep gift names, users, counted amounts, blind-box profit/loss, timestamps, and optional gift artwork readable without overlap in every recent-gift card.

**Architecture:** Render each card as a content column plus an optional fixed-width artwork column. Inside the content column, truncate only free-form names and place the user/time and amount/result pairs in a two-column metadata grid so numeric data never competes with artwork.

**Tech Stack:** Browser HTML templates, CSS Grid, Node.js `node:test` source regressions.

## Global Constraints

- Keep the current recent-gift visual language and data formatting.
- Add no dependencies and touch only the recent-gift renderer, styles, and regression test.
- Preserve full gift and user names through native `title` tooltips when their visible text is truncated.
- Show the timestamp for blind-box cards as well as ordinary gift cards.

---

### Task 1: Lock the layout contract with a regression test

**Files:**
- Modify: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: `public/js/admin/gifts/recent.js` card template and `public/css/admin/gifts.css` selectors.
- Produces: A source regression requiring semantic content/artwork columns, named metadata fields, static artwork flow, and unconditional timestamps.

- [ ] **Step 1: Write the failing test**

```js
test('recent gift cards reserve artwork space and keep metadata in named slots', () => {
  const script = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'recent.js'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'gifts.css'), 'utf8');

  assert.match(script, /class="gift-card-content"/);
  assert.match(script, /class="gift-user"/);
  assert.match(script, /class="gift-amount"/);
  assert.match(script, /class="gift-result/);
  assert.match(script, /class="gift-time"/);
  assert.doesNotMatch(script, /item\.is_blind_box \? '' : `<span>\$\{formatTime/);
  assert.match(styles, /\.gift-card\.has-type-icon\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) 52px/);
  assert.match(styles, /\.gift-card \.gift-meta\s*\{[\s\S]*?grid-template-areas:/);
  assert.match(styles, /\.gift-card \.gift-type-icon\s*\{[\s\S]*?position:\s*static/);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --experimental-vm-modules --test --test-name-pattern="recent gift cards reserve artwork" test/frontend-regressions.test.js`

Expected: FAIL because the current card uses an absolutely positioned image and undifferentiated metadata spans.

- [ ] **Step 3: Commit**

Do not commit unless the user asks for a commit.

### Task 2: Restructure recent gift cards

**Files:**
- Modify: `public/js/admin/gifts/recent.js`

**Interfaces:**
- Consumes: Existing gift item fields and `escapeHtml`, `formatMoney`, and `formatTime` utilities.
- Produces: `.gift-card-content`, `.gift-user`, `.gift-amount`, `.gift-result`, and `.gift-time` elements for CSS layout.

- [ ] **Step 1: Add explicit metadata roles and tooltips**

Wrap the title and metadata in `.gift-card-content`. Give gift and user names escaped `title` attributes, assign each metadata value its named class, and render `.gift-time` unconditionally.

- [ ] **Step 2: Preserve blind-box value formatting**

Keep the existing `+`/`-` sign and `profit-up`/`profit-down` classes inside `.gift-result`; keep the fallback `开出` value for blind boxes without configured output names.

- [ ] **Step 3: Run the focused test**

Run: `node --experimental-vm-modules --test --test-name-pattern="recent gift cards reserve artwork" test/frontend-regressions.test.js`

Expected: Still FAIL until Task 3 defines the layout contract.

- [ ] **Step 4: Commit**

Do not commit unless the user asks for a commit.

### Task 3: Give content and artwork separate layout columns

**Files:**
- Modify: `public/css/admin/gifts.css`

**Interfaces:**
- Consumes: The named elements produced by Task 2.
- Produces: A responsive card layout where free-form text may ellipsize but money, result, timestamp, and artwork retain their own space.

- [ ] **Step 1: Define the card columns**

Set the base card to one `minmax(0, 1fr)` column and `.has-type-icon` cards to `minmax(0, 1fr) 52px`. Remove artwork padding and absolute positioning; center the image in its fixed grid column.

- [ ] **Step 2: Define the metadata grid**

Use two metadata columns and the areas `"user time"` and `"amount result"`. Apply ellipsis only to `.gift-name` and `.gift-user`; keep `.gift-time`, `.gift-amount`, and `.gift-result` on one line.

- [ ] **Step 3: Run the focused regression**

Run: `node --experimental-vm-modules --test --test-name-pattern="recent gift cards reserve artwork" test/frontend-regressions.test.js`

Expected: PASS.

- [ ] **Step 4: Commit**

Do not commit unless the user asks for a commit.

### Task 4: Verify behavior and presentation

**Files:**
- Verify: `public/js/admin/gifts/recent.js`
- Verify: `public/css/admin/gifts.css`
- Verify: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: Completed renderer and styles.
- Produces: Evidence that the layout is syntactically valid, regression-safe, and visually non-overlapping.

- [ ] **Step 1: Run static validation**

Run: `npm run check`

Expected: PASS.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Inspect a populated page**

Launch the local service, open the admin recent-gift panel at desktop width, and verify long gift/user names ellipsize while amounts, result, timestamp, and 48px artwork remain visible in separate regions.

- [ ] **Step 4: Commit**

Do not commit unless the user asks for a commit.
