'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');

async function setup(t) {
  const root = path.resolve(__dirname, '../../tmp');
  fs.mkdirSync(root, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(root, 'component-style-browser-'));
  const fixture = await startCanvasOutputFixture({ dataDir });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await fixture.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const media = { name: 'frame.webp', mimeType: 'image/webp',
    buffer: fs.readFileSync(path.resolve(__dirname, '../../public/img/component-previews/clock-moonlit-fan.webp')) };
  async function request(action, body) {
    const file = Buffer.isBuffer(body);
    const response = await fetch(`${fixture.origin}/api/component-styles/${action}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${fixture.token}`,
        'Content-Type': file ? 'application/octet-stream' : 'application/json' },
      body: body === undefined ? undefined : file ? body : JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.status, 200, result.error);
    return result.data;
  }
  return { fixture, context, page, errors, media, request };
}

test('local styles import, replace in place, publish and survive library removal', { timeout: 60000 }, async t => {
  const { fixture, context, page, errors, media, request } = await setup(t);
  const desktop = await context.newPage();
  const url = await openCanvasDesktop(desktop, fixture);
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '添加组件', exact: true });
  await picker.locator('[data-category="clock"]').click();
  await picker.locator('.component-style-library input[type="file"]').first().setInputFiles(media);
  const editor = page.getByRole('dialog', { name: '添加时钟底图', exact: true });
  await editor.getByRole('button', { name: '添加样式', exact: true }).waitFor();
  await editor.getByLabel('样式名称').fill('我的时钟');
  const area = editor.locator('.component-style-area');
  await area.focus();
  await area.press('ArrowRight');
  const beforeDrag = await area.boundingBox();
  await page.mouse.move(beforeDrag.x + 25, beforeDrag.y + 25);
  await page.mouse.down();
  await page.mouse.move(beforeDrag.x + 35, beforeDrag.y + 35, { steps: 3 });
  await page.mouse.up();
  const resize = await editor.locator('.component-style-area-resize').boundingBox();
  await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2);
  await page.mouse.down();
  await page.mouse.move(resize.x - 20, resize.y - 20, { steps: 3 });
  await page.mouse.up();
  await editor.getByRole('button', { name: '添加样式', exact: true }).click();
  await editor.waitFor({ state: 'hidden' });
  const imported = (await request('list'))[0].styles[0];
  assert.ok(imported.config.mediaStyle.content.x > 11);
  assert.ok(imported.config.mediaStyle.content.width < 80);
  await picker.getByRole('button', { name: '添加到画布：我的时钟', exact: true }).click();
  await page.locator('.scene-editor-item').waitFor();
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items.length === 1);
  const original = await desktop.evaluate(() => window.controllers.canvas.getState().draft.document.items[0]);
  const getItem = () => desktop.evaluate(() => window.controllers.canvas.getState().draft.document.items[0]);
  await page.getByRole('button', { name: '更换样式 / 添加素材', exact: true }).click();
  const library = page.getByRole('dialog', { name: '时钟底图样式', exact: true });
  await library.locator('input[type="file"]').first().setInputFiles({ ...media, name: 'replacement.webp' });
  await editor.getByLabel('样式名称').fill('替换时钟');
  await editor.getByRole('button', { name: '添加样式', exact: true }).click();
  await editor.waitFor({ state: 'hidden' });
  await library.getByRole('button', { name: '更换「我的时钟」的样式：替换时钟', exact: true }).click();
  await desktop.waitForFunction(id => window.controllers.canvas.getState().draft.document.items[0].appearance.config.mediaStyle.id !== id, imported.id);
  const replaced = await getItem();
  for (const key of ['id', 'type', 'name', 'x', 'y', 'width', 'height', 'locked', 'visible']) assert.deepEqual(replaced[key], original[key], key);
  assert.equal(await page.locator('.scene-editor-item').count(), 1);
  await page.locator('[data-media-field="fontSize"]').fill('48');
  await page.locator('[data-media-field="fontSize"]').press('Tab');
  await page.getByRole('button', { name: '更换样式 / 添加素材', exact: true }).focus();
  await page.keyboard.press('Control+z');
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items[0].appearance.config.mediaStyle.fontSize === 64);
  assert.equal(await page.locator('[data-media-field="fontSize"]').inputValue(), '64', 'Undo also restores the visible media controls.');
  assert.equal(fixture.service.list()[0].hasPublication, false, 'Library changes do not go live.');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  const saved = fixture.service.list()[0];
  const source = fixture.service.getSource(saved.document.id);
  const outputUrl = `${fixture.origin}/scene?id=${source.id}#token=${source.token}`;
  assert.equal((await fetch(outputUrl)).status, 200);
  const output = await context.newPage();
  output.on('pageerror', error => errors.push(error.message));
  await output.goto(outputUrl);
  const live = output.frameLocator('.scene-version:not(.is-staging) iframe');
  await live.locator('.component-media-art').waitFor({ state: 'visible' });
  await live.locator('.clock-time').waitFor({ state: 'visible' });
  const bounds = await live.locator('.clock-time').evaluate(element => {
    const text = element.getBoundingClientRect(); const region = document.querySelector('.component-media-content').getBoundingClientRect();
    return { text: { x: text.x, y: text.y, right: text.right, bottom: text.bottom }, region: { x: region.x, y: region.y, right: region.right, bottom: region.bottom } };
  });
  assert.ok(bounds.text.x >= bounds.region.x && bounds.text.right <= bounds.region.right + 1);
  assert.ok(bounds.text.y >= bounds.region.y && bounds.text.bottom <= bounds.region.bottom + 1);
  await page.getByRole('button', { name: '更换样式 / 添加素材', exact: true }).click();
  await library.getByRole('button', { name: '删除样式：替换时钟', exact: true }).click();
  await library.getByRole('button', { name: '删除样式：替换时钟', exact: true }).waitFor({ state: 'hidden' });
  await library.getByRole('button', { name: '关闭', exact: true }).click();
  await output.reload();
  await live.locator('.component-media-art').waitFor({ state: 'visible' });
  assert.equal((await fetch(`${fixture.origin}${replaced.appearance.config.mediaStyle.src}`)).status, 200);
  await page.getByRole('button', { name: '改用内置样式', exact: true }).click();
  await desktop.waitForFunction(() => !window.controllers.canvas.getState().draft.document.items[0].appearance.config.mediaStyle);
  assert.equal(await live.locator('.component-media-art').count(), 1, 'Draft changes do not affect published output.');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  await output.reload();
  await live.locator('.clock-time').waitFor({ state: 'visible' });
  assert.equal(await live.locator('.component-media-art').count(), 0);
  await page.getByRole('button', { name: '更换样式 / 添加素材', exact: true }).click();
  const count = (await request('list')).flatMap(pack => pack.styles).length;
  await library.locator('input[type="file"]').first().setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') });
  await editor.getByRole('status').filter({ hasText: '无法播放此素材' }).waitFor();
  assert.equal(await editor.getByRole('button', { name: '添加样式', exact: true }).isDisabled(), true);
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal((await request('list')).flatMap(pack => pack.styles).length, count);
  assert.deepEqual(errors, []);
});

test('custom media keeps live wishes, ordered gift events and opening/video lifecycle', { timeout: 60000 }, async t => {
  const { fixture, page, errors, media, request } = await setup(t);
  const hostUrl = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(hostUrl)).status, 200);
  await page.goto(hostUrl);
  const makeStyle = async (type, extra = {}, bytes = media.buffer, filename = media.name) => {
    const description = { type, filename, name: type, width: 640, height: 400, media: { durationMs: 700, ...extra } };
    return (await request(`add?description=${encodeURIComponent(JSON.stringify(description))}`, bytes)).styles[0].config;
  };
  const mount = async (route, config) => {
    assert.equal((await fetch(`${fixture.origin}${route}`)).status, 200);
    await page.evaluate(({ route, config }) => {
      document.body.replaceChildren();
      const frame = document.createElement('iframe'); frame.allow = 'autoplay'; frame.style.cssText = 'width:640px;height:400px;border:0';
      window.prepared = false; window.mediaStatus = '';
      window.onmessage = event => {
        if (event.source !== frame.contentWindow) return;
        if (event.data.type === 'component-preview:ready') frame.contentWindow.postMessage({ type: 'component-preview:init', config }, '*');
        if (event.data.type === 'component-preview:prepared') window.prepared = true;
        if (event.data.type === 'component-preview:status') window.mediaStatus = event.data.message;
      };
      frame.src = `${route}${route.includes('?') ? '&' : '?'}componentPreview=1&sceneComponent=1`;
      document.body.append(frame);
      window.sendMediaData = data => frame.contentWindow.postMessage({ type: 'component-preview:data', data }, '*');
    }, { route, config });
    await page.waitForFunction(() => window.prepared || window.mediaStatus);
    assert.equal(await page.evaluate(() => window.mediaStatus), '');
    return page.frameLocator('iframe');
  };
  const send = data => page.evaluate(value => window.sendMediaData(value), data);
  const wishes = await mount('/gift-wishes', await makeStyle('gift-wishes', { textColor: '#aaffdd', fontSize: 32 }));
  const data = await page.evaluate(async () => (await import('/js/admin/scene-extra-preview-data.js')).sceneExtraPreviewData('gift-wishes'));
  await send(data);
  await wishes.locator('.wish-card').waitFor({ state: 'visible' });
  data.items[0].count = 72; data.items[0].todayCount = 72; data.items[0].progress = 72; data.items[0].remaining = 28;
  await send(data);
  await wishes.getByText('72', { exact: true }).waitFor();
  assert.equal(await wishes.locator('.component-media-art').count(), 1);
  for (const [type, route] of [['gift-frame', '/gift-effects?giftComponent=frame'], ['guard-thanks', '/gift-effects?giftComponent=guard']]) {
    const frame = await mount(route, await makeStyle(type));
    const event = type === 'gift-frame'
      ? { type: 'gift:frame', eventId: 'one', userName: '观众甲', giftName: '测试礼物', num: 2, totalPriceCents: 1000, themeId: 'woodland-bloom' }
      : { type: 'gift:guard-thanks', eventId: 'one', userName: '观众甲', tier: 'captain', months: 3, textMode: 'bilingual', style: 'aurora' };
    await send({ reset: false, events: [event, event, { ...event, eventId: 'two', userName: '观众乙' }] });
    await frame.locator('.component-media-thanks').filter({ hasText: '观众甲' }).waitFor({ state: 'visible' });
    await frame.locator('.component-media-thanks').filter({ hasText: '观众乙' }).waitFor({ state: 'visible' });
    await frame.locator('.component-media-playback').waitFor({ state: 'hidden' });
    await send({ reset: false, events: [event] });
    assert.equal(await frame.locator('.component-media-playback').isVisible(), false, 'Repeated event stays consumed.');
    await send({ reset: false, events: [{ ...event, eventId: 'three' }] });
    await frame.locator('.component-media-playback').waitFor({ state: 'visible' });
    await send({ reset: true, events: [] });
    await frame.locator('.component-media-playback').waitFor({ state: 'hidden' });
  }
  const opening = await mount('/opening', await makeStyle('opening'));
  await send({ enabled: true });
  await opening.locator('.component-media-playback').waitFor({ state: 'visible' });
  await opening.locator('.component-media-playback').waitFor({ state: 'hidden' });
  await send({ enabled: true });
  assert.equal(await opening.locator('.component-media-playback').isVisible(), false);
  await send({ enabled: false }); await send({ enabled: true });
  await opening.locator('.component-media-playback').waitFor({ state: 'visible' });
  await send({ enabled: false });
  await opening.locator('.component-media-playback').waitFor({ state: 'hidden' });
  const longPreview = await mount('/gift-effects?giftComponent=frame', await makeStyle('gift-frame', { durationMs: 9000 }));
  await send({ preview: true, events: [{ type: 'gift:frame', eventId: 'long', userName: '长动画观众', giftName: '礼物', num: 1, totalPriceCents: 1000 }] });
  await longPreview.locator('.component-media-playback').waitFor({ state: 'visible' });
  await longPreview.locator('.component-media-playback').evaluate(element => {
    element.dataset.longPreview = 'original'; element.dataset.visibilityChanges = '0';
    new MutationObserver(records => { element.dataset.visibilityChanges = String(Number(element.dataset.visibilityChanges) + records.length); })
      .observe(element, { attributes: true, attributeFilter: ['hidden'] });
  });
  await page.waitForTimeout(8250);
  assert.equal(await longPreview.locator('.component-media-playback').getAttribute('data-long-preview'), 'original', 'Long previews are not recreated at eight seconds.');
  assert.equal(await longPreview.locator('.component-media-playback').isVisible(), true);
  assert.equal(await longPreview.locator('.component-media-playback').getAttribute('data-visibility-changes'), '0');
  await send({ reset: true, events: [] });
  const videoBytes = Buffer.from(await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
    canvas.getContext('2d').fillRect(0, 0, 160, 90);
    const stream = canvas.captureStream(10); const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    recorder.ondataavailable = event => chunks.push(event.data);
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.start();
    const timer = setInterval(() => { const ctx = canvas.getContext('2d'); ctx.fillStyle = '#9870ee'; ctx.fillRect(0, 0, 160, 90); stream.getVideoTracks()[0].requestFrame(); }, 50);
    await new Promise(resolve => setTimeout(resolve, 1000)); recorder.stop(); await stopped;
    clearInterval(timer); stream.getTracks().forEach(track => track.stop());
    return [...new Uint8Array(await new Blob(chunks).arrayBuffer())];
  }));
  assert.ok(videoBytes.length > 64, 'The synthetic video includes encoded frames.');
  const videoConfig = await makeStyle('background', {}, videoBytes, 'motion.webm');
  const background = await mount('/background', videoConfig);
  await background.locator('video.component-media-art').waitFor({ state: 'visible' });
  await background.locator('video.component-media-art').evaluate(video => new Promise(resolve => {
    if (video.currentTime > 0) resolve(); else video.addEventListener('timeupdate', resolve, { once: true });
  }));
  assert.equal(await background.locator('video.component-media-art').evaluate(video => video.loop && !video.paused), true);
  const eventVideo = await mount('/opening', await makeStyle('opening', { durationMs: 120000 }, videoBytes, 'opening.webm'));
  await send({ enabled: true });
  await eventVideo.locator('.component-media-playback').waitFor({ state: 'visible' });
  await eventVideo.locator('.component-media-playback').waitFor({ state: 'hidden', timeout: 4000 });
  assert.equal(await eventVideo.locator('video.component-media-art').evaluate(video => video.paused), true);
  assert.deepEqual(errors, []);
});
