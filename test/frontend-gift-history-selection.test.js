'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createUiFixture } = require('./helpers/ui-edit-state-fixture');

const fixture = createUiFixture();
const html = fs.readFileSync(path.resolve('public/pages/admin/gifts/history.html'), 'utf8');

async function openHistory(t) {
  const page = await fixture(t, 'gift-history-selection');
  await page.setContent(`<style>
    [hidden] { display: none !important; }
    #giftHistoryScroll { position: relative; height: 260px; overflow: auto; }
    table { width: 800px; border-collapse: collapse; }
    td { height: 40px; padding: 0; user-select: none; }
    td:first-child { width: 40px; }
    .gift-history-marquee { position: absolute; pointer-events: none; }
  </style>${html}`);
  await page.evaluate(async () => {
    window.historyState = { items: Array.from({ length: 100 }, (_, index) => ({ eventId: `gift-${index}` })),
      selected: new Set(), filters: {}, total: 100, partial: false, viewRevision: 'synthetic' };
    window.renderRows = () => {
      document.getElementById('giftHistoryBody').innerHTML = historyState.items.map(({ eventId }) =>
        `<tr data-event-id="${eventId}"><td><input type="checkbox" data-gift-select="${eventId}"></td><td colspan="6">${eventId}</td></tr>`).join('');
    };
    renderRows();
    window.fetch = () => new Promise((resolve) => { window.finishSelection = resolve; });
    const { createGiftHistoryTools } = await import('/js/admin/gifts/history-tools.js');
    window.historyTools = createGiftHistoryTools({ state: historyState, reload() {}, resetPagination() {} });
    historyTools.update();
  });
  return page;
}

const selected = (page) => page.evaluate(() => [...historyState.selected].sort());
async function dragRows(page, from, to) {
  const start = await page.locator(`#giftHistoryBody tr:nth-child(${from + 1})`).boundingBox();
  const end = await page.locator(`#giftHistoryBody tr:nth-child(${to + 1})`).boundingBox();
  await page.mouse.move(start.x + 180, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + 360, end.y + end.height / 2, { steps: 5 });
}

test('whole rows toggle once, slight movement stays a click, and checkboxes retain keyboard control', async (t) => {
  const page = await openHistory(t);
  const cell = page.locator('#giftHistoryBody tr').first().locator('td').last();
  await cell.click();
  assert.deepEqual(await selected(page), ['gift-0']);
  assert.equal(await page.locator('#giftHistoryExport').textContent(), '导出所选 1 条');
  await cell.click();
  assert.deepEqual(await selected(page), []);
  const box = await cell.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 22, box.y + 21);
  await page.mouse.up();
  assert.deepEqual(await selected(page), ['gift-0']);
  const checkbox = page.locator('[data-gift-select="gift-0"]');
  await checkbox.click();
  assert.deepEqual(await selected(page), []);
  await checkbox.press('Space');
  assert.deepEqual(await selected(page), ['gift-0']);
  assert.equal(await page.locator('#giftHistorySelectPage').evaluate((input) => input.indeterminate), true);
});

test('marquee replaces the page selection, preserves other pages, supports reverse and additive dragging', async (t) => {
  const page = await openHistory(t);
  await page.evaluate(() => { historyState.selected.add('other-page'); historyState.selected.add('gift-4'); historyTools.update(); });
  await dragRows(page, 1, 3);
  assert.equal(await page.locator('#giftHistoryMarquee').isVisible(), true);
  await page.mouse.up();
  assert.deepEqual(await selected(page), ['gift-1', 'gift-2', 'gift-3', 'other-page']);
  await page.keyboard.down('Control');
  await dragRows(page, 4, 3);
  await page.mouse.up();
  await page.keyboard.up('Control');
  assert.deepEqual(await selected(page), ['gift-1', 'gift-2', 'gift-3', 'gift-4', 'other-page']);
  await page.locator('#giftHistoryDeselect').click();
  assert.deepEqual(await selected(page), []);
  assert.equal(await page.locator('#giftHistoryExport').isDisabled(), true);
});

test('drag scrolls at the edge and cancellation or row replacement restores the initial selection', async (t) => {
  const page = await openHistory(t);
  await page.evaluate(() => { historyState.selected.add('gift-0'); historyTools.update(); });
  await dragRows(page, 1, 3);
  const scroll = await page.locator('#giftHistoryScroll').boundingBox();
  await page.mouse.move(scroll.x + 300, scroll.y + scroll.height - 2);
  await page.waitForFunction(() => document.getElementById('giftHistoryScroll').scrollTop > 80);
  assert.ok((await selected(page)).length > 3);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.up();
  assert.deepEqual(await selected(page), ['gift-0']);
  assert.equal(await page.locator('#giftHistoryMarquee').isVisible(), false);
  await page.locator('#giftHistoryScroll').evaluate((node) => { node.scrollTop = 0; });
  await dragRows(page, 1, 3);
  await page.evaluate(() => { renderRows(); historyTools.update(); });
  await page.mouse.up();
  assert.deepEqual(await selected(page), ['gift-0']);
  assert.equal(await page.locator('#giftHistoryMarquee').isVisible(), false);
});

test('100-row marquee batches rapid movement, stops idle updates and flushes the release position', async (t) => {
  const page = await openHistory(t);
  await page.evaluate(() => {
    window.pendingFrames = new Map();
    let id = 0;
    window.requestAnimationFrame = (callback) => { pendingFrames.set(++id, callback); return id; };
    window.cancelAnimationFrame = (frame) => pendingFrames.delete(frame);
    document.addEventListener('pointerdown', (event) => { window.dragPointerId = event.pointerId; }, { once: true });
  });
  await dragRows(page, 0, 2);
  await page.evaluate(() => {
    const rows = document.querySelectorAll('#giftHistoryBody tr');
    for (let i = 0; i < 120; i += 1) {
      const rect = rows[1 + i % 3].getBoundingClientRect();
      document.dispatchEvent(new PointerEvent('pointermove', { pointerId: dragPointerId,
        buttons: 1, clientX: rect.left + 200, clientY: rect.top + rect.height / 2 }));
    }
  });
  assert.equal(await page.evaluate(() => pendingFrames.size), 1);
  assert.deepEqual(await selected(page), []);
  await page.evaluate(() => {
    const callbacks = [...pendingFrames.values()];
    pendingFrames.clear();
    callbacks.forEach((callback) => callback());
  });
  assert.deepEqual(await selected(page), ['gift-0', 'gift-1', 'gift-2', 'gift-3']);
  assert.equal(await page.evaluate(() => pendingFrames.size), 0);
  const last = await page.locator('#giftHistoryBody tr').nth(4).boundingBox();
  await page.mouse.move(last.x + 300, last.y + last.height / 2);
  await page.mouse.up();
  assert.deepEqual(await selected(page), ['gift-0', 'gift-1', 'gift-2', 'gift-3', 'gift-4']);
  assert.equal(await page.evaluate(() => pendingFrames.size), 0);
});

test('manual selection supersedes pending select-all and exports the same selected IDs', async (t) => {
  const page = await openHistory(t);
  await page.locator('#giftHistorySelectAll').click();
  await page.waitForFunction(() => typeof window.finishSelection === 'function');
  await page.locator('#giftHistoryBody tr').first().locator('td').last().click();
  await page.evaluate(async () => {
    finishSelection({ json: async () => ({ ok: true, data: { items: historyState.items } }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    window.giftExport = { prepare: (selection) => { window.exportedSelection = selection; return new Promise(() => {}); } };
  });
  assert.deepEqual(await selected(page), ['gift-0']);
  await page.locator('#giftHistoryExport').click();
  await page.waitForFunction(() => window.exportedSelection);
  assert.deepEqual(await page.evaluate(() => exportedSelection.eventIds), ['gift-0']);
  await page.locator('#giftHistorySelectPage').check();
  assert.equal((await selected(page)).length, 100);
  await page.locator('#giftHistorySelectPage').uncheck();
  assert.deepEqual(await selected(page), []);
});
