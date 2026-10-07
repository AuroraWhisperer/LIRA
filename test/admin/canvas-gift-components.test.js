'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');
const { useSharedBrowser } = require('../helpers/shared-browser');

const openBrowserSession = useSharedBrowser();

test('sprint opens from wishes, saves a canvas layer and follows live goals without child requests', { timeout: 40000 }, async t => {
  const fixture = await startCanvasOutputFixture({ extraContext: {}, notifications: true });
  fixture.runtime.giftSprint = { targetRmb: 1000, remainingCrystalBalls: 7 };
  const browser = openBrowserSession();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  const childRequests = [];
  const sockets = [];
  context.on('page', target => {
    target.setDefaultTimeout(6000);
    target.on('pageerror', error => errors.push(error.message));
    target.on('websocket', socket => sockets.push(socket.url()));
  });
  context.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/') && request.frame().parentFrame()) childRequests.push(request.url());
  });
  t.after(async () => { await browser.close(); await fixture.close();
    assert.deepEqual(errors, []); assert.deepEqual(childRequests, []); assert.deepEqual(sockets, []); });
  const desktop = await context.newPage();
  const page = await context.newPage();
  await openCanvasDesktop(desktop, fixture);
  await desktop.evaluate(async html => {
    document.body.innerHTML = html;
    document.getElementById('giftWishesPanel').hidden = false;
    const { initGiftSprintOverlay } = await import('/js/admin/gifts/sprint-overlay.js');
    initGiftSprintOverlay();
    window.externalPreviewUrl = '';
  }, fs.readFileSync('public/pages/admin/toolbox/gift-wishes.html', 'utf8'));
  await desktop.locator('#giftSprintOverlayPanel > summary').click();
  await desktop.evaluate(async () => {
    const { renderGiftSprintOverlay } = await import('/js/admin/gifts/sprint-overlay.js');
    renderGiftSprintOverlay({ targetRmb: 1000, remainingCrystalBalls: 7 });
  });
  await desktop.locator('#giftSprintPreview').click();
  await desktop.waitForFunction(() => window.externalPreviewUrl);
  const url = await desktop.evaluate(() => window.externalPreviewUrl);
  assert.equal(new URL(url).pathname, '/c');
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  const preview = page.frameLocator('.scene-editor-item[data-component="gift-sprint"] iframe');
  await preview.getByText('还差 100 个水晶球', { exact: true }).waitFor();
  assert.equal(await page.locator('.scene-editor-item[data-component="gift-sprint"]').count(), 1);
  const itemBounds = await page.locator('.scene-editor-item[data-component="gift-sprint"]').boundingBox();
  const labelBounds = await page.locator('.scene-editor-item[data-component="gift-sprint"] .scene-editor-item-label').boundingBox();
  assert.ok(labelBounds.y + labelBounds.height <= itemBounds.y, 'The canvas label does not cover the sprint text.');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  const saved = fixture.service.list()[0];
  assert.deepEqual(saved.document.items.map(item => [item.type, item.width, item.height, item.appearance]),
    [['gift-sprint', 600, 80, { mode: 'independent', config: {} }]]);
  const source = fixture.service.getSource(saved.document.id);
  const outputUrl = `${fixture.origin}/scene?id=${source.id}#token=${source.token}`;
  assert.equal((await fetch(outputUrl)).status, 200);
  const output = await context.newPage();
  await output.goto(outputUrl);
  const live = output.frameLocator('.scene-version:not(.is-staging) iframe');
  for (const remainingCrystalBalls of [7, 3, 0, 10]) {
    fixture.runtime.giftSprint.remainingCrystalBalls = remainingCrystalBalls;
    fixture.notify({ types: ['gift-sprint'] });
    await live.getByText(`还差 ${remainingCrystalBalls} 个水晶球`, { exact: true }).waitFor();
  }
  fixture.runtime.giftSprint = { targetRmb: 0, remainingCrystalBalls: 0 };
  fixture.notify({ types: ['gift-sprint'] });
  await live.locator('#giftSprintText').waitFor({ state: 'hidden' });
  fixture.runtime.giftSprint = { targetRmb: 1000, remainingCrystalBalls: 2 };
  fixture.notify({ types: ['gift-sprint'] });
  await live.getByText('还差 2 个水晶球', { exact: true }).waitFor();
  await output.route('**/api/scene/output*', route => route.fulfill({ status: 503, json: { ok: false } }));
  fixture.notify({ types: ['gift-sprint'] });
  await live.locator('#giftSprintText').waitFor({ state: 'hidden' });
  await output.unroute('**/api/scene/output*');
  await live.getByText('还差 2 个水晶球', { exact: true }).waitFor();
  await desktop.evaluate(() => { window.externalPreviewUrl = ''; });
  const focused = desktop.waitForResponse(response => new URL(response.url()).pathname === '/api/component-preview'
    && response.request().postDataJSON()?.action === 'focus' && response.status() === 200);
  await desktop.locator('#giftSprintPreview').click();
  assert.equal((await (await focused).json()).data.focused, true);
  assert.equal(await desktop.evaluate(() => window.externalPreviewUrl), '');
  assert.equal(page.url(), url);
  await page.reload();
  await preview.getByText('还差 100 个水晶球', { exact: true }).waitFor();
  assert.equal(await page.locator('.scene-editor-item[data-component="gift-sprint"]').count(), 1);
});

test('gift settings open separate canvas layers that save, preview and receive only their live effects', { timeout: 60000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = openBrowserSession();
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
    const focus = desktop.waitForResponse(response => new URL(response.url()).pathname === '/api/component-preview'
      && response.request().postDataJSON()?.action === 'focus' && response.status() === 200);
    await desktop.locator(id).click();
    const { data } = await (await focus).json();
    if (!data.focused) {
      await desktop.waitForFunction(() => window.externalPreviewUrl);
      const url = await desktop.evaluate(() => window.externalPreviewUrl);
      assert.equal((await fetch(url)).status, 200);
      await page.goto(url);
    }
    await page.locator(`.scene-editor-item.is-selected[data-component="${id.startsWith('#giftFrame') ? 'gift-frame' : 'guard-thanks'}"]`).waitFor();
    await page.waitForFunction(() => document.querySelector('.scene-editor-item.is-selected .component-preview-load-state')?.hidden);
  };
  await desktop.locator('#giftFramePreviewUser').fill('林间听风');
  await desktop.locator('#giftFramePreviewGift').fill('小花花');
  await desktop.locator('#giftFramePreviewNum').fill('8');
  await open('#giftFramePreviewBtn');
  assert.equal(await page.locator('.scene-editor-item').count(), 1);
  const framePreview = page.frameLocator('.scene-editor-item.is-selected iframe');
  await framePreview.locator('#giftFrame.is-playing').waitFor({ state: 'visible' });
  await framePreview.locator('#giftInfoAvatar[alt="林间听风的头像"]').waitFor({ state: 'visible' });
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
  await framePreview.locator('#giftInfoAvatar[alt="新的观众的头像"]').waitFor({ state: 'visible' });
  await framePreview.getByText('打call', { exact: true }).waitFor({ state: 'visible' });
  assert.equal((await framePreview.locator('body').evaluate(() => window.receivedGiftEvents.at(-1))).num, 3);
  assert.equal(await desktop.locator('[data-gift-frame-effect]').count(), 1);
  await desktop.locator('#guardThanksClassicPreviewTier').selectOption('admiral');
  await desktop.locator('#guardThanksClassicPreviewUser').fill('上舰观众');
  await desktop.locator('#guardThanksClassicPreviewMonths').fill('6');
  await desktop.locator('#guardThanksClassicTextMode').selectOption('zh');
  await open('#guardThanksClassicPlayBtn');
  assert.equal(await page.locator('.scene-editor-item').count(), 2);
  const guardPreview = page.frameLocator('.scene-editor-item.is-selected iframe');
  await guardPreview.locator('.gt-card[data-tier="admiral"].is-live').waitFor({ state: 'visible' });
  assert.equal(await guardPreview.locator('.gt-name').textContent(), '上舰观众');
  assert.equal(await guardPreview.locator('.gt-months').textContent(), '6 个月');
  assert.equal(await page.locator('[data-preview-parameter="tier"]').inputValue(), 'admiral');
  assert.equal(await page.getByRole('textbox', { name: '预览观众', exact: true }).inputValue(), '上舰观众');
  assert.equal(await page.getByRole('spinbutton', { name: '预览月数', exact: true }).inputValue(), '6');
  assert.equal(await guardPreview.locator('#giftFrame.is-playing').count(), 0);
  assert.equal(await page.locator('[data-component-parameter="textMode"]').inputValue(), 'follow');
  await desktop.locator('#guardThanksAuroraTextMode').selectOption('en');
  await desktop.locator('#guardThanksAuroraPreviewTier').selectOption('governor');
  await desktop.locator('#guardThanksAuroraPreviewMonths').fill('9');
  await open('#guardThanksAuroraPlayBtn');
  await guardPreview.locator('.gta-card[data-tier="governor"][data-lang="en"]').waitFor();
  assert.equal(await page.locator('.scene-editor-item').count(), 2, 'both style previews reuse the guard component');
  await open('#guardThanksClassicPlayBtn');
  await guardPreview.locator('.gt-card[data-tier="admiral"][data-lang="zh"]').waitFor();
  const beforeGuardPreview = await desktop.evaluate(() => window.controllers.canvas.getState().draft.document);
  await page.getByRole('textbox', { name: '预览观众', exact: true }).fill('星河旅人');
  const previewMonths = page.getByRole('spinbutton', { name: '预览月数', exact: true });
  await previewMonths.fill('12');
  await previewMonths.press('Tab');
  for (const [tier, title] of [['captain', '舰长'], ['governor', '总督']]) {
    await page.getByRole('button', { name: '预览等级', exact: true }).click();
    await page.getByRole('option', { name: title, exact: true }).click();
    await guardPreview.locator(`.gt-card[data-tier="${tier}"].is-live`).waitFor({ state: 'visible' });
    assert.equal(await guardPreview.locator('.gt-ribbon-title').textContent(), title);
    assert.equal(await guardPreview.locator('.gt-name').textContent(), '星河旅人');
    assert.equal(await guardPreview.locator('.gt-months').textContent(), '12 个月');
    assert.equal(await guardPreview.locator('.gt-card').count(), 1);
  }
  assert.deepEqual(await desktop.evaluate(() => window.controllers.canvas.getState().draft.document), beforeGuardPreview,
    'previewing a guard tier, viewer and month count does not edit the scene');
  await page.locator('[data-component-parameter="textMode"]').selectOption('en');
  await guardPreview.locator('.gt-card[data-tier="governor"][data-lang="en"]').waitFor();
  assert.equal(await guardPreview.locator('.gt-name').textContent(), '星河旅人');
  assert.equal(await guardPreview.locator('.gt-months').textContent(), '12 MONTHS');
  await page.locator('.scene-editor-item[data-component="gift-frame"]').press('Enter');
  await page.locator('.scene-editor-item[data-component="guard-thanks"]').press('Enter');
  assert.equal(await page.locator('[data-preview-parameter="tier"]').inputValue(), 'governor');
  assert.equal(await page.getByRole('textbox', { name: '预览观众', exact: true }).inputValue(), '星河旅人');
  assert.equal(await previewMonths.inputValue(), '12');
  await page.getByRole('spinbutton', { name: '宽度', exact: true }).fill('640');
  await page.getByRole('spinbutton', { name: '宽度', exact: true }).press('Tab');
  await page.getByRole('spinbutton', { name: '高度', exact: true }).fill('540');
  await page.getByRole('spinbutton', { name: '高度', exact: true }).press('Tab');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  const saved = fixture.service.list()[0];
  assert.doesNotMatch(JSON.stringify(saved), /林间听风|新的观众|上舰观众|星河旅人|previewData/, 'simulated input is not saved into the scene');
  assert.deepEqual(saved.document.items.map(item => [item.type, item.width, item.height]),
    [['gift-frame', 960, 540], ['guard-thanks', 640, 540]]);
  assert.deepEqual(saved.document.items[1].appearance.config, { textMode: 'en' });
  await desktop.evaluate(() => { window.externalPreviewUrl = ''; });
  await desktop.locator('#guardThanksClassicPreviewMonths').fill('0');
  await desktop.locator('#guardThanksClassicPlayBtn').click();
  assert.equal(await desktop.locator('#guardThanksClassicSaveState').textContent(), '预览月数需为 1–999 的整数。');
  assert.equal(await desktop.evaluate(() => window.externalPreviewUrl), '', 'invalid preview input does not open the canvas');
  await desktop.locator('#guardThanksClassicPreviewTier').selectOption('captain');
  await desktop.locator('#guardThanksClassicPreviewUser').fill('新的上舰观众');
  await desktop.locator('#guardThanksClassicPreviewMonths').fill('24');
  await open('#guardThanksClassicPlayBtn');
  assert.equal(await page.locator('.scene-editor-item').count(), 2, 'reopening selects the existing component');
  await guardPreview.locator('.gt-card[data-tier="captain"].is-live').waitFor({ state: 'visible' });
  assert.equal(await guardPreview.locator('.gt-name').textContent(), '新的上舰观众');
  assert.equal(await guardPreview.locator('.gt-months').textContent(), '24 MONTHS');
  assert.equal(await page.locator('[data-preview-parameter="tier"]').inputValue(), 'captain');
  assert.equal(await previewMonths.inputValue(), '24');
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
  assert.equal(await guardOutput.locator('.gt-card, .gta-card').count(), 0, 'published output never plays samples');
  fixture.receiveGift({ type: 'gift:frame', eventId: 'live-frame-1', userName: '边框观众', giftName: '真实礼物',
    num: 2, totalPriceCents: 2000, themeId: 'woodland-bloom' });
  fixture.receiveGift({ type: 'gift:guard-thanks', eventId: 'live-guard-1', userName: '感谢观众', tier: 'admiral', months: 2,
    textMode: 'zh', style: 'classic' });
  await frameOutput.locator('#giftInfoAvatar[alt="边框观众的头像"]').waitFor({ state: 'visible' });
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
