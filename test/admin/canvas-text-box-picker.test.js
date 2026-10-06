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
  assert.equal(await picker.getByRole('button', { name: '新建文本框', exact: true }).count(), 1);
  assert.equal(await picker.locator('[data-text-box-source]').count(), 1);
  const card = picker.locator(`[data-text-box-source="${source.id}"]`);
  assert.equal(await card.locator('.text-box-content').textContent(), '谢谢支持 \n(｡･ω･｡)ﾉ♡');
  assert.equal(await card.locator('img').getAttribute('src'), source.appearance.config.nodes[1].src);
  assert.equal(await card.locator('.text-box-content > span').first().evaluate(node => node.style.color), 'rgb(255, 225, 163)');
  assert.equal(await card.locator('iframe').count(), 0);
  await card.locator('img').evaluate(image => image.decode());
  const preview = await card.locator('.text-box-content').evaluate(async (text) => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const frame = text.parentElement.getBoundingClientRect();
    const content = text.getBoundingClientRect();
    return { centerX: content.x + content.width / 2 - frame.x - frame.width / 2,
      centerY: content.y + content.height / 2 - frame.y - frame.height / 2,
      fits: content.width <= frame.width - 31 && content.height <= frame.height - 31,
      fontSize: parseFloat(text.firstElementChild.style.fontSize) * new DOMMatrix(getComputedStyle(text).transform).a,
      align: text.style.textAlign, ratio: frame.width / frame.height };
  });
  assert.ok(Math.abs(preview.centerX) < 1 && Math.abs(preview.centerY) < 1, 'the content group is centered in the card');
  assert.ok(preview.fits && preview.fontSize >= 24, 'the text and loaded gift fit together at a readable size');
  assert.equal(preview.align, 'right', 'thumbnail centering preserves the authored line alignment');
  assert.ok(preview.ratio > 2.2, 'text previews use a compact horizontal frame');
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
  assert.equal(await page.locator(`.preview-canvas-layer-select[data-item-id="${copy.id}"]`).getAttribute('aria-pressed'), 'true');
  const editor = page.getByRole('textbox', { name: '文本框内容', exact: true });
  assert.equal(await editor.getAttribute('contenteditable'), 'true');
  await editor.click();
  await editor.press('Control+End');
  await page.keyboard.insertText(' 新的祝福');
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items[1].appearance.config.nodes.some(node => node.text?.includes('新的祝福')));
  assert.deepEqual((await readItems())[0], source, 'customizing the copy preserves the original config and geometry');
  assert.deepEqual((await readItems())[1].appearance.config.nodes.find(node => node.type === 'gift'), source.appearance.config.nodes[1]);
  await openTextBoxes();
  assert.equal(await picker.locator('[data-text-box-source]').count(), 2, 'reopening reads the current scene without duplicate cards');
  assert.match(await picker.locator(`[data-text-box-source="${copy.id}"] .text-box-content`).textContent(), /新的祝福/);
  await picker.getByRole('button', { name: '新建文本框', exact: true }).click();
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items.length === 3);
  assert.deepEqual((await readItems())[2].appearance.config, createTextBoxDefaults());
  await editor.fill(Array(8).fill('直播公告与互动说明').join('\n'));
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items[2].appearance.config.nodes[0].text.includes('直播公告'));
  const multilineId = (await readItems())[2].id;
  await openTextBoxes();
  assert.equal(await picker.locator(`[data-text-box-source="${multilineId}"] .text-box-content`).evaluate(async (text) => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const frame = text.parentElement.getBoundingClientRect();
    const content = text.getBoundingClientRect();
    return frame.height > frame.width / 1.5 && content.width <= frame.width - 31 && content.height <= frame.height - 31;
  }), true, 'multiline text gets a taller frame and remains fully visible');
  await picker.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await desktop.waitForFunction(() => !window.controllers.canvas.getState().dirty && !window.controllers.canvas.getState().saving);
  assert.equal(fixture.service.list()[0].document.items.length, 3);
  assert.deepEqual(errors, []);
});
