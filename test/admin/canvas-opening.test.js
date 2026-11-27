'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { chromium } = require('playwright');
const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');

test('opening settings preview reuses a canvas layer and published output follows opening configuration', { timeout: 60000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const settings = fixture.runtime.settings;
  Object.assign(settings, { openingEnabled: 'true', openingStyle: 'classic', openingQuality: 'high', openingTitle: '开播准备中', openingName: 'LIRA' });
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
  const updateSettings = async patch => {
    const response = await context.request.post(`${fixture.origin}/api/settings`, {
      headers: { Authorization: `Bearer ${fixture.token}` }, data: patch,
    });
    assert.equal(response.status(), 200);
  };
  await desktop.evaluate(async ({ html, token }) => {
    window.__API_TOKEN__ = token;
    const { stateService } = await import('/js/admin/state.js');
    stateService.connectSocket();
    document.body.append(new DOMParser().parseFromString(html, 'text/html').body.firstElementChild);
    document.querySelector('#openingAnimationForm').closest('section').hidden = false;
    const { initStartAnimation } = await import('/js/admin/start-animation.js');
    initStartAnimation();
  }, { html: fs.readFileSync('public/pages/admin/toolbox/start-animation.html', 'utf8'), token: fixture.token });
  const open = async () => {
    await desktop.evaluate(() => { window.externalPreviewUrl = ''; });
    const focus = desktop.waitForResponse(response => new URL(response.url()).pathname === '/api/component-preview'
      && response.request().postDataJSON()?.action === 'focus' && response.status() === 200);
    await desktop.locator('#openingPreviewBtn').click();
    const { data } = await (await focus).json();
    if (!data.focused) {
      await desktop.waitForFunction(() => window.externalPreviewUrl);
      const url = await desktop.evaluate(() => window.externalPreviewUrl);
      assert.equal((await fetch(url)).status, 200);
      await page.goto(url);
    }
    await page.waitForFunction(() => document.querySelector('.scene-editor-item.is-selected .component-preview-load-state')?.hidden);
  };
  await open();
  const opening = page.frameLocator('.scene-editor-item.is-selected iframe');
  await opening.locator('#openingStage:not(.is-disabled)').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.scene-editor-item').count(), 1);
  const title = '新的开播标题';
  const releaseTitle = Promise.withResolvers();
  const holdTitle = async route => {
    if (route.request().postDataJSON()?.openingTitle === title) await releaseTitle.promise;
    await route.fallback();
  };
  await desktop.route('**/api/settings', holdTitle);
  try {
    const [titleRequest] = await Promise.all([
      desktop.waitForRequest(request => request.url().endsWith('/api/settings') && request.postDataJSON()?.openingTitle === title),
      desktop.locator('#openingTitle').fill(title),
    ]);
    const [qualityResponse] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/component-preview/opening/config'
        && response.request().postDataJSON()?.quality === 'normal'),
      page.locator('[data-opening-parameter="quality"]').selectOption('normal'),
    ]);
    assert.equal(qualityResponse.status(), 200);
    assert.equal(settings.openingQuality, 'normal');
    releaseTitle.resolve();
    assert.equal((await titleRequest.response())?.status(), 200);
    assert.equal(settings.openingTitle, title);
    assert.equal(settings.openingQuality, 'normal');
  } finally {
    releaseTitle.resolve();
    await desktop.unroute('**/api/settings', holdTitle);
  }
  await opening.getByText(title, { exact: true }).waitFor({ state: 'visible' });
  const disabled = desktop.waitForResponse(response => response.url().endsWith('/api/settings')
    && response.request().postDataJSON()?.openingEnabled === 'false' && response.ok());
  await desktop.locator('#openingEnabled').uncheck();
  await disabled;
  await opening.locator('#openingStage:not(.is-disabled)').waitFor({ state: 'visible' });
  await desktop.locator('#openingEnabled').check();
  await desktop.getByRole('button', { name: '像素卡带', exact: true }).click();
  await opening.locator('#openingPixel').waitFor({ state: 'visible' });
  await desktop.getByRole('button', { name: '经典舞台', exact: true }).click();
  await opening.getByText(title, { exact: true }).waitFor({ state: 'visible' });
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
  await published.getByText(title, { exact: true }).waitFor({ state: 'visible' });
  await updateSettings({ openingEnabled: 'false' });
  await published.locator('#openingStage.is-disabled').waitFor({ state: 'attached' });
  await updateSettings({ openingEnabled: 'true', openingStyle: 'pixel-cassette' });
  await published.locator('#openingPixel').waitFor({ state: 'visible' });
  const updatedTitle = '另一端保存的开播标题';
  await updateSettings({ openingStyle: 'classic', openingTitle: updatedTitle });
  await published.getByText(updatedTitle, { exact: true }).waitFor({ state: 'visible' });
  await page.bringToFront();
  await opening.getByText(updatedTitle, { exact: true }).waitFor({ state: 'visible' });
  assert.equal(await published.locator('body').evaluate(() => window.__API_TOKEN__), undefined);
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  await page.locator('[data-category="opening"]').click();
  await page.getByRole('button', { name: '添加经典舞台', exact: true }).click();
  await opening.locator('#openingStage[data-style="classic"]').waitFor({ state: 'visible' });
  await updateSettings({ openingStyle: 'pixel-cassette' });
  const following = page.locator('.scene-editor-item').first().frameLocator('iframe');
  await following.locator('#openingPixel').waitFor({ state: 'visible' });
  assert.equal(await opening.locator('#openingStage').getAttribute('data-style'), 'classic');
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  await page.locator('[data-category="opening"]').click();
  await page.getByRole('button', { name: '添加像素卡带', exact: true }).click();
  await opening.locator('#openingPixel').waitFor({ state: 'visible' });
  await updateSettings({ openingStyle: 'classic' });
  await following.locator('#openingStage[data-style="classic"]').waitFor({ state: 'visible' });
  assert.equal(await opening.locator('#openingStage').getAttribute('data-style'), 'pixel-cassette');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  assert.deepEqual(fixture.service.list()[0].document.items.map(item => item.appearance.config.style),
    ['original', 'classic', 'pixel-cassette']);
  await published.nth(1).locator('#openingStage[data-style="classic"]').waitFor({ state: 'visible' });
  await published.nth(2).locator('#openingPixel').waitFor({ state: 'visible' });
  assert.deepEqual(childRequests, []);
  assert.deepEqual(errors, []);
});
