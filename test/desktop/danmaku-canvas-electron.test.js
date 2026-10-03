const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron: electron, chromium } = require('playwright');

test('browser canvas keeps sandbox isolation and saves through the real desktop bridge', { timeout: 90000 }, async (t) => {
  const scratchRoot = path.resolve(__dirname, '../../tmp');
  await fs.mkdir(scratchRoot, { recursive: true });
  const directory = await fs.mkdtemp(path.join(scratchRoot, 'lira-canvas-electron-'));
  let app;
  let browser;
  t.after(async () => {
    await browser?.close();
    await app?.close();
    assert.equal(path.dirname(await fs.realpath(directory)), await fs.realpath(scratchRoot));
    await fs.rm(directory, { recursive: true, force: true });
  });
  app = await electron.launch({ cwd: path.resolve(__dirname, '../..'),
    args: ['test/fixtures/danmaku-canvas-editor.cjs', directory], timeout: 15000 });
  const desktop = await app.firstWindow();
  desktop.setDefaultTimeout(5000);
  const errors = [];
  desktop.on('pageerror', (error) => errors.push(error.message));
  await desktop.locator('#danmakuStyleChip').filter({ hasText: '已应用' }).waitFor();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const openPreview = async (count) => {
    await desktop.locator('#danmakuPreviewOverlayBtn').click();
    const deadline = Date.now() + 5000;
    let urls;
    do {
      urls = await app.evaluate(() => global.canvasTest.externalUrls);
      if (urls.length >= count) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    assert.equal(urls.length, count, 'Desktop must hand the editor URL to the external browser.');
    const url = urls.at(-1);
    assert.equal(new URL(url).pathname, '/c');
    assert.equal(new URL(url).search, '');
    assert.ok(url.length <= 47);
    assert.equal((await fetch(url)).status, 200);
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    await page.locator('.component-preview-frame').waitFor();
    await page.waitForFunction(() => document.querySelector('.component-preview-load-state')?.hidden);
    return page;
  };
  const page = await openPreview(1);
  await desktop.waitForFunction(() => document.getElementById('liveCanvasUrl').textContent.includes('保存并应用'));
  assert.equal(await desktop.locator('#copyLiveCanvasUrl').isDisabled(), true);
  assert.equal(app.windows().length, 1);
  assert.equal(await desktop.locator('.component-preview-dialog').count(), 0);
  assert.equal(await page.evaluate(() => Boolean(window.liraLicense || window.__API_TOKEN__)), false);
  const iframe = page.locator('.component-preview-frame');
  const frame = iframe.contentFrame();
  const source = new URL(await iframe.getAttribute('src'));
  assert.equal(source.pathname, '/danmaku');
  assert.deepEqual([...source.searchParams], [['preview', '1'], ['componentPreview', '1'], ['componentLayer', '1']]);
  assert.equal(source.hash, '');
  assert.equal(await iframe.getAttribute('sandbox'), 'allow-scripts');
  assert.equal(await frame.locator('body').evaluate(() => window.origin), 'null');
  assert.equal(await frame.locator('body').evaluate(() => {
    try { void parent.document.body; return false; } catch (error) { return error.name === 'SecurityError'; }
  }), true);
  assert.equal(await frame.locator('body').evaluate(() => typeof window.liraLicense), 'undefined');
  const childHtml = await frame.locator('html').evaluate((node) => node.outerHTML);
  assert.equal(childHtml.includes('synthetic-canvas-parent-secret'), false);
  assert.equal(childHtml.includes('syntheticKey_123'), false);
  const previewRequests = await app.evaluate(() => global.canvasTest.requests.filter((request) =>
    request.url.startsWith('/danmaku?')));
  assert.ok(previewRequests.length >= 2);
  assert.ok(previewRequests.every((request) => request.authorization === ''));
  const number = async (label) => Number(await page.getByRole('spinbutton', { name: label, exact: true }).inputValue());
  const change = async (label, value) => {
    const input = page.getByRole('spinbutton', { name: label, exact: true });
    await input.fill(String(value));
    await input.press('Tab');
  };
  assert.equal(await number('宽度'), 560);
  const previousX = await number('X');
  const box = await page.locator('.scene-editor-item').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  assert.ok(await number('X') > previousX);
  await change('宽度', 740);
  await page.locator('[data-danmaku-style="bubble"]').click();
  assert.equal(await number('宽度'), 740);
  await page.locator('[data-danmaku-style="signal"]').click();
  const fontSize = page.locator('[data-preview-field="danmakuFontSize"]');
  await fontSize.fill('36');
  await fontSize.press('Tab');
  await page.getByRole('button', { name: '画布设置', exact: true }).click();
  await page.getByRole('button', { name: '公共画布分辨率', exact: true }).click();
  await page.getByRole('option', { name: '2560 × 1440', exact: true }).click();
  await page.locator('.preview-canvas-layer-select').click();
  assert.equal(await number('宽度'), 987);
  assert.equal(await fontSize.inputValue(), '36');
  assert.equal(await app.evaluate(() => global.canvasTest.attempts), 0);
  assert.equal(await app.evaluate(() => global.canvasTest.scene().publishedVersion), 0);
  await page.reload();
  await fontSize.waitFor();
  assert.equal(await number('宽度'), 987);
  assert.equal(await fontSize.inputValue(), '36');
  await fontSize.fill('38');
  await fontSize.press('Tab');
  await fontSize.fill('36');
  await fontSize.press('Tab');
  assert.equal(await app.evaluate(() => global.canvasTest.attempts), 0, 'Refresh must retain an unsaved draft.');
  await app.evaluate(() => { global.canvasTest.failNext = true; });
  const save = page.getByRole('button', { name: '保存并应用', exact: true });
  const saveState = page.locator('.preview-canvas-status');
  await save.click();
  await saveState.filter({ hasText: '无法连接服务器' }).waitFor();
  assert.equal(await number('宽度'), 987);
  assert.equal(await app.evaluate(() => global.canvasTest.writes.length), 0);
  assert.equal(await app.evaluate(() => global.canvasTest.scene().publishedVersion), 0);
  assert.equal(await save.isEnabled(), true);
  assert.equal(await app.evaluate(() => global.canvasTest.componentSize()), null);
  assert.equal(await desktop.locator('#copyLiveCanvasUrl').isDisabled(), true);
  await save.click();
  await saveState.filter({ hasText: '已保存并应用到直播源' }).waitFor().catch(async (error) => {
    throw new Error(`Publication status: ${await saveState.textContent()}`, { cause: error });
  });
  assert.equal(await app.evaluate(() => global.canvasTest.saved().styleOptions.signal.fontSize), 36);
  const savedScene = await app.evaluate(() => global.canvasTest.scene());
  assert.equal(savedScene.document.canvas.width, 2560);
  assert.equal(savedScene.document.items[0].width, 987);
  assert.deepEqual(await app.evaluate(() => global.canvasTest.componentSize()), {
    width: savedScene.document.items[0].width, height: savedScene.document.items[0].height,
  });
  assert.equal(savedScene.publishedVersion, 1);
  // The desktop remains in the background: publication itself refreshes the address.
  await desktop.waitForFunction(() => !document.getElementById('copyLiveCanvasUrl').disabled);
  const liveSource = new URL(await desktop.locator('#liveCanvasUrl').textContent());
  assert.equal(liveSource.pathname, '/scene');
  assert.equal(liveSource.searchParams.get('id'), savedScene.document.id);
  assert.match(liveSource.hash, /^#token=/);
  assert.equal(await app.evaluate(() => global.canvasTest.requests.filter(request =>
    request.url.startsWith('/api/scenes/source?')).length), 1, 'Publication refreshes the source once.');
  assert.equal(await app.evaluate(() => global.canvasTest.writes.length), 1);
  assert.equal(await app.evaluate(() => global.canvasTest.attempts), 2);
  await page.close();
  const reopened = await openPreview(2);
  const urls = await app.evaluate(() => global.canvasTest.externalUrls);
  assert.equal(urls[0], urls[1], 'Reopening from Electron must preserve the editor capability.');
  assert.equal(await reopened.getByRole('spinbutton', { name: '宽度', exact: true }).inputValue(), '987');
  assert.equal(await reopened.locator('[data-preview-field="danmakuFontSize"]').inputValue(), '36');
  assert.deepEqual(errors, []);
});
