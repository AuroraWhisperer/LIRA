const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron: electron } = require('playwright');

test('desktop background controls save, publish, reopen and restore defaults through the authorized canvas', { timeout: 90000 }, async t => {
  const root = path.resolve(__dirname, '../../tmp');
  await fs.mkdir(root, { recursive: true });
  const evidence = path.join(root, 'background-filters-qa');
  await fs.mkdir(evidence, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'background-filters-electron-'));
  let app;
  t.after(async () => {
    await app?.close();
    assert.equal(path.dirname(await fs.realpath(directory)), await fs.realpath(root));
    await fs.rm(directory, { recursive: true, force: true });
  });
  app = await electron.launch({ cwd: path.resolve(__dirname, '../..'), args: ['test/fixtures/danmaku-canvas-editor.cjs', directory], timeout: 15000 });
  const desktop = await app.firstWindow();
  await desktop.locator('#danmakuStyleChip').filter({ hasText: '已应用' }).waitFor();
  await desktop.locator('#liveCanvasPreview').click();
  let url;
  for (let attempt = 0; attempt < 100 && !url; attempt++) {
    url = (await app.evaluate(() => global.canvasTest.externalUrls)).at(-1);
    if (!url) await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal((await fetch(url)).status, 200);
  // The fixture owns this sandboxed window; the real desktop stays open as IPC owner.
  const opened = app.waitForEvent('window');
  await app.evaluate(async ({ BrowserWindow }, url) => {
    const editor = new BrowserWindow({ width: 1440, height: 1000, show: false,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
    await editor.loadURL(url);
  }, url);
  const page = await opened;
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '添加组件', exact: true });
  await picker.locator('[data-category="background"]').click();
  await picker.locator('.component-style-library input[type="file"]').first().setInputFiles({
    name: 'background.webp', mimeType: 'image/webp', buffer: await fs.readFile(path.resolve(__dirname, '../../public/img/overlays/backgrounds/moonlit.webp')),
  });
  const importer = page.getByRole('dialog', { name: '添加背景', exact: true });
  await importer.getByLabel('样式名称').fill('滤镜桌面验证');
  await importer.getByRole('button', { name: '添加样式', exact: true }).click();
  await importer.waitFor({ state: 'hidden' });
  await picker.getByRole('button', { name: '添加到画布：滤镜桌面验证', exact: true }).click();
  const frame = page.frameLocator('.scene-editor-item iframe');
  const captureArtwork = async file => page.screenshot({ clip: await page.locator('.scene-editor-item').boundingBox(), ...(file ? { path: file } : {}) });
  await frame.locator('.component-media-art').evaluate(image => image.decode());
  assert.equal(await frame.locator('.component-media-art').evaluate(image => getComputedStyle(image).filter), 'none');
  const originalSource = await frame.locator('.component-media-art').getAttribute('src');
  const originalArtwork = await captureArtwork();
  await fs.writeFile(path.join(evidence, 'before-blue.png'), originalArtwork);
  const field = key => page.locator(`[data-component-parameter="${key}"]`);
  for (const title of ['白平衡', 'Lift / Gamma / Gain', '辉光', '暗角', '色阶']) {
    await page.locator('.background-parameters summary').filter({ hasText: title }).click();
  }
  assert.equal(await field('colorProcessing').inputValue(), 'standard');
  assert.equal(await field('preserveLuminance').isVisible(), false);
  assert.equal(await field('shadowColor').isVisible(), false);
  await field('colorProcessing').selectOption('legacy');
  assert.equal(await field('preserveLuminance').isVisible(), true);
  assert.equal(await field('liftRed').isVisible(), false);
  await field('colorProcessing').selectOption('standard');
  await field('temperature').fill('45');
  await field('liftRed').fill('0.03');
  await field('gammaBlue').fill('1.1');
  await field('gainGreen').fill('0.9');
  await field('glowStrength').fill('65');
  await field('glowMode').selectOption('star');
  await field('vignetteOpacity').fill('30');
  await field('inputBlack').fill('20');
  await field('inputWhite').fill('10');
  assert.equal(await field('inputWhite').evaluate(input => input.checkValidity()), false);
  await field('inputWhite').fill('240');
  await field('gamma').fill('1.15');
  await field('gamma').press('Tab');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  const saved = await app.evaluate(() => global.canvasTest.scene());
  const config = saved.document.items.find(item => item.type === 'background').appearance.config;
  assert.equal(config.temperature, 45);
  assert.equal(config.colorProcessing, 'standard');
  assert.equal(config.liftRed, .03);
  assert.equal(config.gammaBlue, 1.1);
  assert.equal(config.gainGreen, .9);
  assert.equal(config.glowStrength, .65);
  assert.equal(config.inputWhite, 240);
  assert.equal(config.backgroundDefaults.glowStrength, 0);
  assert.ok(saved.publishedVersion > 0);
  await desktop.locator('[data-tab="overlayPage"]').click();
  await desktop.waitForFunction(() => document.getElementById('liveCanvasUrl').textContent.includes('/scene?'));
  const source = await desktop.locator('#liveCanvasUrl').textContent();
  assert.equal((await fetch(source)).status, 200);
  const publishedWindow = app.waitForEvent('window');
  await app.evaluate(async ({ BrowserWindow }, source) => {
    const output = new BrowserWindow({ width: 960, height: 540, show: false,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
    await output.loadURL(source);
  }, source);
  const output = await publishedWindow;
  output.setDefaultTimeout(8000);
  const live = output.frameLocator('.scene-version:not(.is-staging) iframe');
  await live.locator('.component-media-art').waitFor();
  assert.equal(await live.locator('[data-background-filters] filter').count(), 1);
  assert.match(await live.locator('.component-media-art').evaluate(image => getComputedStyle(image).filter), /url/);
  await page.reload();
  await page.locator('.preview-canvas-layer-select').first().click();
  assert.equal(await field('glowStrength').inputValue(), '65');
  assert.equal(await field('colorProcessing').inputValue(), 'standard');
  assert.equal(await field('liftRed').inputValue(), '0.03');
  assert.equal(await field('gammaBlue').inputValue(), '1.1');
  assert.equal(await field('gainGreen').inputValue(), '0.9');
  await page.getByRole('button', { name: '恢复样式默认', exact: true }).click();
  assert.equal(await field('glowStrength').inputValue(), '0');
  assert.equal(await field('preserveLuminance').isChecked(), true);
  assert.equal(await field('liftRed').inputValue(), '0');
  assert.equal(await field('gammaBlue').inputValue(), '1');
  assert.equal(await field('gainGreen').inputValue(), '1');
  await frame.locator('[data-background-filters]').waitFor({ state: 'detached' });
  assert.equal(await frame.locator('.component-media-art').evaluate(image => getComputedStyle(image).filter), 'none');
  const restoredArtwork = await captureArtwork();
  await fs.writeFile(path.join(evidence, 'restored-blue.png'), restoredArtwork);
  assert.equal(await frame.locator('.component-media-art').getAttribute('src'), originalSource);
  const colorDifference = await page.evaluate(async sources => {
    const pixels = await Promise.all(sources.map(async source => {
      const image = new Image(); image.src = `data:image/png;base64,${source}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    }));
    if (pixels[0].length !== pixels[1].length) return null;
    const difference = [0, 0, 0], shift = [0, 0, 0];
    for (let i = 0; i < pixels[0].length; i += 4) for (let channel = 0; channel < 3; channel++) {
      const delta = pixels[1][i + channel] - pixels[0][i + channel];
      difference[channel] += Math.abs(delta); shift[channel] += delta;
    }
    const count = pixels[0].length / 4;
    return { difference: difference.map(value => value / count), shift: shift.map(value => value / count) };
  }, [originalArtwork, restoredArtwork].map(bytes => bytes.toString('base64')));
  // The editor scales artwork by a fractional transform. Compare color bias here;
  // the unscaled sandbox pixel test separately requires an exact neutral reset.
  assert.ok(colorDifference && colorDifference.difference.every(value => value < 1)
    && colorDifference.shift.every(value => Math.abs(value) < .5), JSON.stringify(colorDifference));
  t.diagnostic(`restored blue channel differences: ${JSON.stringify(colorDifference)}`);
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  assert.equal((await app.evaluate(() => global.canvasTest.scene())).document.items[0].appearance.config.glowStrength, 0);
  await live.locator('[data-background-filters]').waitFor({ state: 'detached' });
  await page.screenshot({ path: path.join(evidence, 'desktop-original.png') });
  await captureArtwork(path.join(evidence, 'original-blue.png'));
  await page.locator('.background-parameters summary').filter({ hasText: '辉光' }).click();
  await field('glowThreshold').fill('90');
  await field('glowSoftness').fill('10');
  await field('glowStrength').fill('12');
  await field('glowStrength').press('Tab');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  await live.locator('[data-background-filters] filter').waitFor({ state: 'attached' });
  await page.screenshot({ path: path.join(evidence, 'desktop-canvas.png') });
  await captureArtwork(path.join(evidence, 'soft-blue.png'));
  assert.deepEqual(errors, []);
});
