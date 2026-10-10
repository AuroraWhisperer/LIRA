'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright');
const { launchElectron } = require('../helpers/shared-electron');
const { createComponentStyleStore } = require('../../src/storage/component-style-store');
const { createComponentStyleLibrary } = require('../../src/server/component-style-library');
const { saveMedia } = require('../../src/server/component-media-files');
const { normalizeSceneConfig } = require('../../src/server/scene-components');
const { COMPONENT_RESOURCE_PRESETS } = require('../../public/js/shared/component-resource-style.js');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-store');
const { getOpeningConfig } = require('../../src/server/opening-service');

test('desktop opening styles share one picker and retain their own settings and imported defaults', { timeout: 60000 }, async t => {
  const root = path.resolve(__dirname, '../..');
  const scratch = path.join(root, 'tmp'); fs.mkdirSync(scratch, { recursive: true });
  const directory = fs.mkdtempSync(path.join(scratch, 'opening-styles-electron-'));
  let app;
  t.after(async () => {
    await app?.close();
    assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(scratch));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const store = createComponentStyleStore(directory);
  const packId = randomUUID();
  const preset = COMPONENT_RESOURCE_PRESETS['moonlit-opening'];
  const resources = {};
  for (const source of preset.resources) {
    const media = await saveMedia(fs.createReadStream(path.join(root, 'public', source)), store.directory(packId, true), source, { packageResource: true });
    resources[source] = `/component-media/${packId}/${media.basename}`;
  }
  const id = randomUUID();
  const resourceStyle = { id, preset: 'moonlit-opening', width: 1920, height: 1080, preview: resources[preset.resources[0]], resources };
  const config = normalizeSceneConfig('opening', { ...preset.config, title: '包内开场', resourceStyle });
  store.stage({ id: packId, name: '测试开播套装', styles: [{ id, type: 'opening', name: '月渡花汀 · 开播动画', config }] });
  await createComponentStyleLibrary(directory).install(packId);
  app = await launchElectron({ cwd: root, args: ['test/fixtures/danmaku-canvas-editor.cjs', directory], timeout: 15000 });
  const page = await app.firstWindow(); page.setDefaultTimeout(7000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const values = { ...DEFAULT_SETTINGS, openingTitle: '经典原文', openingQuality: 'high' };
  const context = { settings: { get: () => values }, system: { dataDir: directory } };
  await page.route('**/api/opening/config', route => route.fulfill({ json: { ok: true, data: getOpeningConfig(context) } }));
  await page.route('**/api/settings', async route => {
    Object.assign(values, route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });
  await page.locator('#danmakuStyleChip').filter({ hasText: '已应用' }).waitFor();
  const mount = async () => page.evaluate(async markup => {
    document.body.replaceChildren(new DOMParser().parseFromString(markup, 'text/html').body.firstElementChild);
    document.getElementById('otherStartAnimationFeature').hidden = false;
    document.getElementById('otherStartAnimationFeature').style.display = 'block';
    const { initStartAnimation } = await import('/js/admin/start-animation.js');
    initStartAnimation();
    const { enhanceSelects } = await import('/js/shared/select-menu.js');
    enhanceSelects();
  }, fs.readFileSync(path.join(root, 'public/pages/admin/toolbox/start-animation.html'), 'utf8'));
  await mount();
  const classic = page.getByRole('button', { name: '经典舞台', exact: true });
  const pixel = page.getByRole('button', { name: '像素卡带', exact: true });
  const moon = page.getByRole('button', { name: '选择样式：月渡花汀 · 开播动画', exact: true });
  await moon.waitFor();
  const source = page.locator('#openingCopyUrl');
  const sourceUrl = await source.textContent();
  assert.match(sourceUrl, /^http:\/\/127\.0\.0\.1:\d+\/opening$/);
  const styleBounds = await classic.boundingBox();
  const sourceBounds = await source.boundingBox();
  const previewBounds = await page.locator('#openingPreviewBtn').boundingBox();
  assert.ok(sourceBounds.y >= styleBounds.y + styleBounds.height, 'the address starts on the second row');
  assert.equal(sourceBounds.y, previewBounds.y, 'address and preview share the second row');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { async writeText(value) { window.copiedOpeningUrl = value; } } });
  });
  await source.click();
  assert.equal(await page.evaluate(() => window.copiedOpeningUrl), sourceUrl);
  assert.equal(await page.locator('lira-help[label="直播画面链接说明"]').count(), 0);
  await page.locator('#openingTitle').fill('经典新文案');
  await pixel.click();
  assert.equal(await page.locator('#openingCopyFields').isVisible(), false);
  assert.equal(await page.locator('#openingQuality').inputValue(), 'high');
  await page.locator('#openingQuality').selectOption('low');
  await classic.click();
  assert.equal(await page.locator('#openingTitle').inputValue(), '经典新文案');
  assert.equal(await page.locator('#openingQuality').inputValue(), 'high');
  await page.waitForResponse(response => response.url().endsWith('/api/settings'));
  assert.equal(values.openingPixelQuality, 'low');
  assert.equal(values.openingQuality, 'high');
  await moon.click();
  assert.equal(await page.locator('#openingAnimationForm').isVisible(), false);
  const title = page.locator('#openingImportedSettings [data-component-parameter="title"]');
  assert.equal(await title.inputValue(), '包内开场');
  assert.equal(await page.locator('#openingImportedSettings [data-component-parameter="trackMotion"]').isVisible(), false);
  await title.fill('花汀独立文案');
  await pixel.click();
  assert.equal(await page.locator('#openingQuality').inputValue(), 'low');
  await moon.click();
  assert.equal(await title.inputValue(), '花汀独立文案');
  let failSave = true;
  await page.route('**/api/component-styles/config', route => {
    if (!failSave) return route.fallback();
    failSave = false;
    return route.fulfill({ status: 503, json: { ok: false, error: '测试保存失败，请重试' } });
  });
  await page.getByRole('button', { name: '保存此样式', exact: true }).click();
  await page.locator('#openingImportedSettings [role="status"]').filter({ hasText: '测试保存失败' }).waitFor();
  assert.equal(await title.inputValue(), '花汀独立文案');
  await page.getByRole('button', { name: '保存此样式', exact: true }).click();
  await page.locator('#openingImportedSettings [role="status"]').filter({ hasText: '已保存' }).waitFor();
  assert.equal(createComponentStyleLibrary(directory).list()[0].styles[0].config.title, '花汀独立文案');
  assert.equal(values.openingTitle, '经典新文案');
  await page.screenshot({ path: path.join(scratch, 'opening-styles-moon.png'), fullPage: true });
  await page.getByRole('button', { name: '在画布中使用', exact: true }).click();
  await page.waitForFunction(async () => {
    const { prepareComponentPreviews } = await import('/js/admin/component-preview-registry.js');
    return (await prepareComponentPreviews()).find(entry => entry.id === 'canvas')?.controller.getState().draft.document.items
      .some(item => item.type === 'opening' && item.appearance.config.title === '花汀独立文案');
  });
  await page.reload();
  await page.locator('#danmakuStyleChip').filter({ hasText: '已应用' }).waitFor();
  await mount();
  await pixel.click();
  assert.equal(await page.locator('#openingQuality').inputValue(), 'low');
  await classic.click();
  assert.equal(await page.locator('#openingTitle').inputValue(), '经典新文案');
  await page.screenshot({ path: path.join(scratch, 'opening-styles-classic.png'), fullPage: true });
  await moon.click();
  assert.equal(await title.inputValue(), '花汀独立文案');
  assert.deepEqual(errors, []);
});

test('desktop and canvas share pixel controls, animated avatar and music without changing classic settings', { timeout: 60000 }, async t => {
  const root = path.resolve(__dirname, '../..');
  const scratch = path.join(root, 'tmp'); fs.mkdirSync(scratch, { recursive: true });
  const directory = fs.mkdtempSync(path.join(scratch, 'opening-canvas-electron-'));
  let app;
  let browser;
  t.after(async () => {
    await browser?.close(); await app?.close();
    assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(scratch));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  app = await launchElectron({ cwd: root, args: ['test/fixtures/danmaku-canvas-editor.cjs', directory], timeout: 15000 });
  const desktop = await app.firstWindow(); desktop.setDefaultTimeout(7000);
  await app.evaluate(() => Object.assign(global.canvasTest.openingSettings, {
    openingEnabled: 'false', openingStyle: 'pixel-cassette', openingQuality: 'high', openingTitle: '经典保留文案',
  }));
  const errors = []; desktop.on('pageerror', error => errors.push(error.message));
  await desktop.locator('#danmakuStyleChip').filter({ hasText: '已应用' }).waitFor();
  await desktop.evaluate(async markup => {
    document.body.replaceChildren(new DOMParser().parseFromString(markup, 'text/html').body.firstElementChild);
    document.getElementById('otherStartAnimationFeature').hidden = false;
    document.getElementById('otherStartAnimationFeature').style.display = 'block';
    const { initStartAnimation } = await import('/js/admin/start-animation.js');
    initStartAnimation();
  }, fs.readFileSync(path.join(root, 'public/pages/admin/toolbox/start-animation.html'), 'utf8'));
  await desktop.getByRole('button', { name: '预览', exact: true }).click();
  await desktop.waitForFunction(async () => {
    const { getActiveComponentPreview } = await import('/js/admin/component-preview-session.js');
    return Boolean(getActiveComponentPreview());
  });
  let url;
  for (let attempt = 0; attempt < 100 && !url; attempt += 1) {
    url = await app.evaluate(() => global.canvasTest.externalUrls.at(-1));
    if (!url) await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal((await fetch(url)).status, 200);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }); page.setDefaultTimeout(7000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  await page.locator('[data-category="opening"]').click();
  await page.getByRole('button', { name: '添加像素卡带', exact: true }).click();
  const panel = page.locator('.opening-canvas-settings');
  const quality = panel.locator('[data-opening-parameter="quality"]');
  await quality.waitFor();
  await page.waitForFunction(() => !document.querySelector('.opening-canvas-settings fieldset').disabled);
  assert.equal(await panel.locator('[data-opening-parameter="title"]').isVisible(), false);
  await quality.selectOption('low');
  await panel.getByRole('status').filter({ hasText: '已同步' }).waitFor();
  const opening = page.frameLocator('.scene-editor-item.is-selected iframe');
  await opening.locator('#openingStage.quality-low').waitFor();
  await page.locator('.scene-editor-item').first().frameLocator('iframe').locator('#openingStage.quality-low').waitFor();
  assert.equal(await app.evaluate(() => global.canvasTest.openingSettings.openingQuality), 'high');
  await quality.selectOption('normal');
  await panel.getByRole('status').filter({ hasText: '已同步' }).waitFor();
  assert.equal(await panel.getByText('未上传大头贴', { exact: true }).isVisible(), true);
  assert.equal(await desktop.getByText('未上传大头贴', { exact: true }).isVisible(), true);
  await page.screenshot({ path: path.join(scratch, 'opening-canvas-empty.png'), fullPage: true });
  const portrait = await app.evaluate(({ nativeImage }, source) => nativeImage.createFromPath(source)
    .crop({ x: 290, y: 30, width: 450, height: 450 }).resize({ width: 384, height: 384 }).toPNG().toString('base64'),
  path.join(root, 'test/fixtures/opening/opening-character.png'));
  const avatar = { name: '卡带大头贴.png', mimeType: 'image/png', buffer: Buffer.from(portrait, 'base64') };
  // Observe the actual canvas draw without changing the renderer or its image loading.
  await opening.locator('#openingPixel').evaluate(canvas => {
    const context = canvas.getContext('2d');
    const draw = context.drawImage;
    context.drawImage = function (image, ...args) {
      if (image.src?.includes('/opening-character/')) window.avatarDraw = { src: image.src, args };
      return draw.call(this, image, ...args);
    };
  });
  await panel.locator('[data-opening-media="character"]').setInputFiles(avatar);
  await panel.getByText('卡带大头贴.png', { exact: true }).waitFor();
  await opening.locator('#openingPixel').evaluate(() => new Promise(resolve => {
    const check = () => window.avatarDraw ? resolve() : requestAnimationFrame(check); check();
  }));
  const drawn = await opening.locator('#openingPixel').evaluate(() => window.avatarDraw);
  assert.ok(drawn.args.at(-1) > 0 && drawn.args.at(-1) <= 160);
  await opening.locator('#openingPixel').evaluate(y => new Promise(resolve => {
    const check = () => window.avatarDraw.args[1] !== y ? resolve() : requestAnimationFrame(check); check();
  }), drawn.args[1]);
  await panel.getByRole('heading', { name: '大头贴图片', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(scratch, 'opening-canvas-avatar.png'), fullPage: true });
  await desktop.evaluate(() => window.dispatchEvent(new Event('focus')));
  await desktop.getByText('卡带大头贴.png', { exact: true }).waitFor();
  assert.equal(await desktop.locator('#openingQuality').inputValue(), 'normal');
  assert.equal(await app.evaluate(() => global.canvasTest.openingSettings.openingEnabled), 'false');
  await panel.locator('[data-opening-media="music"]').setInputFiles({ name: '卡带音乐.ogg', mimeType: 'audio/ogg',
    buffer: fs.readFileSync(path.join(root, 'test/fixtures/opening/music.ogg')) });
  await panel.getByText('卡带音乐.ogg', { exact: true }).waitFor();
  await panel.locator('[data-opening-parameter="volume"]').fill('24');
  await panel.locator('[data-opening-parameter="volume"]').dispatchEvent('change');
  await panel.getByRole('status').filter({ hasText: '已同步' }).waitFor();
  assert.equal(await app.evaluate(() => global.canvasTest.openingSettings.openingPixelAudioVolume), '0.24');
  await panel.getByRole('button', { name: '清除音乐', exact: true }).click();
  await panel.getByText('未上传音乐', { exact: true }).waitFor();
  let fail = true;
  await page.route('**/api/component-preview/opening/character?**', route => {
    if (!fail) return route.fallback();
    fail = false;
    return route.fulfill({ status: 503, json: { ok: false, error: '测试上传失败，请重试' } });
  });
  await panel.locator('[data-opening-media="character"]').setInputFiles(avatar);
  await panel.getByRole('status').filter({ hasText: '测试上传失败' }).waitFor();
  assert.equal(await panel.getByText('卡带大头贴.png', { exact: true }).isVisible(), true);
  await panel.getByRole('button', { name: '清除大头贴', exact: true }).click();
  await panel.getByText('未上传大头贴', { exact: true }).waitFor();
  assert.equal(await desktop.locator('#openingShowNotes, #openingShowEq').count(), 0);
  assert.equal(await panel.locator('[data-opening-parameter="showNotes"], [data-opening-parameter="showEq"]').count(), 0);
  await page.locator('[data-component-parameter="style"]').selectOption('classic');
  await panel.getByRole('heading', { name: '经典舞台设置', exact: true }).waitFor();
  assert.equal(await panel.locator('[data-opening-parameter="title"]').inputValue(), '经典保留文案');
  assert.equal(await quality.inputValue(), 'high');
  assert.equal(await panel.getByText('未上传人物图', { exact: true }).isVisible(), true);
  assert.equal(await page.evaluate(() => Boolean(window.__API_TOKEN__ || window.liraLicense)), false);
  assert.deepEqual(errors, []);
});
