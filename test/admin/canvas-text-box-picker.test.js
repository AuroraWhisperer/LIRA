'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const { createComponentWebLibrary } = require('../../src/server/component-web-library');
const { createTextBoxDefaults } = require('../../public/js/shared/text-box-config.js');
const { useSharedBrowser } = require('../helpers/shared-browser');
const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');
const { createScratchDirectory } = require('../helpers/scratch-directory');

const openBrowserSession = useSharedBrowser();

test('a native CSS text box can be selected, edited and published with its stylesheet', async t => {
  const browser = openBrowserSession();
  t.after(() => browser.close());
  const dataDir = createScratchDirectory('text-box-css-', t);
  const fixture = await startCanvasOutputFixture({ dataDir });
  t.after(() => fixture.close());
  await createComponentWebLibrary(dataDir).add([{ path: 'ink.css', stream: Readable.from(['body { --text-box-ink: #123456; }']) }],
    { type: 'text-box', entry: 'ink.css', name: '墨色文本' }, () => {});
  const desktop = await browser.newPage();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(5000);
  const editorUrl = await openCanvasDesktop(desktop, fixture);
  assert.equal((await fetch(editorUrl)).status, 200);
  await page.goto(editorUrl);
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '添加组件' });
  await picker.locator('[data-category="text-box"]').click();
  await picker.getByRole('button', { name: '添加到画布：墨色文本', exact: true }).click();
  await picker.waitFor({ state: 'hidden' });
  await page.getByRole('textbox', { name: '文本框内容' }).fill('今晚见');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  const source = fixture.service.getSource(fixture.service.getCanvas().outputId);
  const outputUrl = `${fixture.origin}/scene?id=${source.id}#token=${source.token}`;
  assert.equal((await fetch(outputUrl)).status, 200);
  await page.goto(outputUrl);
  const text = page.frameLocator('.scene-version:not(.is-staging) iframe').locator('#textBox');
  await text.getByText('今晚见', { exact: true }).waitFor();
  assert.equal(await text.evaluate(node => getComputedStyle(node).getPropertyValue('--text-box-ink').trim()), '#123456');
});

test('canvas can reuse a configured desktop text box, customize the independent copy and create a new one', { timeout: 45000 }, async (t) => {
  const browser = openBrowserSession();
  t.after(() => browser.close());
  const fixture = await startCanvasOutputFixture();
  t.after(() => fixture.close());
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
  const scrollMode = page.getByRole('radiogroup', { name: '自动滚动', exact: true });
  await scrollMode.getByRole('radio', { name: '横向', exact: true }).click();
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items[1].appearance.config.scrollMode === 'horizontal');
  await page.getByRole('slider', { name: '滚动速度', exact: true }).fill('85');
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items[1].appearance.config.scrollSpeed === 85);
  await scrollMode.getByRole('radio', { name: '纵向', exact: true }).click();
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
