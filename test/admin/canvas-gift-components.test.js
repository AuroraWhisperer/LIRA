'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { chromium } = require('playwright');
const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');

test('gift settings open separate canvas layers that save, preview and receive only their live effects', { timeout: 60000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const desktop = await context.newPage();
  const page = await context.newPage();
  const errors = [];
  const childRequests = [];
  const sockets = [];
  t.after(async () => { await browser.close(); await fixture.close();
    assert.deepEqual(errors, []); assert.deepEqual(childRequests, []); assert.deepEqual(sockets, []); });
  context.on('page', target => {
    target.on('pageerror', error => errors.push(error.message));
    target.on('websocket', socket => sockets.push(socket.url()));
  });
  for (const target of [desktop, page]) {
    target.setDefaultTimeout(7000);
    target.on('pageerror', error => errors.push(error.message));
    target.on('websocket', socket => sockets.push(socket.url()));
  }
  context.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/') && request.frame().parentFrame()) childRequests.push(request.url());
  });
  await context.addInitScript(() => {
    window.receivedGiftEvents = [];
    window.addEventListener('message', event => {
      if (event.data?.type === 'component-preview:data') window.receivedGiftEvents.push(...event.data.data?.events || []);
    });
  });
  await openCanvasDesktop(desktop, fixture);
  await desktop.evaluate(async html => {
    document.body.append(new DOMParser().parseFromString(html, 'text/html').body.firstElementChild);
    for (const node of document.querySelectorAll('[hidden]')) node.hidden = false;
    const { initGiftFrame } = await import('/js/admin/gift-frame.js');
    const { initGuardThanks } = await import('/js/admin/gift-guard-thanks.js');
    initGiftFrame(); initGuardThanks();
  }, fs.readFileSync('public/pages/admin/toolbox/gift.html', 'utf8'));
  const open = async id => {
    await desktop.evaluate(() => { window.externalPreviewUrl = ''; });
    await desktop.locator(id).click();
    await desktop.waitForFunction(() => window.externalPreviewUrl);
    const url = await desktop.evaluate(() => window.externalPreviewUrl);
    assert.equal((await fetch(url)).status, 200);
    await page.goto('about:blank');
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('.scene-editor-item.is-selected .component-preview-load-state')?.hidden);
  };
  await desktop.locator('#giftFramePreviewUser').fill('林间听风');
  await desktop.locator('#giftFramePreviewGift').fill('小花花');
  await desktop.locator('#giftFramePreviewNum').fill('8');
  await open('#giftFramePreviewBtn');
  assert.equal(await page.locator('.scene-editor-item').count(), 1);
  const framePreview = page.frameLocator('.scene-editor-item.is-selected iframe');
  await framePreview.locator('#giftFrame.is-playing').waitFor({ state: 'visible' });
  await framePreview.getByText('林间听风', { exact: true }).waitFor({ state: 'visible' });
  await framePreview.getByText('小花花', { exact: true }).waitFor({ state: 'visible' });
  assert.equal((await framePreview.locator('body').evaluate(() => window.receivedGiftEvents.at(-1))).num, 8);
  assert.equal(await framePreview.locator('.gt-card').count(), 0);
  await page.getByRole('spinbutton', { name: '宽度', exact: true }).fill('960');
  await page.getByRole('spinbutton', { name: '宽度', exact: true }).press('Tab');
  await page.getByRole('spinbutton', { name: '高度', exact: true }).fill('540');
  await page.getByRole('spinbutton', { name: '高度', exact: true }).press('Tab');
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items[0]?.height === 540);
  await desktop.locator('#giftFramePreviewUser').fill('新的观众');
  await desktop.locator('#giftFramePreviewGift').fill('打call');
  await desktop.locator('#giftFramePreviewNum').fill('3');
  await open('#giftFramePreviewBtn');
  assert.equal(await page.locator('.scene-editor-item').count(), 1, 'changing the sample reuses the frame component');
  await framePreview.getByText('新的观众', { exact: true }).waitFor({ state: 'visible' });
  await framePreview.getByText('打call', { exact: true }).waitFor({ state: 'visible' });
  assert.equal((await framePreview.locator('body').evaluate(() => window.receivedGiftEvents.at(-1))).num, 3);
  await open('#guardThanksPlayBtn');
  assert.equal(await page.locator('.scene-editor-item').count(), 2);
  const guardPreview = page.frameLocator('.scene-editor-item.is-selected iframe');
  await guardPreview.locator('.gt-card.is-live').waitFor({ state: 'visible' });
  assert.equal(await guardPreview.locator('#giftFrame.is-playing').count(), 0);
  await page.locator('[data-component-parameter="textMode"]').selectOption('en');
  await guardPreview.locator('.gt-card[data-lang="en"]').waitFor();
  await page.getByRole('spinbutton', { name: '宽度', exact: true }).fill('640');
  await page.getByRole('spinbutton', { name: '宽度', exact: true }).press('Tab');
  await page.getByRole('spinbutton', { name: '高度', exact: true }).fill('540');
  await page.getByRole('spinbutton', { name: '高度', exact: true }).press('Tab');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  const saved = fixture.service.list()[0];
  assert.doesNotMatch(JSON.stringify(saved), /林间听风|新的观众|previewData/, 'simulated input is not saved into the scene');
  assert.deepEqual(saved.document.items.map(item => [item.type, item.width, item.height]),
    [['gift-frame', 960, 540], ['guard-thanks', 640, 540]]);
  assert.equal(saved.document.items[1].appearance.config.textMode, 'en');
  await open('#guardThanksPlayBtn');
  assert.equal(await page.locator('.scene-editor-item').count(), 2, 'reopening selects the existing component');
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  for (const type of ['gift-frame', 'guard-thanks']) {
    await page.locator(`[data-category="${type}"]`).click();
    await page.locator('.preview-picker-styles img').evaluate(image => image.decode());
  }
  const source = fixture.service.getSource(saved.document.id);
  const outputUrl = `${fixture.origin}/scene?id=${source.id}#token=${source.token}`;
  assert.equal((await fetch(outputUrl)).status, 200);
  const output = await context.newPage();
  await output.goto(outputUrl);
  await output.locator('.scene-version:not(.is-staging) iframe').first().waitFor();
  const frameOutput = output.frames().find(frame => frame.url().includes('giftComponent=frame'));
  const guardOutput = output.frames().find(frame => frame.url().includes('giftComponent=guard'));
  assert.equal(await frameOutput.locator('#giftFrame.is-playing').count(), 0);
  assert.equal(await guardOutput.locator('.gt-card').count(), 0, 'published output never plays samples');
  fixture.receiveGift({ type: 'gift:frame', eventId: 'live-frame-1', userName: '边框观众', giftName: '真实礼物',
    num: 2, totalPriceCents: 2000, themeId: 'woodland-bloom' });
  fixture.receiveGift({ type: 'gift:guard-thanks', eventId: 'live-guard-1', userName: '感谢观众', tier: 'admiral', months: 2, textMode: 'zh' });
  await frameOutput.getByText('边框观众', { exact: true }).waitFor({ state: 'visible' });
  await guardOutput.locator('.gt-card[data-tier="admiral"][data-lang="en"]').waitFor({ state: 'visible' });
  await output.waitForTimeout(1700);
  assert.deepEqual(await frameOutput.evaluate(() => window.receivedGiftEvents.map(event => event.eventId)), ['live-frame-1']);
  assert.deepEqual(await guardOutput.evaluate(() => window.receivedGiftEvents.map(event => event.eventId)), ['live-guard-1']);
  await output.reload();
  await output.locator('.scene-version:not(.is-staging) iframe').first().waitFor();
  await output.waitForTimeout(1000);
  for (const child of output.frames().filter(frame => frame.parentFrame())) {
    assert.deepEqual(await child.evaluate(() => window.receivedGiftEvents), [], 'refresh starts at current events');
    assert.equal(await child.evaluate(() => window.__API_TOKEN__), undefined);
  }
});
