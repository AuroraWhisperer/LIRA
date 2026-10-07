'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { chromium } = require('playwright');
const { readAdminHtml } = require('../helpers/admin-html');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');

test('shared controls compose with drawers, collapsible content and song tabs', async (t) => {
  const html = readAdminHtml().replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  const server = await startComponentPreviewServer({ parentHtml: html });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await browser.close(); await server.close(); assert.deepEqual(errors, []); });
  const url = `${server.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.evaluate(async () => {
    window.clearCalls = 0;
    window.fetch = async (url) => {
      if (url === '/api/database/clear-gifts') window.clearCalls++;
      return new Response(JSON.stringify({ ok: true, data: { items: [], partial: false,
        perUser: [{ viewer: 'synthetic-viewer', userName: '测试观众', boxCount: 1, boxTypeCount: 1,
          totalCost: 1000, totalValue: 500, totalProfit: -500 }],
        summary: { boxCount: 1, totalCost: 1000, totalValue: 500, totalProfit: -500 } } }));
    };
    await import('/js/admin/contextual-help.js');
    const { formsService } = await import('/js/admin/forms.js');
    const { initGiftHistoryDrawer } = await import('/js/admin/gifts/history.js');
    await import('/js/admin/gifts/blindbox.js');
    formsService.initTabs();
    initGiftHistoryDrawer();
    window.selectMain = id => document.querySelectorAll('.main-page').forEach(node => node.classList.toggle('active', node.id === id));
    window.selectMain('giftAssistantPage');
  });

  await page.locator('#giftHistoryOpenBtn').click();
  await page.locator('#giftHistoryClearDatabaseBtn').click();
  await page.locator('.lira-confirm-cancel').press('Escape');
  await page.locator('.lira-confirm-backdrop').waitFor({ state: 'detached' });
  assert.equal(await page.locator('#giftHistoryDrawer').evaluate(node => node.classList.contains('open')), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'giftHistoryClearDatabaseBtn');
  assert.equal(await page.evaluate(() => window.clearCalls), 0);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#giftHistoryDrawer').evaluate(node => node.classList.contains('open')), false);

  await page.locator('#blindBoxStatsToggle').click();
  const content = page.locator('#blindBoxStatsCollapsible');
  assert.equal(await content.evaluate(node => node.inert), true);
  await page.locator('#blindBoxStatsToggle').press('Tab');
  assert.equal(await content.evaluate(node => node.contains(document.activeElement)), false);
  await page.locator('#blindBoxStatsToggle').click();
  assert.equal(await content.evaluate(node => node.inert), false);
  await page.locator('#blindBoxStatsToggle').press('Tab');
  assert.equal(await content.evaluate(node => node.contains(document.activeElement)), true);

  await page.evaluate(() => window.selectMain('songAssistantPage'));
  await page.getByRole('tab', { name: '歌库', exact: true }).press('ArrowRight');
  assert.equal(await page.getByRole('tab', { name: '设置', exact: true }).getAttribute('aria-selected'), 'true');
  await page.getByRole('tab', { name: '设置', exact: true }).press('End');
  assert.equal(await page.getByRole('tabpanel', { name: '桌面歌词设置', exact: true }).isVisible(), true);
  assert.equal(await page.locator('.tabs .tab[tabindex="0"]').count(), 1);
  await page.locator('#desktopLyricPage details').evaluateAll(nodes => nodes.forEach(node => { node.open = true; }));
  const unnamed = (await page.locator('#desktopLyricPage').ariaSnapshot()).split('\n').filter(line => /^\s*- (checkbox|spinbutton|slider|combobox)(:|\s*\[|\s*$)/.test(line));
  assert.deepEqual(unnamed, []);
  assert.equal(await page.getByRole('checkbox', { name: '弹性动画', exact: true }).count(), 1);
  assert.equal(await page.getByRole('spinbutton', { name: '整体缩放', exact: true }).count(), 1);

  // Contextual help opens from pointer, focus and keys, but never acts as its label's control.
  await page.getByRole('tab', { name: '展示板', exact: true }).click();
  const sync = page.locator('#songBoardSyncTheme');
  const help = page.locator('label:has(#songBoardSyncTheme) lira-help');
  const tooltip = help.getByRole('tooltip');
  const syncChecked = await sync.isChecked();
  await help.hover();
  assert.equal(await help.getAttribute('aria-expanded'), 'true');
  assert.equal(await tooltip.isVisible(), true);
  await help.click();
  assert.equal(await help.getAttribute('aria-expanded'), 'true', 'Clicking does not toggle the open tooltip.');
  assert.equal(await sync.isChecked(), syncChecked, 'Clicking help inside a label does not toggle its control.');
  await page.mouse.move(0, 0);
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  assert.equal(await help.getAttribute('aria-expanded'), 'false');
  await help.hover();
  await page.mouse.move(0, 0);
  assert.equal(await help.getAttribute('aria-expanded'), 'false', 'Pointer leave closes a tooltip without keyboard focus.');
  await help.focus();
  await help.press('Escape');
  assert.equal(await help.getAttribute('aria-expanded'), 'false');
  await help.press('Enter');
  assert.equal(await help.getAttribute('aria-expanded'), 'true');
  assert.equal(await sync.isChecked(), syncChecked, 'Activating help by keyboard does not toggle its control.');
  await help.hover();
  await page.mouse.move(0, 0);
  assert.equal(await help.getAttribute('aria-expanded'), 'true', 'Pointer leave keeps keyboard-focused help open.');
  await help.press('Escape');
  assert.equal(await tooltip.isVisible(), false);
});
