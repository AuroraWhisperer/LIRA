'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { installMoonlitSuite } = require('../helpers/moonlit-suite-fixture');
const { createComponentStyleLibrary } = require('../../src/server/component-style-library');
const { useSharedBrowser } = require('../helpers/shared-browser');
const { readAdminFragmentHtml } = require('../helpers/admin-html');

const openBrowserSession = useSharedBrowser();

function storedResourceConfig(fixture, item) {
  return createComponentStyleLibrary(fixture.dataDir).list().flatMap(pack => pack.styles)
    .find(style => style.id === item.appearance.config.resourceStyle.id).config;
}

// Tests start with the bundled suite installed through the real library inspect/install path.
async function suiteFixture(t, options = {}, { installed = true } = {}) {
  const directory = path.resolve(__dirname, '../../tmp'); fs.mkdirSync(directory, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(directory, 'external-moonlit-test-'));
  if (installed) await installMoonlitSuite(dataDir);
  const fixture = await startCanvasOutputFixture({ ...options, dataDir });
  return { ...fixture, dataDir, async close() { await fixture.close(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}

const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');

test('Moonlit lyrics load imported resources, publish live words once and wait for native settings on style change', { timeout: 60000 }, async t => {
  const fixture = await suiteFixture(t, { extraContext: {} });
  t.after(() => fixture.close());
  fixture.runtime.lyricTimeline = { status: 'ready', trackTitle: '合成歌词', lines: [
    { text: '月渡花汀', startMs: 0, endMs: 8000, translation: 'Moonlit waters' },
    { text: '清风入梦', startMs: 8000, endMs: 16000, translation: 'A quiet breeze' },
  ] };
  fixture.runtime.lyricState = { status: 'ready', playing: false, generation: 1, sequence: 1, lineText: '月渡花汀', currentMs: 3000,
    durationMs: 16000, words: Array.from('月渡花汀', (text, index) => ({ text, startMs: index * 2000, endMs: (index + 1) * 2000 })) };
  const browser = openBrowserSession();
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  // Imported assets must work when installer-excluded originals are unavailable.
  await context.route('**/img/overlays/opening-moon-fan/**', route => route.fulfill({ status: 404 }));
  await context.route('**/fonts/moonlit-wenkai/**', route => route.fulfill({ status: 404 }));
  const desktop = await context.newPage();
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = await openCanvasDesktop(desktop, fixture);
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '添加组件', exact: true });
  await picker.locator('[data-category="lyrics"]').click();
  await picker.getByRole('button', { name: '添加到画布：月渡花汀 · 桌面歌词', exact: true }).click();
  const frame = await page.locator('.scene-editor-item.is-selected iframe').elementHandle().then(handle => handle.contentFrame());
  await frame.waitForFunction(() => document.querySelector('style[data-component-resources]')?.textContent.includes('/component-media/'));
  const loaded = await frame.evaluate(async () => {
    const text = document.querySelector('.desktop-lyric-preview-row.is-active .desktop-lyric-preview-row-text');
    const family = getComputedStyle(text).fontFamily.split(',').find(value => value.includes('月渡花汀文楷-'));
    const faces = await document.fonts.load(`48px ${family}`, '月渡花汀清風星河こんにちは');
    return faces.length > 0 && faces.every(face => face.status === 'loaded');
  });
  assert.equal(loaded, true, 'Bundled fonts load from the imported package without originals.');
  const size = page.locator('[data-component-parameter="desktopLyricFontSize"]');
  await size.fill('32'); await size.press('Tab');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  const saved = fixture.service.list()[0];
  const config = saved.document.items[0].appearance.config;
  assert.equal(config.resourceStyle.preset, 'moonlit-lyrics');
  assert.equal(storedResourceConfig(fixture, saved.document.items[0]).desktopLyricFontSize, '32');
  assert.equal(saved.document.items.length, 1);
  const source = fixture.service.getSource(saved.document.id);
  const output = await context.newPage();
  output.on('pageerror', error => errors.push(error.message));
  const outputUrl = `${fixture.origin}/scene?id=${source.id}#token=${source.token}`;
  assert.equal((await fetch(outputUrl)).status, 200);
  await output.goto(outputUrl);
  const live = output.frameLocator('.scene-version:not(.is-staging) iframe');
  const active = live.locator('.desktop-lyric-preview-row.is-active .desktop-lyric-preview-row-text');
  await active.locator('.desktop-lyric-preview-word').first().waitFor();
  const rendered = await active.evaluate(element => ({
    plainText: [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join(''),
    words: [...element.querySelectorAll('.desktop-lyric-preview-word-base')].map(node => node.textContent).join(''),
  }));
  assert.equal(rendered.plainText, '', 'Mounting karaoke replaces the static sentence.');
  assert.equal(rendered.words, '月渡花汀');
  let releaseNativeRead;
  const nativeRead = new Promise(resolve => { releaseNativeRead = resolve; });
  t.after(() => releaseNativeRead());
  await page.route('**/api/component-preview/appearance?*', async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'read' && body.items.some(item => item.type === 'lyrics' && !item.config.resourceStyle)) await nativeRead;
    await route.continue();
  });
  await page.locator('[data-component-parameter="style"]').selectOption('default');
  await frame.waitForFunction(() => !document.querySelector('style[data-component-resources]'));
  assert.equal(await size.isDisabled(), true, 'native parameters cannot be edited before their shared settings arrive');
  releaseNativeRead();
  await page.waitForFunction(expected => {
    const input = document.querySelector('[data-component-parameter="desktopLyricFontSize"]');
    return !input.disabled && input.value === expected;
  }, fixture.runtime.settings.desktopLyricFontSize);
  assert.equal(await size.inputValue(), fixture.runtime.settings.desktopLyricFontSize,
    'switching to the native style restores its shared settings');
  assert.deepEqual(errors, []);
});

test('wish canvas fits the selected number of catalog examples and publishes only actual wishes', { timeout: 45000 }, async t => {
  const { randomUUID } = require('node:crypto');
  const { createComponentStyleStore } = require('../../src/storage/component-style-store');
  const { saveMedia } = require('../../src/server/component-media-files');
  const { normalizeSceneConfig } = require('../../src/server/scene-components');
  const { COMPONENT_RESOURCE_PRESETS } = require('../../public/js/shared/component-resource-style.js');
  const actualWish = { id: 'actual-wish', period: 'day', giftName: '实际许愿',
    imagePath: '/img/overlays/gift-feed/flower.webp', target: 50, count: 12, todayCount: 12,
    remaining: 38, progress: 24, completed: false, displayStyle: 'card' };
  const fixture = await suiteFixture(t, { notifications: true, extraContext: {
    gifts: { getViewRevision: () => 'synthetic-wishes' },
    giftWishes: { getSnapshot: async () => ({ items: [{ ...actualWish }] }) },
  } }, { installed: false });
  t.after(() => fixture.close());
  const store = createComponentStyleStore(fixture.dataDir);
  const packId = randomUUID();
  const preset = COMPONENT_RESOURCE_PRESETS['moonlit-wishes'];
  const resources = {};
  for (const source of preset.resources) {
    const media = await saveMedia(fs.createReadStream(path.join(__dirname, '../../public', source)), store.directory(packId, true), source, { packageResource: true });
    resources[source] = `/component-media/${packId}/${media.basename}`;
  }
  // An already installed ZIP can retain its old height; the client must fit its content.
  const resourceStyle = { id: randomUUID(), preset: 'moonlit-wishes', width: 640, height: 400,
    preview: resources[preset.resources[0]], resources };
  const config = normalizeSceneConfig('gift-wishes', { ...preset.config, resourceStyle });
  store.stage({ id: packId, name: '月渡花汀', styles: [{ id: resourceStyle.id, type: 'gift-wishes', name: '月渡花汀 · 礼物许愿', config }] });
  await createComponentStyleLibrary(fixture.dataDir).install(packId);
  const browser = openBrowserSession();
  const desktop = await browser.newPage();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  const childRequests = [];
  let catalogReads = 0;
  for (const target of [desktop, page]) target.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/') && request.frame().parentFrame()) childRequests.push(request.url());
  });
  t.after(async () => {
    await browser.close();
    assert.deepEqual(errors, []);
    assert.deepEqual(childRequests, [], 'Wish frames use the existing parent data channel.');
  });
  const url = await openCanvasDesktop(desktop, fixture);
  const gifts = ['flower', 'cheer', 'call', 'flower'].map((artwork, index) => ({
    id: String(index + 1), name: `合成礼物 ${index + 1}`, imagePath: `/img/overlays/gift-feed/${artwork}.webp`,
  }));
  await desktop.route('**/api/overtime/gifts/catalog', route => {
    catalogReads++;
    return route.fulfill({ json: { ok: true, data: { gifts } } });
  });
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '添加组件', exact: true });
  await picker.locator('[data-category="gift-wishes"]').click();
  await picker.getByRole('button', { name: '添加到画布：月渡花汀 · 礼物许愿', exact: true }).click();
  const frame = await page.locator('.scene-editor-item.is-selected iframe').elementHandle().then(handle => handle.contentFrame());
  async function fitted(count, style) {
    await frame.waitForFunction(({ count, style }) => {
      const stage = document.getElementById('giftWishStage');
      return stage.querySelectorAll(`.wish-card--${style}`).length === count
        && Math.abs(innerHeight - stage.getBoundingClientRect().height) < 1;
    }, { count, style });
    const height = await frame.evaluate(() => innerHeight);
    await page.waitForFunction(height => document.querySelector('.scene-editor-geometry input[readonly]')?.value === String(height), height);
    return height;
  }
  const limit = page.locator('[data-component-parameter="limit"]');
  const oneWish = await fitted(1, 'moonlit');
  await limit.fill('3'); await limit.press('Tab');
  const threeWishes = await fitted(3, 'moonlit');
  assert.ok(threeWishes > oneWish);
  const selectedGifts = await frame.locator('.wish-card-image').evaluateAll(async images => {
    await Promise.all(images.map(image => image.decode()));
    return images.map(image => ({ name: image.alt, path: image.getAttribute('src') }));
  });
  assert.equal(new Set(selectedGifts.map(gift => gift.name)).size, 3);
  for (const gift of selectedGifts) assert.ok(gifts.some(entry => entry.name === gift.name && entry.imagePath === gift.path));
  await limit.fill('1'); await limit.press('Tab');
  const finalHeight = await fitted(1, 'moonlit');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  const saved = fixture.service.list()[0];
  assert.equal(saved.document.items[0].height, finalHeight);
  assert.equal(storedResourceConfig(fixture, saved.document.items[0]).limit, 1);
  assert.equal(JSON.stringify(saved.document).includes('preview-wish-'), false);
  const source = fixture.service.getSource(saved.document.id);
  const output = await browser.newPage();
  const outputUrl = `${fixture.origin}/scene?id=${source.id}#token=${source.token}`;
  assert.equal((await fetch(outputUrl)).status, 200);
  await output.goto(outputUrl);
  const published = output.frameLocator('.scene-version:not(.is-staging) iframe');
  await published.locator('.wish-moon-name').filter({ hasText: '实际许愿' }).waitFor();
  assert.equal(await published.locator('.wish-card').count(), 1);
  assert.equal(await published.locator('[role="progressbar"]').getAttribute('aria-valuenow'), '12');
  // Live progress clamps a completed wish to its target.
  Object.assign(actualWish, { count: 55, todayCount: 55, remaining: 0, progress: 100, completed: true });
  fixture.notify({ types: ['gift-wishes'], invalidateTypes: ['gift-wishes'] });
  await published.locator('.wish-card-count').filter({ hasText: '55' }).waitFor();
  assert.equal(await published.locator('.wish-card').count(), 1);
  assert.equal(await published.locator('[role="progressbar"]').getAttribute('aria-valuenow'), '50');
  assert.equal(catalogReads, 1);
});

test('moonlit queue parameters edit the installed preset and survive scene publication', { timeout: 45000 }, async t => {
  const { randomUUID } = require('node:crypto');
  const { createComponentStyleStore } = require('../../src/storage/component-style-store');
  const { saveMedia } = require('../../src/server/component-media-files');
  const { normalizeSceneConfig } = require('../../src/server/scene-components');
  const { COMPONENT_RESOURCE_PRESETS } = require('../../public/js/shared/component-resource-style.js');
  const fixture = await suiteFixture(t, {}, { installed: false });
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const store = createComponentStyleStore(fixture.dataDir);
  const packId = randomUUID();
  const preset = COMPONENT_RESOURCE_PRESETS['moonlit-queue'];
  const files = {};
  const previewPath = '/img/component-previews/queue-moonlit.webp';
  // Seed an installed resource style directly: this test does not export a ZIP.
  for (const source of [...preset.resources, ...preset.optionalResources, previewPath]) {
    const media = await saveMedia(fs.createReadStream(path.join(__dirname, '../../public', source)), store.directory(packId, true), source);
    files[source] = `/component-media/${packId}/${media.basename}`;
  }
  const resourceStyle = { id: randomUUID(), preset: 'moonlit-queue', preview: files[previewPath],
    width: preset.size[0], height: preset.size[1], resources: Object.fromEntries(
      [...preset.resources, ...preset.optionalResources].map(source => [source, files[source]])) };
  const config = normalizeSceneConfig('queue', { ...preset.config, resourceStyle });
  store.stage({ id: packId, name: '月渡花汀', styles: [{ id: resourceStyle.id, type: 'queue', name: '月渡花汀 · 点歌板', config }] });
  await createComponentStyleLibrary(fixture.dataDir).install(packId);
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const desktop = await context.newPage();
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = await openCanvasDesktop(desktop, fixture);
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '添加组件', exact: true });
  await picker.locator('[data-category="queue"]').click();
  await picker.getByRole('button', { name: '添加到画布：月渡花汀 · 点歌板', exact: true }).click();
  const frame = page.frameLocator('.scene-editor-item iframe');
  await frame.locator('.queue-moonlit').waitFor();
  const field = name => page.locator(`.scene-editor-parameters [data-preview-field="${name}"]`);
  await field('overlayShowIndex').selectOption('false', { force: true });
  await frame.locator('.identity-list.no-index').waitFor();
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  const saved = fixture.service.list()[0];
  const savedConfig = saved.document.items[0].appearance.config;
  assert.equal(storedResourceConfig(fixture, saved.document.items[0]).overlayShowIndex, 'false');
  assert.equal(savedConfig.resourceStyle.preset, 'moonlit-queue');
  await page.reload();
  await frame.locator('.identity-list.no-index').waitFor();
  assert.deepEqual(errors, []);
});

test('installed suite styles appear once in client component lists and disappear after suite deletion', { timeout: 60000 }, async t => {
  const fixture = await suiteFixture(t);
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const desktop = await browser.newPage();
  const page = await browser.newPage();
  desktop.setDefaultTimeout(10000); page.setDefaultTimeout(10000);
  const url = await openCanvasDesktop(desktop, fixture);
  const fragments = ['toolbox/clock', 'live-components/danmaku', 'toolbox/start-animation', 'toolbox/gift', 'toolbox/gift-wishes', 'song/desktop-lyric'].map(name =>
    readAdminFragmentHtml(`pages/admin/${name}.html`)).join('\n');
  await desktop.evaluate(async html => {
    document.body.innerHTML = html;
    for (const panel of document.querySelectorAll('section[hidden]')) panel.hidden = false;
    const { initComponentStyleLibraries } = await import('/js/admin/component-style-client.js');
    initComponentStyleLibraries(); initComponentStyleLibraries();
    const { initStartAnimation } = await import('/js/admin/start-animation.js');
    initStartAnimation(); initStartAnimation();
  }, fragments);
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '添加组件', exact: true });
  for (const type of ['clock', 'danmaku', 'opening', 'gift-wishes']) {
    const cards = desktop.locator(`[data-local-styles="${type}"] .component-style-card`);
    await cards.waitFor();
    assert.equal(await cards.count(), 1, type);
    await picker.locator(`[data-category="${type}"]`).click();
    await picker.locator('.component-style-card').waitFor();
    assert.equal(await picker.locator('.component-style-card').count(), 1, type);
  }
  await desktop.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('focus')); });
  await desktop.locator('[data-local-styles="clock"] .component-style-card').waitFor();
  assert.equal(await desktop.locator('.component-style-card').count(), 4);
  await picker.locator('[data-category="suites"]').click();
  await picker.getByRole('button', { name: '删除套装', exact: true }).click();
  await page.getByRole('dialog', { name: '删除套装', exact: true })
    .getByRole('button', { name: '删除整套', exact: true }).click();
  await picker.getByRole('heading', { name: '还没有套装', exact: true }).waitFor();
  await desktop.evaluate(() => window.dispatchEvent(new Event('focus')));
  await desktop.waitForFunction(() => !document.querySelector('.component-style-card'));
  for (const type of ['clock', 'danmaku', 'opening', 'gift-wishes']) {
    await picker.locator(`[data-category="${type}"]`).click();
    await picker.getByRole('button', { name: '添加样式', exact: true }).waitFor();
    assert.equal(await picker.locator('.component-style-card').count(), 0, type);
  }
});

test('adding a suite clock from the client synchronizes its instance before reusing the canvas', { timeout: 60000 }, async t => {
  const fixture = await suiteFixture(t);
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const desktop = await browser.newPage();
  const page = await browser.newPage();
  desktop.setDefaultTimeout(10000); page.setDefaultTimeout(10000);
  const canvasOpened = desktop.waitForResponse(response => {
    const body = response.request().postDataJSON();
    return body?.action === 'open' && body.component === 'canvas';
  });
  const url = await openCanvasDesktop(desktop, fixture);
  const { data: { id: canvasSessionId } } = await (await canvasOpened).json();
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await desktop.evaluate(async html => {
    document.body.innerHTML = html;
    document.getElementById('otherClockFeature').hidden = false;
    const { initComponentStyleLibraries } = await import('/js/admin/component-style-client.js');
    initComponentStyleLibraries();
  }, fs.readFileSync(path.resolve(__dirname, '../../public/pages/admin/toolbox/clock.html'), 'utf8'));
  await desktop.getByRole('button', { name: '调整样式：月渡花汀 · 时钟', exact: true }).click();
  await page.getByRole('button', { name: '添加组件', exact: true }).waitFor();
  for (let count = 1; count <= 2; count += 1) {
    let release;
    const held = new Promise(resolve => { release = resolve; });
    t.after(release);
    let observed;
    const inFlight = new Promise(resolve => { observed = resolve; });
    let intercepted = false;
    const intercept = async route => {
      const body = route.request().postDataJSON();
      if (body.action !== 'exchange' || body.id !== canvasSessionId || intercepted) return route.fallback();
      intercepted = true;
      const response = await route.fetch({ headers: { ...route.request().headers(), Authorization: `Bearer ${fixture.token}` } });
      observed();
      await held;
      await route.fulfill({ response });
    };
    await desktop.route('**/api/component-preview', intercept);
    await inFlight;
    const linked = desktop.waitForResponse(response => response.request().postDataJSON()?.action === 'link');
    try {
      await desktop.getByRole('button', { name: '在画布中使用', exact: true }).click();
    } finally { release(); }
    const response = await linked;
    assert.equal(response.status(), 200, JSON.stringify(await response.json()));
    await desktop.waitForFunction(expected => window.controllers.canvas.getState().draft.document.items.length === expected, count);
    const item = await desktop.evaluate(() => window.controllers.canvas.getState().draft.document.items.at(-1));
    await page.locator(`.preview-canvas-layer-select[data-item-id="${item.id}"][aria-pressed="true"]`).waitFor();
    await page.waitForFunction(expected => document.querySelectorAll('.scene-editor-item').length === expected, count);
    assert.equal(await page.locator('.scene-editor-item').count(), count);
    assert.equal(item.appearance.config.style, 'moonlit-fan');
    assert.equal(fixture.service.list()[0].publishedVersion, 0);
    await desktop.unroute('**/api/component-preview', intercept);
  }
});

test('moonlit suite adds each matching style once and keeps the opening style through publication', { timeout: 90000 }, async t => {
  let settings;
  const fixture = await suiteFixture(t, { extraContext: { settings: { get: () => settings } } });
  settings = fixture.runtime.settings;
  Object.assign(settings, { openingEnabled: 'true', openingStyle: 'classic', openingTitle: '合成开播标题' });
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await context.route(/\/(?:img|fonts)\/.*(?:moonlit|moon-fan|clock-moon-serif)/,
    route => route.fulfill({ status: 404, body: 'Not bundled in installer' }));
  const desktop = await context.newPage();
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = await openCanvasDesktop(desktop, fixture);
  const defaults = await desktop.evaluate(() => Object.fromEntries(['clock', 'danmaku']
    .map(id => [id, window.controllers[id].getState().draft])));
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.getByRole('button', { name: '画布设置', exact: true }).click();
  await page.getByRole('button', { name: '公共画布分辨率', exact: true }).click();
  await page.getByRole('option', { name: '2560 × 1440', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '添加组件', exact: true });
  const openSuite = async () => {
    await page.getByRole('button', { name: '添加组件', exact: true }).click();
    await picker.locator('[data-category="suites"]').click();
  };
  const members = [['opening', 'style', 'moonlit-fan'], ['clock', 'style', 'moonlit-fan'],
    ['danmaku', 'style', 'moonlit'], ['background', 'style', 'moonlit']];
  for (const [index, [type, key, style]] of members.entries()) {
    await openSuite();
    const name = { opening: '开播动画', clock: '时钟', danmaku: '弹幕姬', background: '静态背景' }[type];
    await picker.getByRole('button', { name: '添加到画布：月渡花汀 · ' + name, exact: true }).click();
    await picker.waitFor({ state: 'hidden' });
    await desktop.waitForFunction(count => window.controllers.canvas.getState().draft.document.items.length === count, index + 1);
    const items = await desktop.evaluate(() => window.controllers.canvas.getState().draft.document.items);
    const item = items.find(item => item.type === type);
    assert.equal(item.appearance.mode, 'independent');
    assert.equal(item.appearance.config[key], style);
  }
  const items = await desktop.evaluate(() => window.controllers.canvas.getState().draft.document.items);
  const opening = items.find(item => item.type === 'opening');
  const background = items.at(-1);
  assert.equal(background.type, 'background');
  assert.deepEqual([background.x, background.y, background.width, background.height], [0, 0, 2560, 1440]);
  const backgroundFrame = page.frameLocator(`[data-item-id="${background.id}"].scene-editor-item iframe`);
  await backgroundFrame.locator('#backgroundImage[src^="/component-media/"]').evaluate(image => image.decode());
  const backgroundResponse = await fetch(`${fixture.origin}/background`);
  assert.equal(backgroundResponse.status, 200);
  assert.equal(backgroundResponse.headers.get('content-security-policy'), 'sandbox allow-scripts');
  const directBackground = await fetch(`${fixture.origin}/pages/overlays/background.html`);
  assert.equal(directBackground.status, 200);
  assert.equal(directBackground.headers.get('content-security-policy'), 'sandbox allow-scripts');
  const openingFrame = page.frameLocator(`[data-item-id="${opening.id}"].scene-editor-item iframe`);
  await openingFrame.locator('#openingMoonFan[data-ready="true"]').waitFor({ state: 'visible' });
  assert.equal(settings.openingStyle, 'classic');
  assert.deepEqual(await desktop.evaluate(() => Object.fromEntries(['clock', 'danmaku']
    .map(id => [id, window.controllers[id].getState().draft]))), defaults);
  await page.locator(`.preview-canvas-layer-select[data-item-id="${opening.id}"]`).click();
  await page.locator('[data-component-parameter="title"]').fill('月渡独立标题');
  await openingFrame.locator('#openingMoonFan').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  const saved = fixture.service.list()[0];
  assert.equal(saved.document.items.length, 4);
  assert.equal(saved.document.items.at(-1).type, 'background');
  for (const [type, key, style] of members) {
    assert.equal(saved.document.items.find(item => item.type === type).appearance.config[key], style);
  }
  const source = fixture.service.getSource(saved.document.id);
  const outputUrl = `${fixture.origin}/scene?id=${source.id}&item=${opening.id}#token=${source.token}`;
  assert.equal((await fetch(outputUrl)).status, 200);
  const output = await context.newPage();
  output.on('pageerror', error => errors.push(error.message));
  await output.goto(outputUrl);
  const published = output.frameLocator('.scene-version:not(.is-staging) iframe');
  await published.locator('#openingMoonFan[data-ready="true"]').waitFor({ state: 'visible' });
  settings.openingStyle = 'pixel-cassette';
  settings.openingTitle = '更新的合成标题';
  await published.locator('#openingMoonFan[aria-label^="月渡独立标题"]').waitFor();
  settings.openingEnabled = 'false';
  await published.locator('#openingStage.is-disabled').waitFor({ state: 'attached' });
  settings.openingEnabled = 'true';
  await published.locator('#openingStage:not(.is-disabled)').waitFor({ state: 'attached' });
  const sceneUrl = `${fixture.origin}/scene?id=${source.id}#token=${source.token}`;
  assert.equal((await fetch(sceneUrl)).status, 200);
  await output.goto(sceneUrl);
  const publishedBackground = output.frameLocator('.scene-version:not(.is-staging) iframe').last();
  await publishedBackground.locator('#backgroundImage[src^="/component-media/"]').waitFor({ state: 'visible' });
  assert.deepEqual(errors, []);
  const missing = saved.document.items.find(item => item.type === 'background').appearance.config.resourceStyle.resources['/img/overlays/backgrounds/moonlit.webp'];
  await context.route(`${fixture.origin}${missing}`, route => route.fulfill({ status: 404, body: 'Missing installed resource' }));
  await output.reload();
  await output.locator('#sceneStatus').filter({ hasText: '样式素材加载失败' }).waitFor();
});

test('animated wallpaper settings publish, reload, reset and honor reduced motion', { timeout: 45000 }, async t => {
  const fixture = await suiteFixture(t);
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await context.route(/\/(?:img|fonts)\/.*(?:moonlit|moon-fan|clock-moon-serif)/,
    route => route.fulfill({ status: 404, body: 'Not bundled in installer' }));
  const desktop = await context.newPage();
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = await openCanvasDesktop(desktop, fixture);
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '添加组件', exact: true });
  await picker.locator('[data-category="suites"]').click();
  await picker.getByRole('button', { name: '添加到画布：月渡花汀 · 动态背景', exact: true }).click();
  const frame = page.frameLocator('.scene-editor-item iframe');
  const canvas = frame.locator('#backgroundAnimation');
  await canvas.waitFor({ state: 'visible' });
  await page.locator('[data-component-parameter="opacity"]').fill('65');
  await page.locator('[data-component-parameter="playbackRate"]').fill('0.75');
  await canvas.evaluate(video => new Promise(resolve => {
    if (video.playbackRate === 0.75) resolve();
    else video.addEventListener('ratechange', resolve, { once: true });
  }));
  await page.locator('.background-parameters summary').filter({ hasText: '白平衡' }).click();
  await page.locator('[data-component-parameter="colorProcessing"]').selectOption('legacy');
  await page.locator('[data-component-parameter="temperature"]').fill('35');
  await page.locator('[data-component-parameter="preserveLuminance"]').uncheck();
  await page.locator('.background-parameters summary').filter({ hasText: '辉光' }).click();
  await page.locator('[data-component-parameter="glowStrength"]').fill('60');
  await page.locator('[data-component-parameter="glowMode"]').selectOption('star');
  await frame.locator('[data-background-filters] filter').waitFor({ state: 'attached' });
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  const saved = fixture.service.list()[0];
  assert.equal(saved.document.items.length, 1);
  assert.equal(saved.document.items[0].appearance.config.style, 'moonlit-animated');
  const appearance = storedResourceConfig(fixture, saved.document.items[0]);
  assert.equal(appearance.opacity, 0.65);
  assert.equal(appearance.playbackRate, 0.75);
  assert.equal(appearance.temperature, 35);
  assert.equal(appearance.preserveLuminance, false);
  assert.equal(appearance.glowStrength, 0.6);
  assert.equal(saved.document.items[0].appearance.config.backgroundDefaults.glowStrength, 0);
  const source = fixture.service.getSource(saved.document.id);
  const outputUrl = `${fixture.origin}/scene?id=${source.id}#token=${source.token}`;
  assert.equal((await fetch(outputUrl)).status, 200);
  const output = await context.newPage();
  output.on('pageerror', error => errors.push(error.message));
  await output.goto(outputUrl);
  const published = output.frameLocator('.scene-version:not(.is-staging) iframe');
  const animation = published.locator('#backgroundAnimation');
  await animation.waitFor({ state: 'visible' });
  assert.equal(await animation.evaluate(video => video.playbackRate), 0.75);
  assert.equal(await published.locator('body').evaluate(body => getComputedStyle(body).opacity), '0.65');
  await output.emulateMedia({ reducedMotion: 'reduce' });
  await animation.waitFor({ state: 'hidden' });
  await page.reload();
  await canvas.waitFor({ state: 'visible' });
  await page.locator('.preview-canvas-layer-select').first().click();
  assert.equal(await page.locator('[data-component-parameter="opacity"]').inputValue(), '65');
  assert.equal(await page.locator('[data-component-parameter="glowStrength"]').inputValue(), '60');
  assert.equal(await page.locator('[data-component-parameter="preserveLuminance"]').isChecked(), false);
  await page.getByRole('button', { name: '恢复样式默认', exact: true }).click();
  assert.equal(await page.locator('[data-component-parameter="opacity"]').inputValue(), '100');
  assert.equal(await page.locator('[data-component-parameter="preserveLuminance"]').isChecked(), true);
  await frame.locator('[data-background-filters]').waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
});
