'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron: electron } = require('playwright');

test('desktop text formatting survives rapid toggles, undo, publication and reopening', { timeout: 60000 }, async t => {
  const root = path.resolve(__dirname, '../..');
  const scratchRoot = path.join(root, 'tmp');
  await fs.mkdir(scratchRoot, { recursive: true });
  const directory = await fs.mkdtemp(path.join(scratchRoot, 'text-box-electron-test-'));
  const markup = await fs.readFile(path.join(root, 'public/pages/admin/toolbox/text-box.html'), 'utf8');
  let app;
  t.after(async () => {
    await app?.close();
    assert.equal(path.dirname(await fs.realpath(directory)), await fs.realpath(scratchRoot));
    await fs.rm(directory, { recursive: true, force: true });
  });
  app = await electron.launch({ cwd: root, args: ['test/fixtures/danmaku-canvas-editor.cjs', directory], timeout: 15000 });
  const desktop = await app.firstWindow();
  desktop.setDefaultTimeout(5000);
  const errors = [];
  desktop.on('pageerror', error => errors.push(error.message));
  async function openTextBoxes() {
    await desktop.locator('#danmakuStyleChip').filter({ hasText: '已应用' }).waitFor();
    // Reuse the fixture's authorized desktop session and real scene owner.
    await desktop.evaluate(async markup => {
      const html = new DOMParser().parseFromString(markup, 'text/html');
      document.body.replaceChildren(html.getElementById('textBoxPage'));
      const { enhanceSelects } = await import('/js/shared/select-menu.js');
      const { enhanceColorControls } = await import('/js/shared/color-control.js');
      const { initTextBoxes } = await import('/js/admin/text-box.js');
      enhanceSelects(); enhanceColorControls(); initTextBoxes();
    }, markup);
  }
  await openTextBoxes();
  await desktop.locator('[data-text-box="add"]').click({ force: true });
  await desktop.evaluate(async () => {
    const { prepareComponentPreviews } = await import('/js/admin/component-preview-registry.js');
    window.textBoxCanvas = (await prepareComponentPreviews()).find(component => component.id === 'canvas');
    const { document } = textBoxCanvas.controller.getState().draft;
    const gift = { type: 'gift', name: '舰长', src: '/img/admin/gifts/bilibili-guard-captain.webp' };
    document.items[0].appearance.config.nodes = [{ type: 'text', text: '在这里输入文字' }, gift, gift];
    textBoxCanvas.controller.edit({ document });
  });
  const editor = desktop.locator('.text-box-editor');
  await editor.focus();
  await desktop.keyboard.press('Control+a');
  const timings = [];
  for (let cycle = 0; cycle < 100; cycle++) {
    const start = performance.now();
    // Hidden Electron windows throttle animation frames; force skips only the
    // actionability wait, while retaining real mouse input and click handlers.
    for (const name of ['加粗 (Ctrl+B)', '斜体 (Ctrl+I)', '下划线 (Ctrl+U)']) {
      await desktop.getByRole('button', { name, exact: true }).click({ force: true });
    }
    const more = desktop.getByRole('button', { name: '更多文字格式', exact: true });
    if (await more.getAttribute('aria-expanded') === 'false') await more.click({ force: true });
    await desktop.getByRole('button', { name: '文字描边', exact: true }).click({ force: true });
    await desktop.getByRole('button', { name: '轻阴影', exact: true }).click({ force: true });
    timings.push(performance.now() - start);
  }
  t.diagnostic(`500 format clicks: ${Math.round(timings.reduce((sum, value) => sum + value, 0))} ms; slowest five-click cycle: ${Math.round(Math.max(...timings))} ms`);
  const readNodes = () => desktop.evaluate(() => textBoxCanvas.controller.getState().draft.document.items[0].appearance.config.nodes);
  const nodes = await readNodes();
  assert.equal(nodes[0].text, '在这里输入文字');
  assert.equal(nodes.filter(node => node.type === 'gift').length, 2);
  for (const key of ['bold', 'italic', 'underline', 'stroke', 'shadow']) assert.ok(!nodes[0][key], key);
  assert.ok(await editor.locator('*').count() < 20, 'rapid formatting must keep the editor DOM bounded');
  await desktop.keyboard.press('Control+z');
  assert.equal((await readNodes())[0].shadow, true);
  await desktop.keyboard.press('Control+Shift+z');
  assert.equal(Boolean((await readNodes())[0].shadow), false);
  await editor.focus();
  await desktop.keyboard.press('Control+a');
  await desktop.getByRole('button', { name: '下划线 (Ctrl+U)', exact: true }).click({ force: true });
  const frame = desktop.frames().find(frame => new URL(frame.url()).pathname === '/text-box');
  await frame.waitForFunction(() => getComputedStyle(document.querySelector('#textBox > span')).textDecorationLine === 'underline');
  const output = frame.locator('#textBox > span').first();
  assert.equal(await output.evaluate(node => getComputedStyle(node).textDecorationSkipInk), 'none');
  assert.ok(await output.evaluate(node => parseFloat(getComputedStyle(node).textUnderlineOffset) > 0));
  await desktop.locator('[data-text-box="save"]').click({ force: true });
  await desktop.waitForFunction(() => document.querySelector('[data-text-box="status"]').textContent === '已保存');
  const saved = await app.evaluate(() => global.canvasTest.scene());
  assert.equal(saved.document.items[0].appearance.config.nodes[0].underline, true);
  assert.ok(saved.publishedVersion > 0);
  assert.equal((await desktop.reload()).status(), 200);
  await openTextBoxes();
  await desktop.frameLocator('.component-preview-frame').locator('#textBox > span').first().waitFor();
  assert.equal(await editor.locator('[data-text-box-node]').count(), 2);
  assert.equal(await desktop.frameLocator('.component-preview-frame').locator('#textBox > span').first()
    .evaluate(node => getComputedStyle(node).textDecorationLine), 'underline');
  assert.deepEqual(errors, []);
});
