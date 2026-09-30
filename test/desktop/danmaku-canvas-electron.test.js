const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron: electron } = require('playwright');

test('canvas editor keeps sandbox isolation and saves through the real desktop bridge', { timeout: 90000 }, async (t) => {
  const scratchRoot = path.resolve(__dirname, '../../tmp');
  await fs.mkdir(scratchRoot, { recursive: true });
  const directory = await fs.mkdtemp(path.join(scratchRoot, 'lira-canvas-electron-'));
  let app;
  t.after(async () => {
    await app?.close();
    assert.equal(path.dirname(await fs.realpath(directory)), await fs.realpath(scratchRoot));
    await fs.rm(directory, { recursive: true, force: true });
  });
  app = await electron.launch({ cwd: path.resolve(__dirname, '../..'),
    args: ['test/fixtures/danmaku-canvas-editor.cjs', directory], timeout: 15000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(4000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('#danmakuStyleChip').filter({ hasText: '已应用' }).waitFor();
  await page.locator('#danmakuPreviewOverlayBtn').click();
  const dialog = page.locator('.component-preview-dialog');
  const iframe = dialog.locator('iframe');
  const frame = iframe.contentFrame();
  const labels = { regionX: '区域 X', regionY: '区域 Y', regionWidth: '区域宽度', regionHeight: '区域高度',
    canvasWidth: '画布宽度', canvasHeight: '画布高度' };
  const field = (id) => id === 'previewFontSize' ? dialog.locator('[data-preview-field="danmakuFontSize"]')
    : dialog.getByLabel(labels[id], { exact: true });
  const number = async (id) => Number(await field(id).inputValue());
  const change = async (id, value) => {
    await field(id).fill(String(value));
    await field(id).press('Tab');
  };
  const pointerPosition = async (locator) => {
    const local = await locator.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2,
        width: window.innerWidth, height: window.innerHeight };
    });
    const outer = await iframe.boundingBox();
    return { x: outer.x + local.x * outer.width / local.width,
      y: outer.y + local.y * outer.height / local.height };
  };
  const saveState = dialog.locator('.component-preview-footer [role="status"]');
  const save = dialog.getByRole('button', { name: '保存并应用', exact: true });
  await saveState.filter({ hasText: '当前为已保存配置' }).waitFor();
  await frame.locator('#danmakuSelection').waitFor({ state: 'visible' });
  assert.equal(await save.isDisabled(), true);
  const source = new URL(await iframe.getAttribute('src'));
  assert.equal(source.pathname, '/danmaku');
  assert.deepEqual([...source.searchParams], [['preview', '1'], ['componentPreview', '1']]);
  assert.equal(source.hash, '');
  assert.equal(await iframe.getAttribute('sandbox'), 'allow-scripts');
  assert.equal(await number('regionX'), 40);
  assert.equal(await number('regionY'), 440);
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
  // Wait for the hidden window's initial composite before routing input to its iframe.
  await app.evaluate(async ({ BrowserWindow }) => {
    await BrowserWindow.getAllWindows()[0].webContents.capturePage();
  });
  let point = await pointerPosition(frame.locator('#danmakuSelection'));
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 80, point.y - 40, { steps: 4 });
  await page.mouse.up();
  assert.ok(await number('regionX') > 40, JSON.stringify({ point, x: await number('regionX'), y: await number('regionY') }));
  for (const handle of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
    await dialog.getByRole('button', { name: '恢复区域默认', exact: true }).click();
    const previous = { width: await number('regionWidth'), height: await number('regionHeight') };
    point = await pointerPosition(frame.locator(`[data-handle='${handle}']`));
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 12, point.y - 12, { steps: 3 });
    await page.mouse.up();
    assert.ok(await number('regionWidth') !== previous.width || await number('regionHeight') !== previous.height, handle);
  }
  await change('regionWidth', 740);
  await dialog.locator('[data-danmaku-style="bubble"]').click();
  assert.equal(await number('regionWidth'), 380);
  await dialog.locator('[data-danmaku-style="signal"]').click();
  assert.equal(await number('regionWidth'), 740);
  await dialog.getByLabel('直播画布分辨率', { exact: true }).selectOption('2560x1440');
  assert.equal(await number('regionWidth'), 987);
  assert.equal(await number('previewFontSize'), 30);
  const effectiveFontSize = () => frame.locator('html').evaluate((node) => Math.round(
    Number.parseFloat(node.style.getPropertyValue('--content-scale'))
    * Number.parseFloat(node.style.getPropertyValue('--danmaku-font-size'))));
  assert.equal(await effectiveFontSize(), 40);
  await dialog.getByLabel('直播画布分辨率', { exact: true }).selectOption('1080x1920');
  assert.equal(await effectiveFontSize(), 40);
  await dialog.getByRole('button', { name: '区域居中', exact: true }).click();
  await frame.locator('#danmakuSelection').focus();
  const x = await number('regionX');
  await frame.locator('#danmakuSelection').press('Shift+ArrowLeft');
  assert.equal(await number('regionX'), x - 10);
  await change('regionWidth', -1);
  assert.equal(await number('regionWidth'), 64);
  await change('regionWidth', 987);
  await change('regionWidth', 987.5);
  assert.equal(await number('regionWidth'), 987);
  assert.equal(await app.evaluate(() => global.canvasTest.attempts), 0);
  assert.equal(await app.evaluate(() => global.canvasTest.saved().layout), null);
  await app.evaluate(() => { global.canvasTest.failNext = true; });
  await save.click();
  await saveState.filter({ hasText: '草稿已保留' }).waitFor();
  assert.equal(await number('regionWidth'), 987);
  assert.equal(await app.evaluate(() => global.canvasTest.writes.length), 0);
  assert.equal(await save.isEnabled(), true);
  await save.click();
  await saveState.filter({ hasText: '已保存，已发布更新' }).waitFor();
  const saved = await app.evaluate(() => global.canvasTest.saved());
  assert.equal(saved.layout.canvas.height, 1920);
  assert.equal(saved.layout.regions.signal.width, 987);
  assert.equal(await app.evaluate(() => global.canvasTest.writes.length), 1);
  assert.equal(await app.evaluate(() => global.canvasTest.attempts), 2);
  assert.equal(await save.isDisabled(), true);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('#danmakuPreviewOverlayBtn').click();
  await saveState.filter({ hasText: '已保存，已发布更新' }).waitFor();
  assert.equal(await number('canvasHeight'), 1920);
  assert.equal(await number('regionWidth'), 987);
  assert.deepEqual(errors, []);
});
