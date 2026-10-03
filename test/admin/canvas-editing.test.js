'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { chromium } = require('playwright');
const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');

let browser;
test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

async function editor(t) {
  const fixture = await startCanvasOutputFixture();
  const desktopContext = await browser.newContext();
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const desktop = await desktopContext.newPage();
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => {
    await context.close();
    await desktopContext.close();
    await fixture.close();
    assert.deepEqual(errors, []);
  });
  const url = await openCanvasDesktop(desktop, fixture, 'danmaku');
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('.component-preview-load-state')?.hidden);
  return { page, desktop };
}

async function poll(page) {
  await page.waitForResponse(response => response.url().endsWith('/api/component-preview')
    && response.request().postDataJSON()?.action === 'read');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
}

test('canvas inputs preserve native selection, clipboard and undo across preview polling', { timeout: 30000 }, async (t) => {
  const { page, desktop } = await editor(t);
  const font = page.locator('[data-preview-field="danmakuFontSize"]');
  await font.click();
  await font.press('Control+a');
  await page.keyboard.type('36', { delay: 300 });
  await poll(page);
  assert.equal(await font.inputValue(), '36');
  await font.press('Control+a');
  await font.press('Control+c');
  await font.press('Control+x');
  await poll(page);
  assert.equal(await font.inputValue(), '');
  await font.press('Control+v');
  assert.equal(await font.inputValue(), '36');
  await font.press('Control+z');
  assert.equal(await font.inputValue(), '');
  await font.press('Control+y');
  assert.equal(await font.inputValue(), '36');
  await font.press('Tab');
  await desktop.waitForFunction(() => window.controllers.danmaku.getState().draft.styleOptions.signal?.fontSize === 36);

  const name = page.getByRole('textbox', { name: '组件名称', exact: true });
  await name.click();
  await name.press('Control+a');
  await page.keyboard.type('Canvas title');
  await name.press('Home');
  await name.press('Shift+ArrowRight');
  await poll(page);
  assert.deepEqual(await name.evaluate(node => [node.selectionStart, node.selectionEnd]), [0, 1]);
  assert.equal(await name.inputValue(), 'Canvas title');
  await name.press('Delete');
  assert.equal(await name.inputValue(), 'anvas title');
  assert.equal(await page.locator('.scene-editor-item').count(), 1);
  await name.press('Control+z');
  assert.equal(await name.inputValue(), 'Canvas title');
  await name.press('Tab');
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items[0].name === 'Canvas title');
});

test('canvas layer menus hide and delete their own component and undo restores its configuration', { timeout: 30000 }, async (t) => {
  const { page, desktop } = await editor(t);
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  await page.locator('[data-category="clock"]').click();
  await page.locator('.preview-picker-style').first().click();
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items.length === 2);
  const before = await desktop.evaluate(() => window.controllers.canvas.getState().draft.document);
  const clockId = before.items[1].id;
  const row = page.locator(`.preview-canvas-layer[data-item-id="${clockId}"]`);
  const toggle = row.locator('.preview-canvas-layer-action');
  const menu = row.getByRole('menu');
  await page.locator('.preview-canvas-layer-select').last().click();
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  const bounds = await menu.boundingBox();
  const trigger = await toggle.boundingBox();
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= trigger.y, 'The menu appears above the scrolling layer strip.');
  await menu.getByRole('menuitem', { name: '隐藏', exact: true }).click();
  assert.equal(await page.locator('.scene-editor-item').count(), 1);
  await toggle.click();
  await menu.getByRole('menuitem', { name: '显示', exact: true }).click();
  assert.equal(await page.locator('.scene-editor-item').count(), 2);
  await toggle.press('ArrowDown');
  await menu.getByRole('menuitem', { name: '隐藏', exact: true }).waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await toggle.click();
  await page.getByRole('button', { name: '画布设置', exact: true }).click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await page.locator('.preview-canvas-layer-select').last().click();
  await toggle.click();
  await menu.getByRole('menuitem', { name: '删除', exact: true }).click();
  assert.equal(await page.locator('.scene-editor-item').count(), 1);
  assert.equal(await page.locator('.scene-editor-item.is-selected').getAttribute('data-component'), 'danmaku');
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items.length === 1);
  await poll(page);
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('.scene-editor-item.is-selected').getAttribute('data-item-id'), clockId);
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items.length === 2);
  assert.deepEqual(await desktop.evaluate(() => window.controllers.canvas.getState().draft.document), before);
  await page.getByRole('button', { name: '锁定', exact: true }).click();
  await toggle.click();
  assert.equal(await menu.getByRole('menuitem', { name: '删除', exact: true }).isDisabled(), true);
  assert.equal(await menu.getByRole('menuitem', { name: '隐藏', exact: true }).isDisabled(), true);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Delete');
  assert.equal(await page.locator('.scene-editor-item').count(), 2);
});

test('canvas Delete and Ctrl+Z restore deletion, resize and move as separate edits', { timeout: 30000 }, async (t) => {
  const { page, desktop } = await editor(t);
  const item = page.locator('.scene-editor-item');
  const geometry = () => item.evaluate(node => ['left', 'top', 'width', 'height'].map(key => parseFloat(node.style[key])));
  const before = await geometry();
  const start = await item.boundingBox();
  await page.mouse.move(start.x + 40, start.y + 40);
  await page.mouse.down();
  await page.mouse.move(start.x + 72, start.y + 56, { steps: 5 });
  await page.mouse.up();
  const moved = await geometry();
  assert.notDeepEqual(moved, before);
  const handle = await item.locator('[data-resize="se"]').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 32, handle.y + handle.height / 2 + 16, { steps: 5 });
  await page.mouse.up();
  const resized = await geometry();
  assert.notDeepEqual(resized, moved);
  await page.keyboard.press('Delete');
  assert.equal(await item.count(), 0);
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items.length === 0);
  await poll(page);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await geometry(), resized);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await geometry(), moved);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await geometry(), before);
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+z');
  assert.equal(await item.count(), 1, 'Picker keyboard input must not edit the canvas behind it.');
  await page.keyboard.press('Escape');
});

test('canvas edge and corner resizing stays in bounds, cancels cleanly, and saves the resulting size', { timeout: 30000 }, async (t) => {
  const { page, desktop } = await editor(t);
  const item = page.locator('.scene-editor-item');
  const geometry = () => item.evaluate(node => ['left', 'top', 'width', 'height'].map(key => parseFloat(node.style[key])));
  const drag = async (direction, dx, dy) => {
    const handle = await item.locator(`[data-resize="${direction}"]`).boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + dx, handle.y + handle.height / 2 + dy, { steps: 5 });
  };
  const before = await geometry();
  await drag('se', 48, 24);
  await page.mouse.up();
  const enlarged = await geometry();
  assert.deepEqual(enlarged.slice(0, 2), before.slice(0, 2));
  assert.ok(enlarged[2] > before[2] && enlarged[3] > before[3]);
  assert.equal(await page.getByRole('spinbutton', { name: '宽度', exact: true }).inputValue(), String(enlarged[2]));
  await drag('nw', 20, 20);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.deepEqual(await geometry(), enlarged);
  await drag('e', 20, 0);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.up();
  assert.deepEqual(await geometry(), enlarged);
  await drag('w', -1000, 0);
  await page.mouse.up();
  const bounded = await geometry();
  assert.equal(bounded[0], 0);
  assert.equal(bounded[2], enlarged[0] + enlarged[2]);
  assert.deepEqual(bounded.slice(3), enlarged.slice(3));
  await page.getByRole('button', { name: '锁定', exact: true }).click();
  assert.equal(await item.locator('.scene-editor-resize-handle:visible').count(), 0);
  await page.getByRole('button', { name: '解锁', exact: true }).click();
  assert.equal(await item.locator('.scene-editor-resize-handle:visible').count(), 8);
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await desktop.waitForFunction(() => window.controllers.canvas.getState().saved.document.items[0]?.x === 0);
  assert.equal(await desktop.evaluate(() => window.controllers.canvas.getState().saved.document.items[0].width), bounded[2]);
});

test('queue typing and geometry drafts survive updates while overtime exposes width-only resizing', { timeout: 30000 }, async (t) => {
  const { page } = await editor(t);
  const add = async category => {
    await page.getByRole('button', { name: '添加组件', exact: true }).click();
    await page.locator(`[data-category="${category}"]`).click();
    await page.locator('.preview-picker-style').first().click();
  };
  await add('queue');
  const font = page.locator('[data-preview-field="queueSongFontSizeNumber"]');
  await font.click();
  await font.press('Control+a');
  await page.keyboard.type('36', { delay: 300 });
  await poll(page);
  assert.equal(await font.inputValue(), '36');
  await font.press('Tab');
  assert.equal(await page.locator('[data-preview-field="queueSongFontSize"]').inputValue(), '36');
  await add('overtime');
  assert.equal(await page.locator('.scene-editor-item.is-selected .scene-editor-resize-handle:visible').count(), 2);
  assert.equal(await page.getByRole('spinbutton', { name: '高度（自动）' }).getAttribute('readonly'), '');
  const overtime = page.locator('.scene-editor-item[data-component="overtime"]');
  await page.waitForFunction(() => document.querySelector('.scene-editor-item[data-component="overtime"] .component-preview-load-state')?.hidden);
  const width = page.getByRole('spinbutton', { name: '宽度', exact: true });
  await width.fill('610');
  const height = await overtime.evaluate(node => {
    const height = node.offsetHeight + 24;
    window.dispatchEvent(new MessageEvent('message', { source: node.querySelector('iframe').contentWindow,
      origin: 'null', data: { type: 'component-preview:resize', size: { width: node.offsetWidth, height } } }));
    return height;
  });
  await page.waitForFunction(height => document.querySelector('.scene-editor-item[data-component="overtime"]').offsetHeight === height, height);
  assert.equal(await width.inputValue(), '610');
  await width.press('Tab');
  assert.equal(await overtime.evaluate(node => node.offsetWidth), 610);
});
