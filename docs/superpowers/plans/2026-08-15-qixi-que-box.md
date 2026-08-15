# Qixi Que Box Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 七夕鹊匣 as the fourth built-in blind box, bundle its official artwork correctly, and give its mapping and recent-gift cards a pink-purple identity.

**Architecture:** Extend the existing JSON default and name-based migration instead of introducing a new configuration system. Reuse the current blind-box icon resolver and CSS class pattern so both mapping chips and recent gift cards share one fixed local image and one theme class.

**Tech Stack:** Node.js 24, CommonJS, browser JavaScript, CSS, `node:test`.

## Global Constraints

- Preserve existing user settings and unrelated worktree changes.
- Keep the new blind box fourth in the default array.
- Use fixed same-origin image paths and existing escaping helpers.
- Store the box artwork under `blind-box/`; keep output artwork in existing value directories.

---

### Task 1: Default Mapping And Upgrade Migration

**Files:**
- Modify: `src/storage/settings-store.js`
- Create: `test/blind-box-defaults.test.js`

**Interfaces:**
- Consumes: `DEFAULT_SETTINGS.giftBlindBoxConfig`, `migrateBlindBoxConfig(db)`.
- Produces: a fourth default item named `七夕鹊匣` with `{name, price, outputs}`.

- [ ] **Step 1: Write a failing default-order test**

```js
const config = JSON.parse(DEFAULT_SETTINGS.giftBlindBoxConfig);
assert.equal(config.length, 4);
assert.equal(config[3].name, '七夕鹊匣');
assert.equal(config[3].price, 25);
```

- [ ] **Step 2: Write a failing migration test**

Use a minimal prepared-statement fake that returns a three-box JSON value and captures the `UPDATE settings` argument. Assert the migrated array appends `七夕鹊匣` once and leaves the existing entries unchanged.

- [ ] **Step 3: Run the focused test and verify failure**

Run: `node --test test/blind-box-defaults.test.js`

- [ ] **Step 4: Append the new default object**

Use cost `25` and RMB output values `5`, `19`, `26`, `66`, `500`, `1200`, converted from the image's battery values and ordered from highest to lowest in the UI configuration.

- [ ] **Step 5: Run the focused test and verify pass**

Run: `node --test test/blind-box-defaults.test.js`

### Task 2: Box Artwork And Resolver

**Files:**
- Modify: `public/js/admin/gifts/recent.js`
- Modify: `test/frontend-gifts.test.js`
- Move: `public/img/bilibili-gifts/0000-under-0100/35786.webp` to `public/img/bilibili-gifts/blind-box/35786.webp`

**Interfaces:**
- Consumes: `getBlindBoxIcon(item)`.
- Produces: `{name: '七夕鹊匣', className: 'blind-box-qixi', src: '/img/bilibili-gifts/blind-box/35786.webp'}`.

- [ ] **Step 1: Add failing resolver and rendered-card assertions**

Assert the source contains the new mapping, and render a gift item whose `gift_name` is `七夕鹊匣` to verify the image path and `blind-box-qixi` class appear.

- [ ] **Step 2: Run the frontend gift test and verify failure**

Run: `node --test test/frontend-gifts.test.js`

- [ ] **Step 3: Extend the resolver and card class assignment**

Read `blind_box_name`, configuration `name`, then `gift_name`. Apply the returned blind-box class whenever a known icon is present so the box itself and opened gifts share styling.

- [ ] **Step 4: Move the artwork and remove the temporary event folder**

Move only the box image. Keep `35787`–`35792` in their existing value directories and remove `public/img/bilibili-gifts/qixi-que-box/`.

- [ ] **Step 5: Run the frontend gift test and verify pass**

Run: `node --test test/frontend-gifts.test.js`

### Task 3: Pink-Purple Visual Theme

**Files:**
- Modify: `public/css/admin/gifts/blindbox-mapping.css`
- Modify: `public/css/admin/gifts/recent.css`
- Modify: `test/frontend-gifts.test.js`

**Interfaces:**
- Consumes: `.blind-box-qixi` class and image alt text containing `七夕鹊匣`.
- Produces: mapping and recent-card themes using the shared pink-purple palette.

- [ ] **Step 1: Add failing CSS assertions**

Assert the mapping selector has a hex border and gradient, and the recent-card selector uses border `#d786dc` plus a linear gradient.

- [ ] **Step 2: Run the frontend gift test and verify failure**

Run: `node --test test/frontend-gifts.test.js`

- [ ] **Step 3: Add mapping card styles**

Add base, hover, icon, name, and price rules for `img[alt*="七夕鹊匣"]` using `#fff2fb`, `#f3e8ff`, `#d786dc`, `#9b3fa6`, and `#bb63c4`.

- [ ] **Step 4: Add recent card styles**

Add `.gift-card.blind-box-card.blind-box-qixi` with the same pink-purple visual identity while preserving existing profit colors and layout.

- [ ] **Step 5: Run the frontend gift test and verify pass**

Run: `node --test test/frontend-gifts.test.js`

### Task 4: Asset Metadata And Verification

**Files:**
- Modify: `public/img/bilibili-gifts.json`
- Modify: `public/img/bilibili-gifts/qixi-que-box.md`
- Modify: `public/img/bilibili-gifts/gift-mapping-under-100.md`
- Modify: `public/img/bilibili-gifts/gift-mapping-100-above.md`

**Interfaces:**
- Consumes: official gift IDs `35786`–`35792` and current image paths.
- Produces: consistent local metadata and clickable documentation.

- [ ] **Step 1: Add the seven gifts to the JSON manifest**

Use the official CDN URLs already captured in `tmp/gift-config.json`, with `35786` categorized as `blind-box` and output gifts using their existing value directories.

- [ ] **Step 2: Update mapping documentation paths**

Move only the `35786` row to the blind-box section and keep the output rows in their current value sections.

- [ ] **Step 3: Run static validation**

Run: `npm run check`

- [ ] **Step 4: Run focused tests**

Run: `node --test test/blind-box-defaults.test.js test/frontend-gifts.test.js`

- [ ] **Step 5: Run the complete suite**

Run: `npm test`
