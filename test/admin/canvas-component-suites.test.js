'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createMoonlitZip } = require('../../scripts/package-moonlit-suite');
const { installMoonlitSuite } = require('../helpers/moonlit-suite-fixture');
const { useSharedBrowser } = require('../helpers/shared-browser');

const openBrowserSession = useSharedBrowser();

// Only the import-list test uploads the 60 MB ZIP; other tests start with the suite installed.
async function suiteFixture(t, options = {}, { installed = true } = {}) {
  const directory = path.resolve(__dirname, '../../tmp'); fs.mkdirSync(directory, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(directory, 'external-moonlit-test-'));
  if (installed) await installMoonlitSuite(dataDir);
  const fixture = await startCanvasOutputFixture({ ...options, dataDir });
  return { ...fixture, dataDir, async close() { await fixture.close(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}

async function importSuite(picker, page) {
  assert.equal(await picker.locator('.component-style-card').count(), 0);
  const directory = fs.mkdtempSync(path.resolve(__dirname, '../../tmp/moonlit-upload-'));
  try {
    const archive = path.join(directory, 'moonlit.zip');
    fs.writeFileSync(archive, createMoonlitZip());
    await picker.locator('input[type="file"][accept=".zip"]').setInputFiles(archive);
    const confirm = page.getByRole('dialog', { name: '确认导入套装', exact: true });
    await confirm.getByRole('button', { name: '导入套装', exact: true }).click();
    await confirm.waitFor({ state: 'hidden' });
    await picker.locator('.component-style-card').nth(7).waitFor();
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');

test('Moonlit lyrics reuse controls, publish live words once and remove decorations on style change', { timeout: 60000 }, async t => {
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
  const typography = await frame.evaluate(async () => {
    const row = document.querySelector('.desktop-lyric-preview-row.is-active');
    const text = row.querySelector('.desktop-lyric-preview-row-text');
    const family = getComputedStyle(text).fontFamily.split(',')[0];
    const faces = await document.fonts.load(`48px ${family}`, '月渡花汀清風星河こんにちは');
    return { family, loaded: faces.length > 0 && faces.every(face => face.status === 'loaded'),
      height: row.offsetHeight, size: getComputedStyle(text).fontSize,
      visible: document.querySelectorAll('.desktop-lyric-preview-row:not(.is-line-hidden)').length };
  });
  assert.ok(typography.family.includes('月渡花汀文楷-'));
  assert.equal(typography.loaded, true, 'Bundled fonts load from the imported package without originals.');
  assert.equal(typography.height, 108);
  assert.equal(typography.size, '48px');
  assert.equal(typography.visible, 1);
  const font = page.locator('[data-component-parameter="desktopLyricFontFamily"]');
  await font.fill('SimSun'); await font.press('Tab');
  await frame.waitForFunction(() => getComputedStyle(document.querySelector('.desktop-lyric-preview-row-text')).fontFamily.startsWith('SimSun'));
  await font.fill('月渡花汀文楷'); await font.press('Tab');
  await frame.waitForFunction(() => getComputedStyle(document.querySelector('.desktop-lyric-preview-row-text')).fontFamily.includes('月渡花汀文楷-'));
  const size = page.locator('[data-component-parameter="desktopLyricFontSize"]');
  await size.fill('32'); await size.press('Tab');
  await frame.waitForFunction(() => getComputedStyle(document.querySelector('.desktop-lyric-preview-row-text')).fontSize === '32px');
  await page.locator('[data-component-parameter="desktopLyricTextAlign"]').selectOption('right');
  await frame.waitForFunction(() => getComputedStyle(document.querySelector('.desktop-lyric-preview-row')).textAlign === 'right');
  const translation = page.locator('[data-component-parameter="desktopLyricShowTranslation"]');
  await translation.uncheck();
  await frame.locator('.desktop-lyric-preview-row-translation').waitFor({ state: 'hidden' });
  await translation.check();
  await frame.locator('.desktop-lyric-preview-row-translation').waitFor({ state: 'visible' });
  const pause = page.locator('[data-component-parameter="desktopLyricHideOnPause"]');
  await pause.check();
  await frame.waitForFunction(() => getComputedStyle(document.querySelector('.desktop-lyric-preview-viewport')).opacity === '0');
  await pause.uncheck();
  await frame.waitForFunction(() => getComputedStyle(document.querySelector('.desktop-lyric-preview-viewport')).opacity === '1');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  const saved = fixture.service.list()[0];
  const config = saved.document.items[0].appearance.config;
  assert.equal(config.resourceStyle.preset, 'moonlit-lyrics');
  assert.equal(config.desktopLyricFontSize, '32');
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
    size: getComputedStyle(element).fontSize,
    flower: getComputedStyle(element.parentElement, '::after').backgroundImage,
  }));
  assert.equal(rendered.plainText, '', 'Mounting karaoke replaces the static sentence.');
  assert.equal(rendered.words, '月渡花汀');
  assert.equal(rendered.size, '32px');
  assert.ok(rendered.flower.includes('/component-media/'));
  const wordMotion = await active.locator('.desktop-lyric-preview-word').evaluateAll(words =>
    words.map(word => ({ transform: getComputedStyle(word).transform,
      states: word.getAnimations().map(animation => animation.playState) })));
  assert.notEqual(wordMotion[1].transform, 'none', 'The sung word lifts even when playback is paused mid-note.');
  assert.deepEqual(wordMotion[1].states, ['paused']);
  assert.equal(wordMotion[2].transform, 'none', 'Upcoming words remain still.');
  // Switching karaoke off and on must neither lose the sentence nor duplicate it.
  const karaoke = page.locator('[data-component-parameter="desktopLyricKaraokeMode"]');
  for (const mode of ['off', 'discrete', 'continuous']) {
    await karaoke.selectOption(mode);
    await page.getByRole('button', { name: '保存并应用', exact: true }).click();
    await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
    await output.reload();
    await active.waitFor();
    if (mode === 'off') assert.equal(await active.textContent(), '月渡花汀');
    else {
      await active.locator('.desktop-lyric-preview-word').first().waitFor();
      assert.equal(await active.locator('.desktop-lyric-preview-word').count(), 4);
      assert.equal(await active.evaluate(element => [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE)), false);
    }
  }
  // Real output must consume changed playback data without navigation or manual refresh.
  const liveFrame = await output.locator('.scene-version:not(.is-staging) iframe').elementHandle().then(handle => handle.contentFrame());
  fixture.runtime.lyricState = { ...fixture.runtime.lyricState, sequence: 2, lineText: '清风入梦', currentMs: 11000,
    words: Array.from('清风入梦', (text, index) => ({ text, startMs: 8000 + index * 2000, endMs: 10000 + index * 2000 })) };
  await liveFrame.waitForFunction(() => [...document.querySelectorAll('.desktop-lyric-preview-row.is-active .desktop-lyric-preview-word-base')]
    .map(node => node.textContent).join('') === '清风入梦');
  fixture.runtime.lyricTimeline = { status: 'ready', trackTitle: '另一首歌', lines: [
    { text: '星河入海', startMs: 0, endMs: 8000, translation: 'Stars meet the sea' },
  ] };
  fixture.runtime.lyricState = { ...fixture.runtime.lyricState, generation: 2, sequence: 1,
    lineText: '星河入海', currentMs: 2000, durationMs: 8000,
    words: Array.from('星河入海', (text, index) => ({ text, startMs: index * 2000, endMs: (index + 1) * 2000 })) };
  await liveFrame.waitForFunction(() => [...document.querySelectorAll('.desktop-lyric-preview-word-base')]
    .map(node => node.textContent).join('') === '星河入海');
  assert.equal(await live.locator('.desktop-lyric-preview-row').count(), 1);
  assert.equal(await live.locator('.desktop-lyric-preview-row-translation').textContent(), 'Stars meet the sea');
  fixture.runtime.lyricTimeline = { status: 'empty', trackTitle: '纯音乐', lines: [] };
  fixture.runtime.lyricState = { status: 'empty', playing: false, generation: 3, sequence: 1,
    lineText: '', words: [], currentMs: 0, durationMs: 8000 };
  await live.locator('.desktop-lyric-preview-empty').waitFor();
  assert.equal(await live.locator('.desktop-lyric-preview-empty').textContent(), '纯音乐，请欣赏');
  assert.equal(await live.locator('.desktop-lyric-preview-row').count(), 0);
  await page.locator('[data-component-parameter="style"]').selectOption('default');
  await frame.waitForFunction(() => !document.querySelector('style[data-component-resources]'));
  assert.equal(await size.inputValue(), '32');
  assert.equal(await frame.locator('.desktop-lyric-preview-row.is-active').evaluate(el => getComputedStyle(el, '::after').backgroundImage), 'none');
  assert.deepEqual(errors, []);
});

test('wish canvas fits three catalog gifts and publishes only actual wishes', { timeout: 45000 }, async t => {
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
  store.install(packId);
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
    assert.equal(await page.getByRole('spinbutton', { name: '高度（自动）', exact: true }).inputValue(), String(height));
    return height;
  }
  const threeWishes = await fitted(3, 'moonlit');
  const selectedGifts = await frame.locator('.wish-card-image').evaluateAll(async images => {
    await Promise.all(images.map(image => image.decode()));
    return images.map(image => ({ name: image.alt, path: image.getAttribute('src') }));
  });
  assert.equal(new Set(selectedGifts.map(gift => gift.name)).size, 3);
  for (const gift of selectedGifts) assert.ok(gifts.some(entry => entry.name === gift.name && entry.imagePath === gift.path));
  const gap = page.locator('[data-component-parameter="gap"]');
  const initialGap = Number(await gap.inputValue());
  await gap.fill('20'); await gap.press('Tab');
  await frame.waitForFunction(() => getComputedStyle(document.getElementById('giftWishStage')).gap === '20px');
  const widerGap = await fitted(3, 'moonlit');
  assert.equal(widerGap, threeWishes + 2 * (20 - initialGap), 'Fitting adds both changed gaps between three cards.');
  await page.getByRole('spinbutton', { name: '宽度', exact: true }).fill('688');
  await page.getByRole('spinbutton', { name: '宽度', exact: true }).press('Tab');
  await frame.waitForFunction(() => innerWidth === 688);
  const widerCards = await fitted(3, 'moonlit');
  assert.ok(widerCards > widerGap, 'Wider cards grow the fitted height.');
  assert.deepEqual(await frame.locator('.wish-card-image').evaluateAll(images => images.map(image =>
    ({ name: image.alt, path: image.getAttribute('src') }))), selectedGifts);
  const limit = page.locator('[data-component-parameter="limit"]');
  await limit.fill('2'); await limit.press('Tab');
  assert.ok(await fitted(2, 'moonlit') < widerCards);
  await limit.fill('10'); await limit.press('Tab');
  await fitted(3, 'moonlit');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  const saved = fixture.service.list()[0];
  assert.equal(saved.document.items[0].height, widerCards);
  assert.equal(JSON.stringify(saved.document).includes('preview-wish-'), false);
  const source = fixture.service.getSource(saved.document.id);
  const output = await browser.newPage();
  const outputUrl = `${fixture.origin}/scene?id=${source.id}#token=${source.token}`;
  assert.equal((await fetch(outputUrl)).status, 200);
  await output.goto(outputUrl);
  const published = output.frameLocator('.scene-version:not(.is-staging) iframe');
  await published.locator('.wish-moon-name').filter({ hasText: '实际许愿' }).waitFor();
  assert.equal(await published.locator('.wish-card').count(), 1);
  assert.equal(await published.locator('.wish-card-total').textContent(), '12/50');
  assert.equal(await published.locator('[role="progressbar"]').getAttribute('aria-valuenow'), '12');
  const artwork = saved.document.items[0].appearance.config.resourceStyle.resources['/img/shared/gift-wish-moonlit.webp'];
  assert.ok((await published.locator('.wish-card--moonlit').evaluate(card => getComputedStyle(card).backgroundImage)).includes(artwork));
  assert.ok(await published.locator('.wish-card-image').evaluate(async image => { await image.decode(); return image.naturalWidth > 0; }));
  // Live progress updates the rendered card in place and clamps a completed wish to its target.
  await published.locator('.wish-card').evaluate(card => { window.liveWishNode = card; });
  Object.assign(actualWish, { count: 55, todayCount: 55, remaining: 0, progress: 100, completed: true });
  fixture.notify({ types: ['gift-wishes'], invalidateTypes: ['gift-wishes'] });
  await published.locator('.wish-card-count').filter({ hasText: '55' }).waitFor();
  assert.equal(await published.locator('.wish-card').evaluate(card => card === window.liveWishNode), true);
  assert.equal(await published.locator('.wish-card').count(), 1);
  assert.equal(await published.locator('[role="progressbar"]').getAttribute('aria-valuenow'), '50');
  for (const [style, className] of [['card', 'bar'], ['text', 'text'], ['circle', 'circle']]) {
    await page.locator('[data-component-parameter="displayStyle"]').selectOption(style);
    await fitted(3, className);
  }
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
  for (let index = 1; index <= 6; index++) assert.equal(preset.config[`overlayRule${index}`], '');
  const config = normalizeSceneConfig('queue', { ...preset.config, resourceStyle, overlayRule1: '旧套装规则' });
  store.stage({ id: packId, name: '月渡花汀', styles: [{ id: resourceStyle.id, type: 'queue', name: '月渡花汀 · 点歌板', config }] });
  store.install(packId);
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
  assert.equal(await field('queueTitleFontSizeNumber').isVisible(), false);
  assert.equal(await field('overlayTitle').isVisible(), false);
  assert.equal(await frame.locator('.overlay-header').isVisible(), false);
  assert.deepEqual(await frame.locator('.queue-moonlit').evaluate(panel =>
    [panel, panel.querySelector('.overlay-content'), panel.querySelector('.identity-row')]
      .map(element => getComputedStyle(element).backgroundColor)), Array(3).fill('rgba(0, 0, 0, 0)'));
  assert.equal(await field('identityQueueFontSizeNumber').inputValue(), '30');
  assert.equal(await field('overlayRuleFontSizeNumber').isVisible(), false);
  assert.equal(await field('overlayRule1').isVisible(), false);
  assert.equal(await field('overlayShowIndex').locator('..').isVisible(), true);
  await page.locator('.scene-editor-item iframe').evaluate(element => element.contentWindow.postMessage({
    type: 'component-preview:data', data: { queue: { current: null, waiting: [3, 2, 1].map(level => ({
      id: level, song_name: '合成歌曲', requester_name: '合成观众', requester_guard_level: level,
    })) }, superChats: [] },
  }, '*'));
  const guardImages = frame.locator('.identity-guard-image');
  await guardImages.first().waitFor();
  assert.deepEqual(await guardImages.evaluateAll(images => images.map(image => image.alt)), ['舰长', '提督', '总督']);
  assert.deepEqual(await guardImages.evaluateAll(images => images.map(image => image.getAttribute('src'))), [
    '/img/admin/gifts/bilibili-guard-captain.webp', '/img/admin/gifts/bilibili-guard-prefect.webp',
    '/img/admin/gifts/bilibili-guard-governor.webp',
  ]);
  for (const image of await guardImages.all()) await image.evaluate(element => element.decode());
  assert.equal(await frame.locator('.identity-badge').count(), 0);
  await field('identityQueueFontSizeNumber').fill('26');
  await field('overlayShowIndex').selectOption('false', { force: true });
  await frame.locator('.identity-list.no-index').waitFor();
  assert.equal(await frame.locator('.identity-rank').count(), 0);
  assert.equal(await frame.locator('.identity-footer').count(), 0);
  assert.equal(await frame.locator('.identity-song').first().evaluate(element => getComputedStyle(element).fontSize), '26px');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  const saved = fixture.service.list()[0];
  const savedConfig = saved.document.items[0].appearance.config;
  assert.equal(savedConfig.overlayShowIndex, 'false');
  assert.equal(savedConfig.resourceStyle.preset, 'moonlit-queue');
  await page.reload();
  await frame.locator('.identity-list.no-index').waitFor();
  assert.equal(await frame.locator('.identity-footer').count(), 0);
  await page.locator('.preview-canvas-layer-select').first().click();
  await field('overlayShowIndex').selectOption('true', { force: true });
  await frame.locator('.identity-rank').first().waitFor();
  assert.deepEqual(errors, []);
});

test('canvas suite imports appear in client component lists and refresh without duplicates', { timeout: 60000 }, async t => {
  const fixture = await suiteFixture(t, {}, { installed: false });
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const desktop = await browser.newPage();
  const page = await browser.newPage();
  desktop.setDefaultTimeout(10000); page.setDefaultTimeout(10000);
  const url = await openCanvasDesktop(desktop, fixture);
  const fragments = ['clock', 'danmaku', 'start-animation', 'gift', 'gift-wishes'].map(name =>
    fs.readFileSync(path.resolve(__dirname, `../../public/pages/admin/toolbox/${name}.html`), 'utf8')).join('\n');
  await desktop.evaluate(async html => {
    document.body.innerHTML = html;
    for (const panel of document.querySelectorAll('section[hidden]')) panel.hidden = false;
    const { initComponentStyleLibraries } = await import('/js/admin/component-style-client.js');
    initComponentStyleLibraries(); initComponentStyleLibraries();
  }, fragments);
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '添加组件', exact: true });
  await picker.locator('[data-category="suites"]').click();
  await importSuite(picker, page);
  await desktop.evaluate(() => window.dispatchEvent(new Event('focus')));
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
  assert.equal(await desktop.locator('[data-local-styles]').count(), 6);
  await desktop.locator('[data-local-styles="clock"] .component-style-delete').click();
  await desktop.locator('[data-local-styles="clock"] .component-style-card').waitFor({ state: 'detached' });
  await picker.locator('[data-category="clock"]').click();
  await picker.locator('.component-style-add').waitFor();
  assert.equal(await picker.locator('.component-style-card').count(), 0);
});

test('adding a suite clock from the client synchronizes its instance before reusing the canvas', { timeout: 60000 }, async t => {
  const fixture = await suiteFixture(t);
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const desktop = await browser.newPage();
  const page = await browser.newPage();
  desktop.setDefaultTimeout(10000); page.setDefaultTimeout(10000);
  const url = await openCanvasDesktop(desktop, fixture);
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await desktop.evaluate(async () => {
    document.body.innerHTML = '<section id="otherClockFeature"><div class="clock-style-options"></div></section>';
    const { initComponentStyleLibraries } = await import('/js/admin/component-style-client.js');
    initComponentStyleLibraries();
  });
  await page.getByRole('button', { name: '添加组件', exact: true }).waitFor();
  for (let count = 1; count <= 2; count += 1) {
    let release;
    const held = new Promise(resolve => { release = resolve; });
    let observed;
    const inFlight = new Promise(resolve => { observed = resolve; });
    let intercepted = false;
    const intercept = async route => {
      const body = route.request().postDataJSON();
      if (body.action !== 'exchange' || !body.state?.draft.document || intercepted) return route.fallback();
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
      await desktop.getByRole('button', { name: '添加到画布：月渡花汀 · 时钟', exact: true }).click();
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
  const fixture = await suiteFixture(t, { extraContext: {
    settings: { get: () => settings }, gifts: { getViewRevision: () => 'synthetic' },
    giftWishes: { getSnapshot: async () => ({ items: [] }) },
  } });
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
  await openSuite();
  await picker.locator('.component-style-card').nth(7).waitFor();
  assert.equal(await picker.locator('.component-style-card').count(), 8);
  assert.equal(await picker.locator('[data-picker-style="moonlit-fan"]').count(), 0);
  await picker.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
  await picker.locator('[data-category="clock"]').click();
  assert.equal(await picker.locator('[data-picker-style="moonlit-fan"]').count(), 0);
  await picker.getByRole('button', { name: '添加到画布：月渡花汀 · 时钟', exact: true }).waitFor();
  await picker.locator('[data-category="background"]').click();
  assert.equal(await picker.locator('[data-picker-style="moonlit"]').count(), 0);
  await picker.getByRole('button', { name: '添加到画布：月渡花汀 · 动态背景', exact: true }).waitFor();
  await picker.getByRole('button', { name: '关闭', exact: true }).click();
  const members = [['opening', 'style', 'moonlit-fan'], ['clock', 'style', 'moonlit-fan'],
    ['danmaku', 'style', 'moonlit'], ['gift-wishes', 'displayStyle', 'moonlit'], ['queue', 'overlayQueueStyle', 'identity'], ['background', 'style', 'moonlit']];
  for (const [index, [type, key, style]] of members.entries()) {
    await openSuite();
    const name = { opening: '开播动画', clock: '时钟', danmaku: '弹幕姬', 'gift-wishes': '礼物许愿', background: '静态背景', queue: '点歌板' }[type];
    await picker.getByRole('button', { name: '添加到画布：月渡花汀 · ' + name, exact: true }).click();
    await picker.waitFor({ state: 'hidden' });
    await desktop.waitForFunction(count => window.controllers.canvas.getState().draft.document.items.length === count, index + 1);
    const items = await desktop.evaluate(() => window.controllers.canvas.getState().draft.document.items);
    const item = items.find(item => item.type === type);
    assert.equal(item.appearance.mode, 'independent');
    assert.equal(item.appearance.config[key], style);
  }
  const items = await desktop.evaluate(() => window.controllers.canvas.getState().draft.document.items);
  const queue = items.find(item => item.type === 'queue');
  const queueFrame = page.frameLocator(`[data-item-id="${queue.id}"].scene-editor-item iframe`);
  await queueFrame.locator('.queue-moonlit .identity-row').first().waitFor();
  assert.equal(await queueFrame.locator('.queue-moonlit').evaluate(panel => getComputedStyle(panel).backgroundColor), 'rgba(0, 0, 0, 0)');
  await page.locator(`.preview-canvas-layer-select[data-item-id="${queue.id}"]`).click();
  await page.locator('.scene-editor-parameters [data-overlay-style="identity"]').click();
  await queueFrame.locator('.queue-identity:not(.queue-moonlit)').waitFor();
  assert.equal(await queueFrame.locator('style[data-component-resources]').count(), 0);
  await page.getByRole('button', { name: '更换样式', exact: true }).click();
  const queueStyles = page.getByRole('dialog', { name: '点歌板样式', exact: true });
  await queueStyles.getByRole('button', { name: '＋ 添加样式', exact: true }).waitFor();
  await queueStyles.getByRole('button', { name: '更换「月渡花汀 · 点歌板」的样式：月渡花汀 · 点歌板', exact: true }).click();
  await queueFrame.locator('.queue-moonlit').waitFor();
  await queueStyles.waitFor({ state: 'hidden' });
  const clock = items.find(item => item.type === 'clock');
  await page.locator(`.preview-canvas-layer-select[data-item-id="${clock.id}"]`).click();
  const clockFrame = page.frameLocator(`[data-item-id="${clock.id}"].scene-editor-item iframe`);
  await clockFrame.locator('#clockCard[data-clock-style="moonlit-fan"]').waitFor();
  await page.locator('[data-preview-field="clockMoonMode"]').selectOption('dark', { force: true });
  await clockFrame.locator('#clockCard[data-moon-tone="dark"]').waitFor();
  assert.equal(await clockFrame.locator('.clock-moon-art').isVisible(), true);
  assert.equal(await clockFrame.locator('#clockCard').evaluate(async card => {
    const family = getComputedStyle(card).fontFamily.split(',')[0];
    await document.fonts.load(`66px ${family}`);
    return family.includes('Lira Moon Serif-') && document.fonts.check(`66px ${family}`);
  }), true);
  const opening = items.find(item => item.type === 'opening');
  const background = items.at(-1);
  assert.equal(background.type, 'background');
  assert.equal(await page.locator('.preview-canvas-layer-select').first().getAttribute('data-item-id'), background.id);
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
  await page.locator('[data-component-parameter="style"]').selectOption('original');
  await openingFrame.locator('#openingStage[data-style="classic"]').waitFor({ state: 'visible' });
  await page.locator('[data-component-parameter="style"]').selectOption('moonlit-fan');
  await openingFrame.locator('#openingMoonFan').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  const saved = fixture.service.list()[0];
  assert.equal(saved.document.items.find(item => item.type === 'clock').appearance.config.moonMode, 'dark');
  assert.equal(saved.document.items.length, 6);
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
  await published.locator('#openingMoonFan[aria-label^="更新的合成标题"]').waitFor();
  settings.openingEnabled = 'false';
  await published.locator('#openingStage.is-disabled').waitFor({ state: 'attached' });
  settings.openingEnabled = 'true';
  await published.locator('#openingStage:not(.is-disabled)').waitFor({ state: 'attached' });
  const sceneUrl = `${fixture.origin}/scene?id=${source.id}#token=${source.token}`;
  assert.equal((await fetch(sceneUrl)).status, 200);
  await output.goto(sceneUrl);
  const publishedBackground = output.frameLocator('.scene-version:not(.is-staging) iframe').last();
  await publishedBackground.locator('#backgroundImage[src^="/component-media/"]').waitFor({ state: 'visible' });
  assert.deepEqual(await publishedBackground.locator('#backgroundImage[src^="/component-media/"]').evaluate(async image => {
    await image.decode();
    return [image.naturalWidth, image.naturalHeight, getComputedStyle(image).objectFit, document.getAnimations().length];
  }), [1920, 1080, 'cover', 0]);
  await page.reload();
  await page.locator('.scene-editor-item').nth(4).waitFor();
  await page.frameLocator(`[data-item-id="${opening.id}"].scene-editor-item iframe`)
    .locator('#openingMoonFan[data-ready="true"]').waitFor({ state: 'visible' });
  await page.frameLocator(`[data-item-id="${background.id}"].scene-editor-item iframe`)
    .locator('#backgroundImage[src^="/component-media/"]').evaluate(image => image.decode());
  assert.deepEqual(errors, []);
  const missing = saved.document.items.find(item => item.type === 'background').appearance.config.resourceStyle.resources['/img/overlays/backgrounds/moonlit.webp'];
  await context.route(`${fixture.origin}${missing}`, route => route.fulfill({ status: 404, body: 'Missing installed resource' }));
  await output.reload();
  await output.locator('#sceneStatus').filter({ hasText: '样式素材加载失败' }).waitFor();
});

test('animated wallpaper can switch to static, publish, reload and honor reduced motion', { timeout: 45000 }, async t => {
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
  const first = await canvas.screenshot();
  await page.waitForTimeout(400);
  assert.notDeepEqual(await canvas.screenshot(), first);
  await canvas.evaluate(video => { video.dataset.parameterTest = 'same-video'; video.currentTime = 5; });
  await page.locator('[data-component-parameter="opacity"]').fill('65');
  await page.locator('[data-component-parameter="blur"]').fill('4');
  await page.locator('[data-component-parameter="playbackRate"]').fill('0.75');
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items[0].appearance.config.playbackRate === 0.75);
  assert.deepEqual(await canvas.evaluate(video => ({ marker: video.dataset.parameterTest, rate: video.playbackRate,
    progressed: video.currentTime >= 5, opacity: getComputedStyle(document.body).opacity, filter: getComputedStyle(video).filter })),
    { marker: 'same-video', rate: 0.75, progressed: true, opacity: '0.65', filter: 'blur(4px) brightness(1) saturate(1) contrast(1)' });
  await page.locator('.background-parameters summary').filter({ hasText: '白平衡' }).click();
  await page.locator('[data-component-parameter="colorProcessing"]').selectOption('legacy');
  await page.locator('[data-component-parameter="temperature"]').fill('35');
  await page.locator('[data-component-parameter="preserveLuminance"]').uncheck();
  await page.locator('.background-parameters summary').filter({ hasText: '辉光' }).click();
  await page.locator('[data-component-parameter="glowStrength"]').fill('60');
  await page.locator('[data-component-parameter="glowMode"]').selectOption('star');
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items[0].appearance.config.glowMode === 'star');
  assert.deepEqual(await canvas.evaluate(video => [video.dataset.parameterTest, video.currentTime >= 5]), ['same-video', true]);
  assert.equal(await frame.locator('[data-background-filters] filter').count(), 1);
  await page.locator('[data-component-parameter="style"]').selectOption('moonlit');
  await canvas.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('[data-component-parameter="playbackRate"]').isVisible(), false);
  assert.match(await frame.locator('#backgroundImage').evaluate(image => getComputedStyle(image).filter), /^blur\(4px\) brightness\(1\) saturate\(1\) contrast\(1\) url/);
  const still = await frame.locator('body').screenshot();
  await page.waitForTimeout(150);
  assert.deepEqual(await frame.locator('body').screenshot(), still);
  await page.locator('[data-component-parameter="style"]').selectOption('moonlit-animated');
  await canvas.waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  const saved = fixture.service.list()[0];
  assert.equal(saved.document.items.length, 1);
  assert.equal(saved.document.items[0].appearance.config.style, 'moonlit-animated');
  assert.equal(saved.document.items[0].appearance.config.backgroundDefaults.opacity, 1);
  assert.equal(saved.document.items[0].appearance.config.opacity, 0.65);
  assert.equal(saved.document.items[0].appearance.config.playbackRate, 0.75);
  assert.equal(saved.document.items[0].appearance.config.temperature, 35);
  assert.equal(saved.document.items[0].appearance.config.preserveLuminance, false);
  assert.equal(saved.document.items[0].appearance.config.glowStrength, 0.6);
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
  assert.match(await animation.evaluate(video => getComputedStyle(video).filter), /url/);
  assert.equal(await published.locator('[data-background-filters] filter').count(), 1);
  assert.equal(await published.locator('body').evaluate(body => getComputedStyle(body).opacity), '0.65');
  const moving = await animation.screenshot();
  await output.waitForTimeout(400);
  assert.notDeepEqual(await animation.screenshot(), moving);
  await output.emulateMedia({ reducedMotion: 'reduce' });
  await animation.waitFor({ state: 'hidden' });
  const reduced = await published.locator('body').screenshot();
  await output.waitForTimeout(150);
  assert.deepEqual(await published.locator('body').screenshot(), reduced);
  await output.emulateMedia({ reducedMotion: 'no-preference' });
  await animation.waitFor({ state: 'visible' });
  await output.reload();
  await animation.waitFor({ state: 'visible' });
  await page.reload();
  await canvas.waitFor({ state: 'visible' });
  await page.locator('.preview-canvas-layer-select').first().click();
  assert.equal(await page.locator('[data-component-parameter="opacity"]').inputValue(), '65');
  assert.equal(await page.locator('[data-component-parameter="glowStrength"]').inputValue(), '60');
  assert.equal(await page.locator('[data-component-parameter="preserveLuminance"]').isChecked(), false);
  await page.getByRole('button', { name: '恢复样式默认', exact: true }).click();
  assert.equal(await page.locator('[data-component-parameter="opacity"]').inputValue(), '100');
  assert.equal(await page.locator('[data-component-parameter="playbackRate"]').inputValue(), '1');
  assert.equal(await page.locator('[data-component-parameter="glowStrength"]').inputValue(), '0');
  assert.equal(await page.locator('[data-component-parameter="preserveLuminance"]').isChecked(), true);
  await frame.locator('[data-background-filters]').waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
});
