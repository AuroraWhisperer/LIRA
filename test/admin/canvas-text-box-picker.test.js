'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright');
const { createTextBoxDefaults } = require('../../public/js/shared/text-box-config.js');
const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');

test('canvas can reuse a configured desktop text box, customize the independent copy and create a new one', { timeout: 45000 }, async (t) => {
  const fixture = await startCanvasOutputFixture();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await fixture.close(); });
  const desktop = await browser.newPage();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const source = { id: randomUUID(), type: 'text-box', name: '礼物感谢', x: 120, y: 80, width: 960, height: 270,
    visible: false, locked: true, appearance: { mode: 'independent', config: { ...createTextBoxDefaults(), align: 'right', nodes: [
      { type: 'text', text: '谢谢支持 ', bold: true, stroke: true, shadow: true, color: '#ffe1a3', fontSize: 48 },
      { type: 'gift', name: '总督', src: '/img/admin/gifts/bilibili-guard-governor.webp', fontSize: 48 },
      { type: 'text', text: '\n(｡･ω･｡)ﾉ♡' },
    ] } } };
  const created = fixture.service.create({ title: '文本框复用', canvas: { width: 1920, height: 1080 } });
  fixture.service.save({ id: created.document.id, expectedRevision: created.revision,
    document: { ...created.document, items: [source] } });
  const url = await openCanvasDesktop(desktop, fixture);
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.locator(`.preview-canvas-layer-select[data-item-id="${source.id}"]`).waitFor();
  const picker = page.getByRole('dialog', { name: '添加组件', exact: true });
  const openTextBoxes = async () => {
    await page.getByRole('button', { name: '添加组件', exact: true }).click();
    await picker.locator('[data-category="text-box"]').click();
  };
  await openTextBoxes();
  const card = picker.locator(`[data-text-box-source="${source.id}"]`);
  await card.click();
  await picker.waitFor({ state: 'hidden' });
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items.length === 2);
  const readItems = () => desktop.evaluate(() => window.controllers.canvas.getState().draft.document.items);
  const [original, copy] = await readItems();
  assert.deepEqual(original, source);
  assert.notEqual(copy.id, source.id);
  assert.equal(copy.name, '礼物感谢 副本');
  assert.deepEqual(copy.appearance, source.appearance);
  assert.deepEqual([copy.width, copy.height, copy.visible, copy.locked], [960, 270, true, false]);
  const editor = page.getByRole('textbox', { name: '文本框内容', exact: true });
  await editor.click();
  await editor.press('Control+End');
  await page.keyboard.insertText(' 新的祝福');
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items[1].appearance.config.nodes.some(node => node.text?.includes('新的祝福')));
  assert.deepEqual((await readItems())[0], source, 'customizing the copy preserves the original config and geometry');
  assert.deepEqual((await readItems())[1].appearance.config.nodes.find(node => node.type === 'gift'), source.appearance.config.nodes[1]);
  await page.getByRole('switch', { name: '横向滚动', exact: true }).check();
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items[1].appearance.config.scrollMode === 'horizontal');
  await page.getByRole('slider', { name: '滚动速度', exact: true }).fill('85');
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items[1].appearance.config.scrollSpeed === 85);
  await page.getByRole('switch', { name: '纵向滚动', exact: true }).check();
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items[1].appearance.config.scrollMode === 'vertical');
  assert.equal((await readItems())[0].appearance.config.scrollMode, 'none', 'scrolling belongs to the selected instance');
  assert.equal((await readItems())[0].appearance.config.scrollSpeed, 40, 'speed belongs to the selected instance');
  await openTextBoxes();
  await picker.getByRole('button', { name: '新建文本框', exact: true }).click();
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items.length === 3);
  assert.deepEqual((await readItems())[2].appearance.config, createTextBoxDefaults());
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await desktop.waitForFunction(() => !window.controllers.canvas.getState().dirty && !window.controllers.canvas.getState().saving);
  assert.equal(fixture.service.list()[0].document.items.length, 3);
  assert.equal(fixture.service.list()[0].document.items[1].appearance.config.scrollMode, 'vertical');
  assert.equal(fixture.service.list()[0].document.items[1].appearance.config.scrollSpeed, 85);
  assert.deepEqual(errors, []);
});
