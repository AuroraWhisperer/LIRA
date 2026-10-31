const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { launchElectron } = require('../helpers/shared-electron');

test('notebook selects, saves, reopens and shares the real renderer with the desktop canvas', { timeout: 45000 }, async t => {
  const root = path.resolve(__dirname, '../../tmp');
  const directory = await fs.mkdtemp(path.join(root, 'notebook-desktop-'));
  const evidence = path.join(root, 'notebook-client-integration');
  await fs.mkdir(evidence, { recursive: true });
  let app;
  let browser;
  t.after(async () => {
    await browser?.close();
    await app?.close();
    assert.equal(path.dirname(await fs.realpath(directory)), await fs.realpath(root));
    await fs.rm(directory, { recursive: true, force: true });
  });
  app = await launchElectron({ cwd: path.resolve(__dirname, '../..'),
    args: ['test/fixtures/danmaku-canvas-editor.cjs', directory], timeout: 15000 });
  const desktop = await app.firstWindow();
  await desktop.waitForURL('**/admin', { waitUntil: 'load', timeout: 15000 });
  desktop.setDefaultTimeout(6000);
  const errors = [];
  desktop.on('pageerror', error => errors.push(error.message));
  await desktop.locator('#danmakuStyleChip').filter({ hasText: '已应用' }).waitFor();
  await desktop.locator('[data-danmaku-style="notebook"]').click();
  assert.equal(await desktop.locator('#danmakuFontSize').inputValue(), '23');
  await desktop.locator('#danmakuFontSize').fill('24');
  await desktop.locator('#danmakuFontSize').press('Tab');
  await desktop.getByRole('button', { name: '保存外观', exact: true }).click();
  await desktop.locator('#danmakuStyleChip').filter({ hasText: '已应用样式 · 手账风' }).waitFor();
  assert.equal(await app.evaluate(() => global.canvasTest.saved().style), 'notebook');
  assert.equal(await app.evaluate(() => global.canvasTest.saved().styleOptions.notebook.fontSize), 24);
  await desktop.reload({ waitUntil: 'domcontentloaded' });
  await desktop.locator('[data-danmaku-style="notebook"][aria-pressed="true"]').waitFor();
  assert.equal(await desktop.locator('#danmakuFontSize').inputValue(), '24');
  await desktop.locator('[data-danmaku-style="notebook"] img').evaluate(image => image.decode());
  assert.equal(await desktop.locator('[data-danmaku-style="notebook"] img').evaluate(n => n.complete && n.naturalWidth > 0), true);
  await desktop.screenshot({ path: path.join(evidence, 'electron-style-selection.png') });

  await desktop.locator('#danmakuPreviewOverlayBtn').click();
  let url;
  for (let attempt = 0; attempt < 100 && !url; attempt++) {
    url = (await app.evaluate(() => global.canvasTest.externalUrls)).at(-1);
    if (!url) await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal((await fetch(url)).status, 200);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(6000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  const frame = page.locator('.component-preview-frame').contentFrame();
  await frame.locator('body[data-style="notebook"] .notebook-item').first().waitFor();
  assert.equal(await frame.locator('.danmaku-signal-header').isVisible(), false);
  const font = page.locator('[data-preview-field="danmakuFontSize"]');
  assert.equal(await font.inputValue(), '24');
  await font.fill('26');
  await font.press('Tab');
  await frame.locator('html').evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  assert.equal(await frame.locator('html').evaluate(n => getComputedStyle(n).getPropertyValue('--danmaku-font-size').trim()), '26px');
  assert.equal(await app.evaluate(() => global.canvasTest.saved().styleOptions.notebook.fontSize), 24);
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用到直播源' }).waitFor();
  assert.equal(await app.evaluate(() => global.canvasTest.saved().styleOptions.notebook.fontSize), 26);
  await frame.locator('#danmakuFeed').evaluate(root => new Promise(resolve => {
    function settled() {
      if (!root.querySelector('[data-live-entry]')) resolve();
      else requestAnimationFrame(settled);
    }
    settled();
  }));
  await page.screenshot({ path: path.join(evidence, 'electron-canvas-preview.png') });
  await desktop.reload({ waitUntil: 'domcontentloaded' });
  await desktop.locator('[data-danmaku-style="notebook"][aria-pressed="true"]').waitFor();
  assert.equal(await desktop.locator('#danmakuFontSize').inputValue(), '26');
  assert.deepEqual(errors, []);
});
