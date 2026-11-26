'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { startCanvasOutputFixture } = require('../helpers/canvas-output-fixture');
const { useSharedBrowser } = require('../helpers/shared-browser');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');
const { GIFT_DROP_EXIT_MS, GIFT_DROP_SPAWN_DELAY_MS } = require('../../public/js/shared/gift-drop-physics.js');

const openBrowserSession = useSharedBrowser();

async function openStandaloneSwing(t, getState = () => ({ settings: {} })) {
  const fixture = await startComponentPreviewServer({ getState });
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage();
  const url = `${fixture.origin}/gift-effects?giftStyle=gift-swing`;
  assert.equal((await fetch(url)).status, 200);
  const connected = page.waitForEvent('websocket').then(socket =>
    socket.waitForEvent('framereceived', { predicate: frame => JSON.parse(frame.payload).reason === 'connect' }));
  await page.goto(url);
  await connected;
  const start = Date.now();
  await page.clock.setFixedTime(start);
  function send(eventId, startedAt = start, userName = '观众') {
    fixture.broadcast({ type: 'gift:frame', themeId: 'gift-swing', eventId, startedAt,
      giftName: '星', userName, num: 1, totalPriceCents: 100, motion: { durationSeconds: 10 } });
  }
  return { page, start, send, broadcast: fixture.broadcast };
}

test('standalone swings discard the previous gift source and accept a reused event ID in the new one', async t => {
  const { page, send, broadcast } = await openStandaloneSwing(t);
  send('old');
  send('shared-id');
  await page.locator('[data-motion-id="shared-id"]').waitFor();
  broadcast({ type: 'snapshot', reason: 'gift:source', state: { settings: {} } });
  send('shared-id');
  send('new');
  await page.locator('[data-motion-id="new"]').waitFor();
  assert.deepEqual(await page.locator('.gift-swing-item').evaluateAll(nodes => nodes.map(n => n.dataset.motionId)),
    ['shared-id', 'new']);
});

test('same-source ledger updates preserve live stands and deduplication through a clear and rebuild', async t => {
  const { createGiftService } = require('../../src/bilibili/gift');
  const { createGiftExportRuntime } = require('../../src/server/gift-export-runtime');
  const { createRemoteGiftController } = require('../../src/electron/remote-gift-controller');
  const { createFixture } = require('../helpers/remote-gift-controller-fixture');
  const remote = createFixture();
  const ledger = require('../helpers/gift-query-fixture').createFixture();
  const gifts = createGiftService(ledger.context);
  let broadcast = () => {};
  const getState = () => ({ settings: {}, giftSourceEpoch: gifts.getDisplaySourceEpoch() });
  const notify = reason => broadcast({ type: 'snapshot', reason, state: getState() });
  const runtime = createGiftExportRuntime({ getServices: () => ({ gifts }), broadcastSnapshot: notify });
  const controller = createRemoteGiftController({ ...remote.options, runtime: {
    ...remote.options.runtime, setActiveGiftSource: runtime.setActiveGiftSource,
  } });
  t.after(() => { controller.dispose(); gifts.dispose(); ledger.close(); });
  await controller.start();
  const swing = await openStandaloneSwing(t, getState);
  broadcast = swing.broadcast;
  const names = () => swing.page.locator('.gift-swing-name').allTextContents();
  swing.send('shared', swing.start, 'Original A');
  await swing.page.locator('[data-motion-id="shared"]').waitFor();
  const active = gifts.getActiveSource();
  const selected = { sourceId: active.sourceId, displaySourceKey: remote.source.sourceKey };
  runtime.setActiveGiftSource({ ...selected, syncState: 'BOOTSTRAPPING' });
  runtime.setActiveGiftSource({ ...selected, syncState: 'CATCHING_UP' });
  notify('database:clear-gifts');
  await controller.start();
  swing.send('shared', swing.start, 'Duplicate A');
  swing.send('next', swing.start, 'Second A');
  await swing.page.locator('[data-motion-id="next"]').waitFor();
  assert.deepEqual(await names(), ['Original A', 'Second A']);

  remote.options.licenseManager.getCloudSyncIdentity = () => ({ accountName: 'bob', streamerId: 20 });
  await controller.start();
  swing.send('shared', swing.start, 'Owner B');
  await swing.page.getByText('Owner B', { exact: true }).waitFor();
  assert.deepEqual(await names(), ['Owner B']);
});

test('a hidden standalone swing source reclaims expired stands before admitting a new gift', async t => {
  const { page, start, send } = await openStandaloneSwing(t);
  for (let i = 0; i < 80; i++) send(`old-${i}`);
  await page.locator('[data-motion-id="old-79"]').waitFor();
  assert.equal(await page.locator('.gift-swing-item').count(), 80);
  const setHidden = hidden => page.evaluate(value => {
    Object.defineProperty(document, 'hidden', { configurable: true, value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  await setHidden(true);
  await page.clock.setFixedTime(start + 11000);
  send('fresh', start + 11000);
  await page.locator('[data-motion-id="fresh"]').waitFor({ state: 'attached', timeout: 3000 });
  await setHidden(false);
  await page.clock.setFixedTime(start + 11400);
  await page.waitForFunction(() => Number(document.querySelector('[data-motion-id="fresh"]')?.style.opacity) > 0.9);
  assert.equal(await page.locator('.gift-swing-item').count(), 1);
});

test('published motion layers isolate styles, retain settlement expiry through delayed images and never replay history', { timeout: 30000 }, async t => {
  const fixture = await startCanvasOutputFixture({ notifications: true });
  const browser = openBrowserSession();
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const errors = []; const childRequests = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  context.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/') && request.frame().parentFrame()) childRequests.push(request.url());
  });
  t.after(async () => { await browser.close(); await fixture.close();
    assert.deepEqual(errors, []); assert.deepEqual(childRequests, []); });
  const created = fixture.service.create({ title: '礼物动效', canvas: { width: 1920, height: 1080 } });
  const items = ['gift-drop', 'gift-swing'].map(style => ({
    id: randomUUID(), type: 'gift-frame', name: style, x: 0, y: 0, width: 1920, height: 1080, visible: true, locked: false,
    appearance: { mode: 'independent', config: { style } },
  }));
  const saved = fixture.service.save({ id: created.document.id, expectedRevision: created.revision,
    document: { ...created.document, items } });
  fixture.service.publish({ id: saved.document.id, expectedRevision: saved.revision });
  const source = fixture.service.getSource(saved.document.id);
  const url = `${fixture.origin}/scene?id=${source.id}#token=${source.token}`;
  assert.equal((await fetch(url)).status, 200);
  const page = await context.newPage();
  await page.goto(url);
  await page.locator('.scene-version:not(.is-staging) iframe').first().waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.scene-version:not(.is-staging) iframe').length === 2);
  const children = page.frames().filter(frame => frame.parentFrame());
  const [drop, swing] = children;
  assert.equal(await drop.locator('.gift-drop-item, .gift-swing-item').count(), 0);
  await drop.evaluate(() => { let calls = 0; Math.random = () => calls++ === 0 ? 0 : 0.999; });
  const startedAt = Date.now();
  await page.clock.setFixedTime(startedAt);
  const event = { type: 'gift:frame', eventId: 'drop-live', themeId: 'gift-drop',
    userName: '<观众>', giftName: '小花花', num: 4, totalPriceCents: 500,
    artworkPath: '/img/overlays/gift-feed/flower.webp', startedAt,
    motion: { size: 88, durationSeconds: 3, count: 12 } };
  let releaseImage;
  const imageGate = new Promise(resolve => { releaseImage = resolve; });
  await context.route('**/img/overlays/gift-feed/flower.webp', async route => {
    await imageGate;
    await route.fulfill({ contentType: 'image/webp', headers: { 'Access-Control-Allow-Origin': '*' },
      body: Buffer.from('UklGRoQAAABXRUJQVlA4WAoAAAACAAAAAwAAAwAAQU5JTQYAAAAAAAAAAABBTk1GKAAAAAAAAAAAAAMAAAMAAGQAAAJWUDhMDwAAAC8DwAAABxD9j/4HIqL/AQBBTk1GKAAAAAAAAAAAAAMAAAMAAGQAAABWUDhMDwAAAC8DwAAAB9D/iP4HIqL/AQA=', 'base64') });
  });
  fixture.receiveGift(event);
  fixture.receiveGift({ ...event, eventId: 'swing-live', themeId: 'gift-swing', motion: { size: 120, durationSeconds: 3, angle: 30 } });
  await drop.locator('.gift-drop-item').first().waitFor({ state: 'attached' });
  await page.clock.setFixedTime(startedAt + GIFT_DROP_SPAWN_DELAY_MS);
  await drop.locator('.gift-drop-item').first().waitFor();
  await swing.locator('.gift-swing-item').waitFor();
  assert.equal(await drop.locator('.gift-drop-item').count(), 12);
  assert.equal(await drop.locator('.gift-swing-item').count(), 0);
  assert.equal(await swing.locator('.gift-drop-item').count(), 0);
  assert.equal(await swing.locator('.gift-swing-name').textContent(), '<观众>');
  const dropDeadline = Number(await drop.locator('.gift-drop-item').first().getAttribute('data-expires-at'));
  assert.equal(dropDeadline, startedAt + 3000);
  assert.ok(await drop.locator('.gift-drop-item').evaluateAll((nodes, deadline) =>
    nodes.every(node => Number(node.dataset.expiresAt) === deadline), dropDeadline));
  assert.equal(await drop.locator('.gift-drop-item').first().evaluate(node => node.style.width), '88px');
  fixture.receiveGift(event);
  assert.equal(await drop.locator('.gift-drop-item').count(), 12);
  releaseImage();
  await drop.waitForFunction(() => [...document.querySelectorAll('.gift-motion-image')]
    .every(image => image.src.startsWith('data:image/webp') && image.naturalWidth > 0));
  const frozen = await drop.locator('.gift-motion-image').first().evaluate(image => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    return { src: image.src, pixel: [...context.getImageData(0, 0, 1, 1).data] };
  });
  assert.equal(Buffer.from(frozen.src.split(',')[1], 'base64').includes(Buffer.from('ANIM')), false);
  assert.ok(frozen.pixel[0] > 240 && frozen.pixel[1] < 15 && frozen.pixel[2] < 15, 'the static WebP retains the red first frame');
  await swing.waitForFunction(() => document.querySelector('.gift-motion-image')?.src.startsWith('data:image/webp'));
  assert.equal(await swing.locator('.gift-motion-image').first().getAttribute('src'), frozen.src);
  assert.equal(Number(await drop.locator('.gift-drop-item').first().getAttribute('data-expires-at')), dropDeadline);
  const endedAt = await drop.locator('.gift-drop-item').evaluateAll((nodes, exitMs) =>
    Math.ceil(Math.max(...nodes.map(node => Number(node.dataset.expiresAt))) + exitMs), GIFT_DROP_EXIT_MS);
  await page.clock.setFixedTime(endedAt);
  await drop.waitForFunction(() => !document.querySelector('.gift-drop-item'), null, { timeout: 5000 });
  await swing.locator('.gift-swing-item').waitFor({ state: 'detached', timeout: 5000 });
  fixture.receiveGift({ ...event, eventId: 'drop-too-late' });
  for (const [textMode, text] of [['gift', '小花花 ×4'], ['none', ''], ['name-quantity', '<观众>×4']]) {
    fixture.receiveGift({ ...event, eventId: `swing-${textMode}`, themeId: 'gift-swing', startedAt: endedAt,
      motion: { size: 120, durationSeconds: 3, angle: 30, speed: 150, textMode } });
    const card = swing.locator(`[data-motion-id="swing-${textMode}"]`);
    await card.waitFor();
    assert.equal(await card.textContent(), text);
    assert.equal(await card.locator('img').count(), 1);
  }
  assert.equal(await drop.locator('.gift-drop-item').count(), 0);

  let releaseLateImage;
  const lateImageGate = new Promise(resolve => { releaseLateImage = resolve; });
  await context.route('**/img/overlays/gift-feed/cheer.webp', async route => {
    await lateImageGate;
    await route.fulfill({ contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' },
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>' });
  });
  fixture.receiveGift({ ...event, eventId: 'late-artwork', startedAt: endedAt,
    artworkPath: '/img/overlays/gift-feed/cheer.webp', motion: { size: 88, durationSeconds: 3, count: 1 } });
  const lateDrop = drop.locator('[data-motion-id="late-artwork:0"]');
  await lateDrop.waitFor({ state: 'attached', timeout: 5000 });
  await page.clock.setFixedTime(endedAt + GIFT_DROP_SPAWN_DELAY_MS);
  await drop.waitForFunction(() => {
    const node = document.querySelector('[data-motion-id="late-artwork:0"]');
    return node && Number(node.style.transform.match(/translate\([^,]+,\s*([^p]+)px\)/)?.[1]) > 0;
  }, null, { timeout: 5000 });
  assert.equal(await lateDrop.locator('img').evaluate(image => image.hidden), true);
  await page.clock.setFixedTime(endedAt + 3000);
  await lateDrop.waitFor({ state: 'hidden', timeout: 5000 });
  releaseLateImage();
  await drop.waitForFunction(() => {
    const node = document.querySelector('[data-motion-id="late-artwork:0"]');
    return !node || node.querySelector('img').src.startsWith('data:image/webp');
  }, null, { timeout: 5000 });
  assert.equal(await lateDrop.isVisible(), false, 'artwork first loaded after expiry must not appear during fade-out');

  await drop.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hiddenAt = endedAt + 3000;
  const pending = { ...event, startedAt: hiddenAt, motion: { ...event.motion, count: 100 } };
  fixture.receiveGift({ ...pending, eventId: 'hidden-old' });
  await drop.locator('[data-motion-id="hidden-old:0"]').waitFor({ state: 'attached', timeout: 5000 });
  await page.clock.setFixedTime(hiddenAt + 3000);
  fixture.receiveGift({ ...pending, eventId: 'hidden-new', startedAt: hiddenAt + 3000 });
  await drop.locator('[data-motion-id="hidden-new:0"]').waitFor({ state: 'attached', timeout: 5000 });
  assert.equal(await drop.locator('.gift-drop-item').count(), 100,
    'new arrivals reclaim expired nodes while animation is paused in a hidden page');
  await page.reload();
  await page.locator('.scene-version:not(.is-staging) iframe').first().waitFor();
  for (const child of page.frames().filter(frame => frame.parentFrame())) {
    assert.equal(await child.locator('.gift-drop-item, .gift-swing-item').count(), 0);
    assert.equal(await child.evaluate(() => window.__API_TOKEN__), undefined);
  }
});
