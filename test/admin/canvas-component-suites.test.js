'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { createMoonlitZip } = require('../../scripts/package-moonlit-suite');

async function suiteFixture(t, options = {}) {
  const directory = path.resolve(__dirname, '../../tmp'); fs.mkdirSync(directory, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(directory, 'external-moonlit-test-'));
  const fixture = await startCanvasOutputFixture({ ...options, dataDir });
  return { ...fixture, async close() { await fixture.close(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}

async function importSuite(picker, page) {
  assert.equal(await picker.locator('.component-style-card').count(), 0);
  await picker.locator('input[type="file"][accept=".zip"]').setInputFiles({ name: 'moonlit.zip', mimeType: 'application/zip', buffer: createMoonlitZip() });
  const confirm = page.getByRole('dialog', { name: '确认导入套装', exact: true });
  await confirm.getByRole('button', { name: '导入套装', exact: true }).click();
  await confirm.waitFor({ state: 'hidden' });
  await picker.locator('.component-style-card').nth(5).waitFor();
}
const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');

test('moonlit suite adds each matching style once and keeps the opening style through publication', { timeout: 60000 }, async t => {
  let settings;
  const fixture = await suiteFixture(t, { extraContext: {
    settings: { get: () => settings }, gifts: { getViewRevision: () => 'synthetic' },
    giftWishes: { getSnapshot: async () => ({ items: [] }) },
  } });
  settings = fixture.runtime.settings;
  Object.assign(settings, { openingEnabled: 'true', openingStyle: 'classic', openingTitle: '合成开播标题' });
  const browser = await chromium.launch({ headless: true });
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
  assert.equal(await picker.locator('[data-picker-style="moonlit-fan"]').count(), 0);
  await importSuite(picker, page);
  assert.equal(await picker.locator('.component-style-card').count(), 6);
  await picker.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
  await picker.locator('[data-category="clock"]').click();
  assert.equal(await picker.locator('[data-picker-style="moonlit-fan"]').count(), 0);
  await picker.getByRole('button', { name: '添加到画布：月渡花汀 · 时钟', exact: true }).waitFor();
  await picker.locator('[data-category="background"]').click();
  assert.equal(await picker.locator('[data-picker-style="moonlit"]').count(), 0);
  await picker.getByRole('button', { name: '添加到画布：月渡花汀 · 动态背景', exact: true }).waitFor();
  await picker.getByRole('button', { name: '关闭', exact: true }).click();
  const members = [['opening', 'style', 'moonlit-fan'], ['clock', 'style', 'moonlit-fan'],
    ['danmaku', 'style', 'moonlit'], ['gift-wishes', 'displayStyle', 'moonlit'], ['background', 'style', 'moonlit']];
  for (const [index, [type, key, style]] of members.entries()) {
    await openSuite();
    const name = { opening: '开播动画', clock: '时钟', danmaku: '弹幕姬', 'gift-wishes': '礼物许愿', background: '静态背景' }[type];
    await picker.getByRole('button', { name: '添加到画布：月渡花汀 · ' + name, exact: true }).click();
    await picker.waitFor({ state: 'hidden' });
    await desktop.waitForFunction(count => window.controllers.canvas.getState().draft.document.items.length === count, index + 1);
    const items = await desktop.evaluate(() => window.controllers.canvas.getState().draft.document.items);
    const item = items.find(item => item.type === type);
    assert.equal(item.appearance.mode, 'independent');
    assert.equal(item.appearance.config[key], style);
  }
  const items = await desktop.evaluate(() => window.controllers.canvas.getState().draft.document.items);
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
  assert.equal(saved.document.items.length, 5);
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
  await output.locator('#sceneStatus').filter({ hasText: '套装素材加载失败' }).waitFor();
});

test('animated wallpaper can switch to static, publish, reload and honor reduced motion', { timeout: 45000 }, async t => {
  const fixture = await suiteFixture(t);
  const browser = await chromium.launch({ headless: true });
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
  await importSuite(picker, page);
  await picker.getByRole('button', { name: '添加到画布：月渡花汀 · 动态背景', exact: true }).click();
  const frame = page.frameLocator('.scene-editor-item iframe');
  const canvas = frame.locator('#backgroundAnimation');
  await canvas.waitFor({ state: 'visible' });
  const first = await canvas.screenshot();
  await page.waitForTimeout(400);
  assert.notDeepEqual(await canvas.screenshot(), first);
  await page.locator('[data-component-parameter="style"]').selectOption('moonlit');
  await canvas.waitFor({ state: 'hidden' });
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
  const source = fixture.service.getSource(saved.document.id);
  const outputUrl = `${fixture.origin}/scene?id=${source.id}#token=${source.token}`;
  assert.equal((await fetch(outputUrl)).status, 200);
  const output = await context.newPage();
  output.on('pageerror', error => errors.push(error.message));
  await output.goto(outputUrl);
  const published = output.frameLocator('.scene-version:not(.is-staging) iframe');
  const animation = published.locator('#backgroundAnimation');
  await animation.waitFor({ state: 'visible' });
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
  assert.deepEqual(errors, []);
});
