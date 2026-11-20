const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { launchElectron } = require('../helpers/shared-electron');

test('notebook selects, saves, reopens and shares the real renderer with the desktop canvas', { timeout: 45000 }, async t => {
  const root = path.resolve(__dirname, '../../tmp');
  const directory = await fs.mkdtemp(path.join(root, 'notebook-desktop-'));
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
  await desktop.locator('#danmakuFontSize:enabled').waitFor({ state: 'attached' });
  await desktop.getByRole('button', { name: '全部样式', exact: true }).click();
  await desktop.locator('[data-danmaku-style="notebook"]').click();
  await desktop.locator('#danmakuFontSize').evaluate(input => {
    input.value = '24';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await desktop.locator('#danmakuFontSize').press('Tab');
  const savedFontSize = () => app.evaluate(() => global.canvasTest.saved().styleOptions.notebook?.fontSize);
  await t.waitFor(async () => assert.equal(await savedFontSize(), 24), { timeout: 6000 });
  await desktop.reload({ waitUntil: 'domcontentloaded' });
  await desktop.locator('[data-recent-danmaku-style="notebook"][aria-pressed="true"]').waitFor();
  assert.equal(await desktop.locator('#danmakuFontSize').inputValue(), '24');

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
  const font = page.locator('[data-preview-field="danmakuFontSize"]');
  assert.equal(await font.inputValue(), '24');
  await font.press('ArrowRight');
  await font.press('ArrowRight');
  await font.press('Tab');
  await t.waitFor(async () => {
    const previewSize = await frame.locator('html').evaluate(root => getComputedStyle(root).getPropertyValue('--danmaku-font-size').trim());
    assert.equal(previewSize, '26px');
  }, { timeout: 6000 });
  assert.equal(await savedFontSize(), 24, 'Previewing the new size must leave the saved desktop size alone.');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await t.waitFor(async () => assert.ok(await app.evaluate(() => global.canvasTest.scene().publishedVersion > 0)), { timeout: 6000 });
  await desktop.reload({ waitUntil: 'domcontentloaded' });
  await desktop.locator('[data-recent-danmaku-style="notebook"][aria-pressed="true"]').waitFor();
  assert.equal(await desktop.locator('#danmakuFontSize').inputValue(), '26');
  assert.deepEqual(errors, []);
});
