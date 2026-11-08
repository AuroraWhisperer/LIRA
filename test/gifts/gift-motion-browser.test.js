'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { startCanvasOutputFixture } = require('../helpers/canvas-output-fixture');
const { useSharedBrowser } = require('../helpers/shared-browser');

const openBrowserSession = useSharedBrowser();

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
  const startedAt = Date.now();
  const event = { type: 'gift:frame', eventId: 'drop-live', themeId: 'gift-drop',
    userName: '<观众>', giftName: '小花花', num: 4, totalPriceCents: 500,
    artworkPath: '/img/overlays/gift-feed/flower.webp', startedAt,
    motion: { size: 88, durationSeconds: 3, quantityMultiplier: 2 } };
  let releaseImage;
  const imageGate = new Promise(resolve => { releaseImage = resolve; });
  await context.route('**/img/overlays/gift-feed/flower.webp', async route => {
    await imageGate;
    await route.fulfill({ contentType: 'image/webp', headers: { 'Access-Control-Allow-Origin': '*' },
      body: Buffer.from('UklGRoQAAABXRUJQVlA4WAoAAAACAAAAAwAAAwAAQU5JTQYAAAAAAAAAAABBTk1GKAAAAAAAAAAAAAMAAAMAAGQAAAJWUDhMDwAAAC8DwAAABxD9j/4HIqL/AQBBTk1GKAAAAAAAAAAAAAMAAAMAAGQAAABWUDhMDwAAAC8DwAAAB9D/iP4HIqL/AQA=', 'base64') });
  });
  fixture.receiveGift(event);
  fixture.receiveGift({ ...event, eventId: 'swing-live', themeId: 'gift-swing', motion: { size: 120, durationSeconds: 3, angle: 30 } });
  await drop.locator('.gift-drop-item').first().waitFor();
  await swing.locator('.gift-swing-item').waitFor();
  assert.equal(await drop.locator('.gift-drop-item').count(), 8);
  assert.equal(await drop.locator('.gift-swing-item').count(), 0);
  assert.equal(await swing.locator('.gift-drop-item').count(), 0);
  assert.equal(await swing.locator('.gift-swing-name').textContent(), '<观众>');
  const dropDeadline = Number(await drop.locator('.gift-drop-item').first().getAttribute('data-expires-at'));
  assert.equal(await drop.locator('.gift-drop-item').first().evaluate(node => node.style.width), '88px');
  fixture.receiveGift(event);
  assert.equal(await drop.locator('.gift-drop-item').count(), 8);
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
  await drop.waitForFunction(() => !document.querySelector('.gift-drop-item'), null, { timeout: 5000 });
  await swing.locator('.gift-swing-item').waitFor({ state: 'detached', timeout: 5000 });
  for (const [textMode, text] of [['gift', '小花花 ×4'], ['none', ''], ['name-quantity', '<观众>×4']]) {
    fixture.receiveGift({ ...event, eventId: `swing-${textMode}`, themeId: 'gift-swing', startedAt: Date.now(),
      motion: { size: 120, durationSeconds: 3, angle: 30, speed: 150, textMode } });
    const card = swing.locator(`[data-motion-id="swing-${textMode}"]`);
    await card.waitFor();
    assert.equal(await card.textContent(), text);
    assert.equal(await card.locator('img').count(), 1);
  }
  await page.reload();
  await page.locator('.scene-version:not(.is-staging) iframe').first().waitFor();
  for (const child of page.frames().filter(frame => frame.parentFrame())) {
    assert.equal(await child.locator('.gift-drop-item, .gift-swing-item').count(), 0);
    assert.equal(await child.evaluate(() => window.__API_TOKEN__), undefined);
  }
});
