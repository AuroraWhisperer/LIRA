const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

test('canvas editor keeps sandbox isolation and saves through the real desktop bridge', { timeout: 90000 }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lira-canvas-electron-'));
  const app = await electron.launch({ cwd: path.resolve(__dirname, '../..'),
    args: ['test/fixtures/danmaku-canvas-editor.cjs', directory], timeout: 15000 });
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const page = await app.firstWindow();
  page.setDefaultTimeout(4000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('#danmakuStyleChip').filter({ hasText: '已应用' }).waitFor();
  await page.locator('#danmakuPreviewOverlayBtn').click();
  const frame = page.frameLocator('.danmaku-canvas-dialog iframe');
  const number = async (id) => Number(await frame.locator(`#${id}`).inputValue());
  const change = async (id, value) => {
    await frame.locator(`#${id}`).fill(String(value));
    await frame.locator(`#${id}`).press('Tab');
  };
  await frame.locator('#previewSaveState').filter({ hasText: '调整后' }).waitFor();
  assert.equal(await number('regionX'), 40);
  assert.equal(await number('regionY'), 440);
  assert.equal(await frame.locator('body').evaluate(() => window.origin), 'null');
  assert.equal(await frame.locator('body').evaluate(() => {
    try { void parent.document.body; return false; } catch (error) { return error.name === 'SecurityError'; }
  }), true);
  assert.equal(await frame.locator('body').evaluate(() => typeof window.liraLicense), 'undefined');
  // Wait for the hidden window's initial composite before routing input to its iframe.
  await app.evaluate(async ({ BrowserWindow }) => {
    await BrowserWindow.getAllWindows()[0].webContents.capturePage();
  });
  await frame.locator('#danmakuSelection').click();
  let box = await frame.locator('#danmakuSelection').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 - 40, { steps: 4 });
  await page.mouse.up();
  assert.ok(await number('regionX') > 40, JSON.stringify({ box, x: await number('regionX'), y: await number('regionY') }));
  for (const handle of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
    await frame.locator('#regionReset').click();
    const previous = { width: await number('regionWidth'), height: await number('regionHeight') };
    box = await frame.locator(`[data-handle='${handle}']`).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 - 12, { steps: 3 });
    await page.mouse.up();
    assert.ok(await number('regionWidth') !== previous.width || await number('regionHeight') !== previous.height, handle);
  }
  await change('regionWidth', 740);
  await frame.locator('[data-preview-style="bubble"]').click();
  assert.equal(await number('regionWidth'), 380);
  await frame.locator('[data-preview-style="signal"]').click();
  assert.equal(await number('regionWidth'), 740);
  await frame.locator('#canvasPreset').selectOption('2560x1440');
  assert.equal(await number('regionWidth'), 987);
  assert.equal(await number('previewFontSize'), 40);
  await frame.locator('#canvasPreset').selectOption('1080x1920');
  assert.equal(await number('previewFontSize'), 40);
  await frame.locator('#regionCenter').click();
  await frame.locator('#danmakuSelection').focus();
  const x = await number('regionX');
  await frame.locator('#danmakuSelection').press('Shift+ArrowLeft');
  assert.equal(await number('regionX'), x - 10);
  await change('regionWidth', -1);
  assert.equal(await number('regionWidth'), 987);
  await app.evaluate(() => { global.canvasTest.failNext = true; });
  await frame.locator('#previewApply').click();
  await frame.locator('#previewSaveState').filter({ hasText: '应用失败，草稿已保留' }).waitFor();
  assert.equal(await number('regionWidth'), 987);
  await frame.locator('#previewApply').click();
  await frame.locator('#previewSaveState').filter({ hasText: '已应用到直播画面' }).waitFor();
  const saved = await app.evaluate(() => global.canvasTest.saved());
  assert.equal(saved.layout.canvas.height, 1920);
  assert.equal(saved.layout.regions.signal.width, 987);
  assert.equal(await app.evaluate(() => global.canvasTest.writes.length), 1);
  await frame.locator('#previewClose').click();
  await page.locator('#danmakuPreviewOverlayBtn').click();
  await frame.locator('#previewSaveState').filter({ hasText: '调整后' }).waitFor();
  assert.equal(await number('canvasHeight'), 1920);
  assert.equal(await number('regionWidth'), 987);
  assert.deepEqual(errors, []);
});
