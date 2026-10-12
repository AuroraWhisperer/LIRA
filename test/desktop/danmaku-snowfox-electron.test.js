const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { launchElectron } = require('../helpers/shared-electron');

test('snowfox palette saves, reopens and restores identity colors through the desktop and canvas', { timeout: 45000 }, async (t) => {
  const root = path.resolve(__dirname, '../../tmp');
  const directory = await fs.mkdtemp(path.join(root, 'snowfox-desktop-'));
  let app;
  let browser;
  t.after(async () => {
    await browser?.close(); await app?.close();
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
  await desktop.locator('[data-danmaku-style="snowfox"]').click();
  assert.equal(await desktop.locator('#danmakuBubbleColorMode').inputValue(), 'default');
  await desktop.locator('#danmakuBubbleColorMode').selectOption('custom');
  await desktop.locator('#danmakuBubbleColor').click();
  await desktop.getByRole('textbox', { name: '十六进制颜色', exact: true }).fill('#ba739c');
  await desktop.getByRole('button', { name: '完成', exact: true }).click();
  await desktop.getByRole('button', { name: '应用到直播画面', exact: true }).click();
  await desktop.locator('#danmakuStyleChip').filter({ hasText: '已应用样式 · 雪狐物语' }).waitFor();
  assert.equal(await app.evaluate(() => global.canvasTest.saved().styleOptions.snowfox.bubbleColor), '#ba739c');
  await desktop.reload();
  await desktop.locator('[data-danmaku-style="snowfox"][aria-pressed="true"]').waitFor();
  assert.equal(await desktop.locator('#danmakuBubbleColorMode').inputValue(), 'custom');
  assert.equal(await desktop.locator('#danmakuBubbleColor').inputValue(), '#ba739c');
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
  await frame.locator('body[data-style="snowfox"] .draw-danmaku-item').first().waitFor();
  const palette = page.locator('[data-preview-field="danmakuBubbleColorMode"]');
  assert.equal(await palette.inputValue(), 'custom');
  assert.equal(await frame.locator('html').evaluate(node => getComputedStyle(node).getPropertyValue('--danmaku-bubble-color').trim()), '#ba739c');
  await palette.selectOption('default');
  await frame.locator('html').evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  assert.equal(await frame.locator('html').evaluate(node => getComputedStyle(node).getPropertyValue('--danmaku-bubble-color').trim()), '');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用到直播源' }).waitFor();
  assert.equal(await app.evaluate(() => global.canvasTest.saved().styleOptions.snowfox.bubbleColor), 'default');
  await desktop.reload();
  await desktop.locator('[data-danmaku-style="snowfox"][aria-pressed="true"]').waitFor();
  assert.equal(await desktop.locator('#danmakuBubbleColorMode').inputValue(), 'default');
  assert.equal(await desktop.locator('#danmakuBubbleColorField').isVisible(), false);
  assert.deepEqual(errors, []);
});
