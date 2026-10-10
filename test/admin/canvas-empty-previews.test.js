'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');
const { useSharedBrowser } = require('../helpers/shared-browser');
const { sceneExtraPreviewData } = require('../../public/js/admin/scene-extra-preview-data.js');
const { createDanmakuPreviewItems } = require('../../public/js/overlays/danmaku-preview-samples.js');

const openBrowserSession = useSharedBrowser();

test('canvas keeps opening styles visible when disabled or configuration is unavailable', { timeout: 30000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const desktop = await browser.newPage();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(5000);
  let unavailable = false;
  fixture.runtime.settings.openingTitle = '尚未启用的开播画面';
  const url = await openCanvasDesktop(desktop, fixture);
  await desktop.route('**/api/opening/config', route => route.fulfill({ status: unavailable ? 503 : 200,
    json: unavailable ? { ok: false } : { ok: true, data: { enabled: false, title: '尚未启用的开播画面',
      audioUrl: '/opening-media/test.ogg', volume: 0.5 } } }));
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  for (const style of ['classic', 'pixel-cassette']) {
    await page.getByRole('button', { name: '添加组件', exact: true }).click();
    await page.locator('[data-category="opening"]').click();
    await page.locator(`[data-picker-style="${style}"]`).click();
    const preview = page.frameLocator('.scene-editor-item.is-selected iframe');
    await preview.locator(`#openingStage[data-style="${style}"]:not(.is-disabled)`).waitFor();
    if (style === 'classic') await preview.getByText('尚未启用的开播画面', { exact: true }).waitFor();
    else await preview.locator('#openingPixel').waitFor();
    assert.equal(await preview.locator('audio').getAttribute('src'), null, 'Disabled opening previews must not start saved audio.');
  }
  unavailable = true;
  const classic = page.locator('.scene-editor-item[data-component="opening"]').first().frameLocator('iframe');
  await classic.getByText('尚未启用的开播画面', { exact: true }).waitFor();
  await classic.locator('#openingStage:not(.is-disabled)').waitFor();
  assert.equal(fixture.runtime.settings.openingEnabled, 'false');
});

test('preview filters keep samples visible without changing live filtering', { timeout: 40000 }, async t => {
  const day = sceneExtraPreviewData('gift-feed').day;
  const fixture = await startCanvasOutputFixture({ extraContext: {
    songs: { list: () => [{ id: 1, name: '实际流行歌曲', artist: '歌手', category_name: '流行' }] },
    gifts: { getViewRevision: () => 'synthetic',
      getHistory: () => ({ items: [], viewRevision: 'synthetic', nextCursor: null }) },
    giftCards: { getProfiles: async () => ({ items: [], day, viewRevision: 'synthetic' }) },
    overtime: { getGlobalGiftCatalog: () => ({ gifts: [] }) },
    giftWishes: { getSnapshot: async () => ({ items: [{ id: 'real-day-wish', period: 'day',
      giftName: '小花花', target: 100, count: 36, todayCount: 36, remaining: 64, progress: 36,
      completed: false, displayStyle: 'card' }] }) },
  } });
  Object.assign(fixture.runtime, sceneExtraPreviewData('lyrics'));
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const desktop = await browser.newPage();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.addEventListener('message', event => {
      if (['component-preview:init', 'component-preview:config'].includes(event.data?.type)) {
        window.previewConfig = event.data.config;
      }
    });
  });
  const url = await openCanvasDesktop(desktop, fixture);
  await desktop.route('**/api/overtime/gifts/catalog', route => route.fulfill({ json: { ok: true,
    data: { gifts: [{ id: '31036', name: '小花花', imagePath: '/img/overlays/gift-feed/flower.webp' }] } } }));
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  async function add(type, style) {
    await page.getByRole('button', { name: '添加组件', exact: true }).click();
    await page.locator(`[data-category="${type}"]`).click();
    await page.locator(`[data-picker-style="${style}"]`).click();
    return page.locator('.scene-editor-item.is-selected iframe').elementHandle().then(handle => handle.contentFrame());
  }
  const wish = await add('gift-wishes', 'card');
  await wish.locator('.wish-card').waitFor();
  for (const period of ['all', 'day', 'session', 'long']) {
    await page.locator('[data-component-parameter="period"]').selectOption(period);
    await wish.waitForFunction(period => window.previewConfig?.period === period, period);
    await wish.locator('.wish-card').waitFor();
  }
  const feed = await add('gift-feed', 'default');
  await feed.locator('.gift-banner').first().waitFor();
  const minimum = page.locator('[data-component-parameter="minGiftAmountCents"]');
  await minimum.fill('100'); await minimum.press('Tab');
  await feed.locator('.gift-banner').first().waitFor({ state: 'hidden' });
  await feed.getByRole('status').filter({ hasText: '金额门槛' }).waitFor();
  assert.ok((await feed.getByRole('status').boundingBox()).y < 1000, 'The empty hint stays within the preview.');
  await minimum.fill('0'); await minimum.press('Tab');
  await feed.locator('.gift-banner').first().waitFor();
  await feed.getByRole('status').waitFor({ state: 'hidden' });
  const lyrics = await add('lyrics', 'default');
  await lyrics.locator('.desktop-lyric-preview-row').first().waitFor();
  await page.locator('[data-component-parameter="desktopLyricHideOnPause"]').check();
  assert.equal(await page.locator('[data-component-parameter="desktopLyricHideOnPause"]').isChecked(), true);
  assert.equal(await lyrics.locator('.is-paused-hidden').count(), 0);
  assert.equal(await lyrics.locator('.desktop-lyric-preview-viewport').evaluate(node => getComputedStyle(node).opacity), '1');
  const rockSongs = await add('songlist', 'default');
  await page.locator('[data-component-parameter="category"]').fill('摇滚');
  await rockSongs.waitForFunction(() => window.previewConfig?.category === '摇滚');
  await rockSongs.locator('.song-card').first().waitFor();
  const popSongs = await add('songlist', 'default');
  await page.locator('[data-component-parameter="category"]').fill('流行');
  await popSongs.waitForFunction(() => window.previewConfig?.category === '流行');
  await popSongs.locator('.song-card').first().waitFor();
  await rockSongs.locator('.song-card').first().waitFor();
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  const saved = fixture.service.list()[0];
  assert.equal(fixture.runtime.settings.desktopLyricHideOnPause, 'true');
  assert.equal(saved.document.items.find(item => item.type === 'gift-wishes').appearance.config.period, 'long');
  const source = fixture.service.getSource(saved.document.id);
  const outputUrl = `${fixture.origin}/scene?id=${source.id}#token=${source.token}`;
  assert.equal((await fetch(outputUrl)).status, 200);
  const output = await browser.newPage();
  output.on('pageerror', error => errors.push(error.message));
  await output.goto(outputUrl);
  const published = output.locator('.scene-version:not(.is-staging)');
  await published.waitFor();
  await published.frameLocator('iframe[src^="/lyrics"]').locator('.is-paused-hidden').waitFor({ state: 'attached' });
  assert.equal(await published.frameLocator('iframe[src^="/gift-wishes"]').locator('.wish-card').count(), 0);
  await published.frameLocator('iframe[src^="/gift-feed"]').getByRole('status', { includeHidden: true }).waitFor({ state: 'hidden' });
  await published.frameLocator('iframe[src^="/songlist"]').nth(0).getByText('歌库还没有可展示歌曲', { exact: true }).waitFor();
  await published.frameLocator('iframe[src^="/songlist"]').nth(1).getByText('实际流行歌曲', { exact: true }).first().waitFor();
  assert.deepEqual(errors, []);
});

async function openSurface(page, fixture, { type = 'opening', config = {}, url } = {}) {
  const hostUrl = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(hostUrl)).status, 200);
  await page.goto(hostUrl);
  await page.evaluate(async ({ type, config, url }) => {
    const { mountComponentPreview } = await import('/js/admin/component-preview-surface.js');
    const { createComponentConfigController } = await import('/js/admin/component-config-controller.js');
    const { createSceneExtraPreview } = await import('/js/admin/scene-extra-preview.js');
    const { createSceneExtraDefaults } = await import('/js/shared/scene-extra-components.js');
    window.controller = createComponentConfigController({ initial: { ...(type === 'opening' ? createSceneExtraDefaults(type) : {}), ...config }, persist: async draft => draft });
    const descriptor = type === 'opening' ? createSceneExtraPreview(type, { controller: window.controller,
      startPreviewData(receive) {
        window.emitOpening = opening => receive({ previewData: { opening } });
        window.emitOpening({ enabled: false });
      } }) : { title: '弹幕姬', controller: window.controller, size: () => [480, 640] };
    window.surface = mountComponentPreview(document.body, { ...descriptor, ...(url ? { url } : {}) });
    window.sendData = data => document.querySelector('iframe').contentWindow.postMessage({ type: 'component-preview:data', data }, '*');
  }, { type, config, url });
  return page.locator('iframe').elementHandle().then(handle => handle.contentFrame());
}

test('one blindbox profitability toggle can turn off the legacy loss filter', { timeout: 15000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.evaluate(async () => {
    const { createSceneExtraPreview } = await import('/js/admin/scene-extra-preview.js');
    const { createSceneExtraDefaults } = await import('/js/shared/scene-extra-components.js');
    const { createComponentConfigController } = await import('/js/admin/component-config-controller.js');
    window.controller = createComponentConfigController({
      initial: { ...createSceneExtraDefaults('blindbox'), winnersOnly: false, hideLoss: true },
      persist: async draft => draft,
    });
    createSceneExtraPreview('blindbox', { controller: window.controller }).createPanel(document.body);
  });
  assert.equal(await page.locator('[data-component-parameter="hideLoss"]').count(), 0);
  const toggle = page.locator('[data-component-parameter="winnersOnly"]');
  assert.equal(await toggle.isChecked(), true);
  for (const checked of [false, true]) {
    await toggle.setChecked(checked);
    assert.deepEqual(await page.evaluate(() => {
      const { winnersOnly, hideLoss } = window.controller.getState().draft;
      return { winnersOnly, hideLoss };
    }), { winnersOnly: checked, hideLoss: checked });
  }
});

test('imported opening repeats only in preview, stays silent while disabled, and stops cleanly', { timeout: 30000 }, async t => {
  const { createMediaStyle } = require('../../public/js/shared/component-media-style.js');
  const fixture = await startCanvasOutputFixture();
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await page.clock.install();
  const id = '12345678-1234-4234-8234-123456789abc';
  const src = `/component-media/${id}/${'a'.repeat(64)}.webp`;
  await page.route(`${fixture.origin}${src}`, route => route.fulfill({ contentType: 'image/webp',
    body: fs.readFileSync(path.resolve(__dirname, '../../public/img/overlays/gift-feed/flower.webp')) }));
  const mediaStyle = { ...createMediaStyle('opening', { id, src, kind: 'image', width: 140, height: 140 }), durationMs: 1000 };
  const frame = await openSurface(page, fixture, { config: { mediaStyle } });
  const playback = frame.locator('.component-media-playback');
  await playback.waitFor({ state: 'visible' });
  await page.clock.fastForward(1100);
  await playback.waitFor({ state: 'hidden' });
  await page.clock.fastForward(1100);
  await playback.waitFor({ state: 'visible' });
  assert.equal(await playback.count(), 1);

  await page.evaluate(() => window.sendData(null));
  await playback.waitFor({ state: 'hidden' });
  await page.clock.fastForward(5000);
  assert.equal(await playback.isVisible(), false, 'Disconnected previews must not restart.');
  await page.evaluate(() => window.sendData({ enabled: true }));
  await playback.waitFor({ state: 'visible' });
  await page.clock.fastForward(1100);
  await playback.waitFor({ state: 'hidden' });
  await page.evaluate(() => window.sendData({ enabled: true }));
  await page.clock.fastForward(5000);
  assert.equal(await playback.isVisible(), false, 'Live output remains a single playback for each activation.');

  const video = { ...mediaStyle, kind: 'video', src: src.replace('.webp', '.webm'), volume: 0.75 };
  await page.route(`${fixture.origin}${video.src}`, route => route.fulfill({ contentType: 'video/webm',
    body: fs.readFileSync(path.resolve(__dirname, '../fixtures/gift-effect-alpha.webm')) }));
  await page.evaluate(mediaStyle => { window.emitOpening({ enabled: false, name: '静音预览' }); window.controller.edit({ mediaStyle }); }, video);
  await frame.locator('video').waitFor({ state: 'attached' });
  assert.equal(await frame.locator('video').evaluate(node => node.muted), true);
  assert.equal(await page.evaluate(() => window.controller.getState().draft.mediaStyle.volume), 0.75);
  await page.evaluate(() => window.controller.edit({ mediaStyle: null }));
  await frame.locator('#openingStage:not(.is-disabled)').waitFor();
  await page.clock.fastForward(5000);
  assert.equal(await playback.count(), 0, 'Changing style disposes the former player and its replay timer.');
});

test('preview loading errors clear after a valid style is applied in both frame modes', { timeout: 30000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  for (const scene of [true, false]) {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const cssStyle = { id: '12345678-1234-4234-8234-123456789abc',
      src: '/component-web/12345678-1234-4234-8234-123456789abc/missing.css', engine: 'native', width: 960, height: 540 };
    const frame = await openSurface(page, fixture, { config: { cssStyle }, url: `/opening?componentPreview=1${scene ? '&sceneComponent=1' : ''}` });
    const status = page.locator('.component-preview-load-state');
    await status.filter({ hasText: 'CSS 无法加载' }).waitFor();
    await page.evaluate(() => window.controller.edit({ cssStyle: null }));
    await frame.locator('#openingStage:not(.is-disabled)').waitFor();
    await status.waitFor({ state: 'hidden' });
    await page.close();
  }
});

test('imported danmaku renews samples after CSS exit animations without leaking them into live output', { timeout: 30000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  for (const engine of ['blc', 'blivechat']) {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.clock.install();
    const src = `/component-web/12345678-1234-4234-8234-123456789abc/${engine}.css`;
    await page.route(`${fixture.origin}${src}`, route => route.fulfill({ contentType: 'text/css',
      headers: { 'access-control-allow-origin': '*' }, body: '.danmaku-item,yt-live-chat-text-message-renderer,yt-live-chat-paid-message-renderer { display:block; animation:leave .2s forwards; } @keyframes leave { from { opacity:1 } to { opacity:0 } }' }));
    const config = { cssStyle: { id: '12345678-1234-4234-8234-123456789abc', src, engine, width: 480, height: 640 } };
    const frame = await openSurface(page, fixture, { type: 'danmaku', config, url: '/imported-danmaku?componentPreview=1' });
    const selector = engine === 'blc' ? '.danmaku-item' : '#items > *';
    const sampleCount = createDanmakuPreviewItems().length;
    await frame.waitForFunction(({ selector, sampleCount }) => document.querySelectorAll(selector).length === sampleCount &&
      [...document.querySelectorAll(selector)].every(node => getComputedStyle(node).opacity === '0'), { selector, sampleCount });
    await frame.waitForFunction(({ selector, sampleCount }) => document.querySelectorAll(selector).length > sampleCount &&
      [...document.querySelectorAll(selector)].some(node => Number(getComputedStyle(node).opacity) > 0), { selector, sampleCount });
    await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({ type: 'component-preview:dispose' }, '*'));
    await frame.locator(selector).waitFor({ state: 'hidden' });
    await page.clock.fastForward(5000);
    assert.equal(await frame.locator(selector).count(), 0);
    const live = await openSurface(page, fixture, { type: 'danmaku', config, url: '/imported-danmaku?componentPreview=1&sceneComponent=1' });
    await page.locator('.component-preview-load-state').waitFor({ state: 'hidden' });
    await page.clock.fastForward(5000);
    assert.equal(await live.locator(selector).count(), 0, 'Live renderers must never generate preview messages.');
    await page.close();
  }
});
