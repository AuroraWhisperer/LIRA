'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { chromium } = require('playwright');
const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');

test('opening settings preview reuses a canvas layer and published output follows opening configuration', { timeout: 60000 }, async t => {
  let settings;
  const fixture = await startCanvasOutputFixture({ extraContext: { settings: { get: () => settings } } });
  settings = fixture.runtime.settings;
  Object.assign(settings, { openingEnabled: 'true', openingTitle: '开播准备中', openingName: 'LIRA' });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await fixture.close(); });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const desktop = await context.newPage();
  const page = await context.newPage();
  const errors = [];
  const childRequests = [];
  for (const target of [desktop, page]) {
    target.setDefaultTimeout(10000);
    target.on('pageerror', error => errors.push(error.message));
  }
  context.on('request', request => {
    if (request.url().includes('/api/') && request.frame().parentFrame()) childRequests.push(request.url());
  });
  await openCanvasDesktop(desktop, fixture);
  await desktop.route('**/api/settings', async route => {
    Object.assign(settings, route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });
  await desktop.evaluate(async html => {
    document.body.append(new DOMParser().parseFromString(html, 'text/html').body.firstElementChild);
    document.querySelector('#openingAnimationForm').closest('section').hidden = false;
    const { initStartAnimation } = await import('/js/admin/start-animation.js');
    initStartAnimation();
  }, fs.readFileSync('public/pages/admin/toolbox/start-animation.html', 'utf8'));
  const open = async () => {
    await desktop.evaluate(() => { window.externalPreviewUrl = ''; });
    await desktop.locator('#openingPreviewBtn').click();
    await desktop.waitForFunction(() => window.externalPreviewUrl);
    const url = await desktop.evaluate(() => window.externalPreviewUrl);
    assert.equal((await fetch(url)).status, 200);
    await page.goto('about:blank');
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('.scene-editor-item.is-selected .component-preview-load-state')?.hidden);
  };
  await open();
  const opening = page.frameLocator('.scene-editor-item.is-selected iframe');
  await opening.locator('#openingStage:not(.is-disabled)').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.scene-editor-item').count(), 1);
  assert.equal(await desktop.locator('#openingPreview').count(), 0);
  await desktop.locator('#openingTitle').fill('新的开播标题');
  await opening.getByText('新的开播标题', { exact: true }).waitFor({ state: 'visible' });
  await desktop.locator('#openingEnabled').uncheck();
  await opening.locator('#openingStage.is-disabled').waitFor({ state: 'attached' });
  await desktop.locator('#openingEnabled').check();
  await desktop.locator('#openingStyle').selectOption('pixel-cassette');
  await opening.locator('#openingPixel').waitFor({ state: 'visible' });
  assert.equal(await desktop.locator('#openingStyle option[value="moonlit-fan"]').count(), 0,
    'External suite styles are selected from the imported library.');
  assert.equal(await desktop.locator('#openingTitle').inputValue(), '新的开播标题');
  await desktop.locator('#openingQuality').selectOption('low');
  await opening.locator('#openingStage.quality-low').waitFor({ state: 'visible' });
  await desktop.locator('#openingQuality').selectOption('normal');
  await opening.locator('#openingStage.quality-normal').waitFor({ state: 'visible' });
  await desktop.locator('#openingEnabled').uncheck();
  await opening.locator('#openingStage.is-disabled').waitFor({ state: 'attached' });
  await desktop.locator('#openingEnabled').check();
  await opening.locator('#openingStage:not(.is-disabled)').waitFor({ state: 'visible' });
  await desktop.locator('#openingStyle').selectOption('classic');
  await opening.getByText('新的开播标题', { exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('spinbutton', { name: '宽度', exact: true }).fill('960');
  await page.getByRole('spinbutton', { name: '宽度', exact: true }).press('Tab');
  await page.getByRole('spinbutton', { name: '高度', exact: true }).fill('540');
  await page.getByRole('spinbutton', { name: '高度', exact: true }).press('Tab');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  await open();
  assert.equal(await page.locator('.scene-editor-item').count(), 1);
  const saved = fixture.service.list()[0];
  assert.deepEqual(saved.document.items.map(item => [item.type, item.width, item.height, item.appearance.config]),
    [['opening', 960, 540, { style: 'original' }]]);
  const source = fixture.service.getSource(saved.document.id);
  const outputUrl = `${fixture.origin}/scene?id=${source.id}#token=${source.token}`;
  assert.equal((await fetch(outputUrl)).status, 200);
  const output = await context.newPage();
  await output.goto(outputUrl);
  const published = output.frameLocator('.scene-version:not(.is-staging) iframe');
  await published.getByText('新的开播标题', { exact: true }).waitFor({ state: 'visible' });
  settings.openingEnabled = 'false';
  await published.locator('#openingStage.is-disabled').waitFor({ state: 'attached' });
  settings.openingEnabled = 'true';
  settings.openingStyle = 'pixel-cassette';
  await published.locator('#openingPixel').waitFor({ state: 'visible' });
  settings.openingStyle = 'classic';
  settings.openingTitle = '唱一首，在一首，给你的歌';
  await published.getByText(settings.openingTitle, { exact: true }).waitFor({ state: 'visible' });
  fs.mkdirSync('tmp', { recursive: true });
  await published.locator('body').screenshot({ path: 'tmp/opening-default.png', animations: 'disabled' });
  await page.bringToFront();
  await opening.getByText(settings.openingTitle, { exact: true }).waitFor({ state: 'visible' });
  await page.screenshot({ path: 'tmp/opening-canvas.png', animations: 'disabled' });
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  await page.locator('[data-category="opening"]').click();
  await page.locator('.preview-picker-styles img').evaluate(image => image.decode());
  assert.equal(await published.locator('body').evaluate(() => window.__API_TOKEN__), undefined);
  assert.deepEqual(childRequests, []);
  assert.deepEqual(errors, []);
});
