'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { chromium } = require('playwright');
const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');

let browser;
test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

async function editor(t, component = 'danmaku') {
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
  const url = await openCanvasDesktop(desktop, fixture, component);
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('.component-preview-load-state')?.hidden);
  return { page, desktop, fixture };
}

async function receiveDisplayUpdate(page, desktop) {
  const received = page.waitForResponse(response => response.url().endsWith('/api/component-preview')
    && ['read', 'read-batch'].includes(response.request().postDataJSON()?.action));
  await desktop.evaluate(async () => {
    const { getRoomGuardState, setRoomGuardState } = await import('/js/shared/bilibili-room-guard.js');
    setRoomGuardState({ roomId: 'synthetic-test-room', count: (getRoomGuardState().count || 0) + 1 });
  });
  await received;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
}

function waitForDraft(page, matches) {
  return page.waitForResponse(async response => {
    if (!response.url().endsWith('/api/component-preview')
      || !['read', 'read-batch'].includes(response.request().postDataJSON()?.action)) return false;
    const { data } = await response.json();
    return (data?.updates || [data]).some(update => update?.state && matches(update.state.draft || {}));
  });
}

async function presetAction(page, name) {
  await page.getByRole('button', { name: '场景操作', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

test('canvas invalid parameters block publishing and survive unrelated scene updates', { timeout: 30000 }, async t => {
  const { page, desktop } = await editor(t);
  let publications = 0;
  page.on('request', request => {
    if (request.url().endsWith('/api/component-preview') && request.postDataJSON()?.action === 'publish') publications += 1;
  });
  const width = page.getByRole('spinbutton', { name: '宽度', exact: true });
  const original = await width.inputValue();
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items.length === 1);
  await width.fill('1');
  await width.press('Tab');
  await desktop.evaluate(() => {
    const { document } = window.controllers.canvas.getState().draft;
    document.items[0].name = '保留无效输入';
    window.controllers.canvas.edit({ document });
  });
  await page.locator('.preview-canvas-layer-select').filter({ hasText: '保留无效输入' }).waitFor();
  assert.equal(await width.inputValue(), '1', 'Unrelated scene updates preserve the invalid field until it is corrected.');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('#toast .toast-error').filter({ hasText: '宽度' }).waitFor();
  assert.equal(publications, 0);
  assert.equal(await desktop.evaluate(() => window.controllers.canvas.getState().draft.document.items[0].width), Number(original));

  await width.fill(original);
  await width.press('Tab');
  const fontSize = page.locator('[data-preview-field="danmakuFontSize"]');
  await fontSize.fill('999');
  await fontSize.press('Tab');
  await page.locator('#toast .toast-error').filter({ hasText: '之间的整数' }).waitFor();
  assert.notEqual(await fontSize.inputValue(), '999', 'The existing parameter owner still rejects invalid values.');
});

test('canvas deselection commits the focused input without changing other scene data', { timeout: 30000 }, async t => {
  const { page, desktop } = await editor(t);
  const viewport = page.locator('.scene-editor-viewport');
  const name = page.getByRole('textbox', { name: '组件名称', exact: true });
  await page.getByRole('spinbutton', { name: 'X', exact: true }).fill('0');
  await page.getByRole('spinbutton', { name: 'Y', exact: true }).fill('0');
  await page.getByRole('spinbutton', { name: '宽度', exact: true }).fill('1920');
  await page.getByRole('spinbutton', { name: '高度', exact: true }).fill('1080');
  await name.click();
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items
    .some(item => item.x === 0 && item.y === 0 && item.width === 1920 && item.height === 1080));
  const before = await desktop.evaluate(() => window.controllers.canvas.getState().draft.document);
  await name.fill('取消选择前改名');
  const bounds = await viewport.boundingBox();
  await viewport.click({ position: { x: bounds.width - 4, y: bounds.height - 4 } });
  assert.equal(await page.locator('.scene-editor-item.is-selected').count(), 0);
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items[0].name === '取消选择前改名');
  assert.deepEqual(await desktop.evaluate(() => window.controllers.canvas.getState().draft.document), {
    ...before, items: before.items.map(item => ({ ...item, name: '取消选择前改名' })),
  });
});

test('canvas lyric settings save and existing lyric dimensions survive adding another lyric', { timeout: 30000 }, async t => {
  const { page, fixture } = await editor(t);
  const addLyrics = async () => {
    await page.getByRole('button', { name: '添加组件', exact: true }).click();
    await page.locator('[data-category="lyrics"]').click();
    await page.locator('[data-picker-style="default"]').click();
  };
  await addLyrics();
  const size = page.getByRole('spinbutton', { name: '高度', exact: true });
  const font = page.locator('[data-component-parameter="desktopLyricFontFamily"]');
  const fontSaved = page.waitForResponse(response => response.url().includes('/api/component-preview/appearance')
    && response.request().postDataJSON()?.patch?.desktopLyricFontFamily === '"Lira Kuaile"');
  await font.selectOption('"Lira Kuaile"');
  assert.equal((await fontSaved).status(), 200);
  assert.equal(fixture.runtime.settings.desktopLyricFontFamily, '"Lira Kuaile"', 'Selecting a different available font saves the choice.');
  const fontSize = page.locator('[data-component-parameter="desktopLyricFontSize"]');
  await fontSize.fill('64'); await fontSize.press('Tab');
  const linePreset = page.locator('[data-lyric-line-preset]');
  await linePreset.selectOption('custom');
  const lines = page.locator('[data-component-parameter="desktopLyricVisibleLines"]');
  await lines.fill('5'); await lines.press('Tab');
  const singleLineSaved = page.waitForResponse(response => response.url().includes('/api/component-preview/appearance')
    && response.request().postDataJSON()?.patch?.desktopLyricVisibleLines === '1');
  await linePreset.selectOption('1');
  assert.equal((await singleLineSaved).status(), 200);
  const restoredLines = page.waitForResponse(response => response.url().includes('/api/component-preview/appearance')
    && response.request().postDataJSON()?.patch?.desktopLyricVisibleLines === '5');
  await linePreset.selectOption('custom');
  assert.equal((await restoredLines).status(), 200);
  const translationScale = page.locator('[data-component-parameter="desktopLyricTranslationScale"]');
  await translationScale.fill('0.75'); await translationScale.press('Tab');
  await page.locator('[data-component-parameter="desktopLyricShowTranslation"]').uncheck();

  await size.fill('480'); await size.press('Tab');
  await addLyrics();
  const dimensions = await page.locator('.scene-editor-item[data-component="lyrics"]').evaluateAll(items => items.map(item => item.style.height));
  assert.equal(dimensions[0], '480px');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  assert.equal(fixture.runtime.settings.desktopLyricFontSize, '64');
  assert.equal(fixture.runtime.settings.desktopLyricFontFamily, '"Lira Kuaile"');
  assert.equal(fixture.runtime.settings.desktopLyricShowTranslation, 'false');
  assert.equal(fixture.runtime.settings.desktopLyricTranslationScale, '0.75', 'Hiding translation controls keeps their saved values.');
  assert.equal(fixture.runtime.settings.desktopLyricVisibleLines, '5', 'Switching back from a preset restores the custom line count.');
  assert.equal(await linePreset.inputValue(), 'custom', 'A newly selected lyric reads the saved custom mode.');
});

test('canvas inputs keep typing and native selection across preview updates', { timeout: 30000 }, async (t) => {
  const { page, desktop } = await editor(t);
  const font = page.locator('[data-preview-field="danmakuFontSize"]');
  await font.click();
  await font.press('Control+a');
  await page.keyboard.type('36', { delay: 300 });
  await receiveDisplayUpdate(page, desktop);
  assert.equal(await font.inputValue(), '36');
  await font.press('Tab');
  await desktop.waitForFunction(() => window.controllers.danmaku.getState().draft.styleOptions.signal?.fontSize === 36);

  const name = page.getByRole('textbox', { name: '组件名称', exact: true });
  await name.click();
  await name.press('Control+a');
  await page.keyboard.type('Canvas title');
  await name.press('Home');
  await name.press('Shift+ArrowRight');
  await receiveDisplayUpdate(page, desktop);
  assert.deepEqual(await name.evaluate(node => [node.selectionStart, node.selectionEnd]), [0, 1]);
  assert.equal(await name.inputValue(), 'Canvas title');
  await name.press('Tab');
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items[0].name === 'Canvas title');
});

test('shared queue fields refill remote updates after focus or color editing without writing stale values back', { timeout: 30000 }, async t => {
  const { page, desktop } = await editor(t, 'queue');
  const title = page.locator('[data-preview-field="overlayTitle"]');
  const originalTitle = await title.inputValue();
  const edits = [];
  page.on('request', request => {
    if (request.url().endsWith('/api/component-preview') && request.postDataJSON()?.action === 'edit'
      && Object.hasOwn(request.postDataJSON().change || {}, 'overlayTitle')) edits.push(request.postDataJSON());
  });
  await title.focus();
  const titleUpdate = waitForDraft(page, draft => draft.overlayTitle === 'Desktop title');
  await desktop.evaluate(() => window.controllers.queue.edit({ overlayTitle: 'Desktop title' }));
  await titleUpdate;
  assert.equal(await title.inputValue(), originalTitle, 'Focus preserves the active native editing surface.');
  await title.press('Tab');
  await page.waitForFunction(() => document.querySelector('[data-preview-field="overlayTitle"]').value === 'Desktop title');
  assert.equal(edits.length, 0, 'Leaving an untouched field does not submit a mutation.');
  const radius = page.locator('[data-preview-field="themeRadius"]');

  const color = page.locator('[data-preview-field="themeText"]');
  const originalColor = await color.inputValue();
  await color.click();
  const colorUpdate = waitForDraft(page, draft => draft.themeText === '#123456');
  await desktop.evaluate(() => window.controllers.queue.edit({ themeText: '#123456' }));
  await colorUpdate;
  assert.equal(await color.inputValue(), originalColor);
  const beforeClose = edits.length;
  await radius.click();
  await page.waitForFunction(() => document.querySelector('[data-preview-field="themeText"]').value === '#123456');
  assert.equal(edits.length, beforeClose, 'Closing an untouched picker only refills the field.');
  await radius.fill('9');
  await radius.press('Tab');
  await desktop.waitForFunction(() => window.controllers.queue.getState().draft.themeRadius === '9');
  assert.deepEqual(await desktop.evaluate(() => {
    const { draft } = window.controllers.queue.getState();
    return [draft.overlayTitle, draft.themeText];
  }), ['Desktop title', '#123456'], 'Editing another field cannot write stale title or color values back.');
});

test('danmaku field commits keep the pending local value while their acknowledgement is delayed', { timeout: 30000 }, async t => {
  const { page, desktop } = await editor(t);
  const font = page.locator('[data-preview-field="danmakuFontSize"]');
  let release;
  let edits = 0;
  const held = new Promise(resolve => { release = resolve; });
  await page.route('**/api/component-preview', async route => {
    const command = route.request().postDataJSON();
    if (command?.action === 'edit' && command.change?.styleOptions) { edits++; await held; }
    await route.continue();
  });
  t.after(() => release());
  await font.fill('40');
  await font.press('Tab');
  await receiveDisplayUpdate(page, desktop);
  assert.equal(await font.inputValue(), '40', 'The field uses the pending local draft before the desktop acknowledges it.');
  assert.equal(edits, 1, 'Blur does not create a second command.');
  assert.notEqual(await desktop.evaluate(() => window.controllers.danmaku.getState().draft.styleOptions.signal?.fontSize), 40);
  release();
  await desktop.waitForFunction(() => window.controllers.danmaku.getState().draft.styleOptions.signal?.fontSize === 40);
});

test('canvas layer hiding, deletion and locking are undoable and locked layers resist moves and deletion', { timeout: 30000 }, async (t) => {
  const { page, desktop } = await editor(t);
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  await page.locator('[data-category="clock"]').click();
  await page.locator('.preview-picker-style').first().click();
  await page.waitForFunction(() => [...document.querySelectorAll('.scene-editor-item .component-preview-load-state')]
    .every(node => node.hidden));
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items.length === 2);
  const before = await desktop.evaluate(() => window.controllers.canvas.getState().draft.document);
  const clockId = before.items[1].id;
  const row = page.locator(`.preview-canvas-layer[data-item-id="${clockId}"]`);
  const visible = row.locator('.preview-canvas-layer-visible');
  const lock = row.locator('.preview-canvas-layer-locked');
  const clock = page.locator(`.scene-editor-item[data-item-id="${clockId}"]`);
  const toggle = row.locator('.preview-canvas-layer-action');
  const menu = row.getByRole('menu');
  await page.locator('.preview-canvas-layer-select').last().click();
  await toggle.click();
  await visible.click();
  assert.equal(await page.locator('.scene-editor-item').count(), 1);
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('.scene-editor-item').count(), 2);
  await page.locator('.preview-canvas-layer-select').last().click();
  await receiveDisplayUpdate(page, desktop);
  // The preceding visibility edit must reach the desktop before capturing the undo baseline.
  await desktop.waitForFunction(id => window.controllers.canvas.getState().draft.document.items
    .find(item => item.id === id)?.visible === true, clockId);
  const beforeRemoval = await desktop.evaluate(() => window.controllers.canvas.getState().draft.document);
  await toggle.click();
  await menu.getByRole('menuitem', { name: '删除', exact: true }).click();
  assert.equal(await page.locator('.scene-editor-item').count(), 1);
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items.length === 1);
  await receiveDisplayUpdate(page, desktop);
  await page.keyboard.press('Control+z');
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items.length === 2);
  assert.deepEqual(await desktop.evaluate(() => window.controllers.canvas.getState().draft.document), beforeRemoval);
  await toggle.click();
  await lock.click();
  const geometry = () => clock.evaluate(node => ['left', 'top', 'width', 'height'].map(key => node.style[key]));
  const lockedGeometry = await geometry();
  const lockedBounds = await clock.boundingBox();
  await page.mouse.move(lockedBounds.x + 40, lockedBounds.y + 40);
  await page.mouse.down();
  await page.mouse.move(lockedBounds.x + 80, lockedBounds.y + 64, { steps: 5 });
  await page.mouse.up();
  assert.deepEqual(await geometry(), lockedGeometry);
  await toggle.click();
  assert.equal(await menu.getByRole('menuitem', { name: '删除', exact: true }).isDisabled(), true);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Delete');
  assert.equal(await page.locator('.scene-editor-item').count(), 2);
});

test('layer visibility and locking survive publication and reloading a component entry', { timeout: 30000 }, async t => {
  const { page, fixture } = await editor(t);
  const visible = page.locator('.preview-canvas-layer-visible');
  const lock = page.locator('.preview-canvas-layer-locked');
  const toggle = page.locator('.preview-canvas-layer-action');
  await toggle.click();
  await visible.click();
  await toggle.click();
  await lock.click();
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.getByText('已保存并应用到直播源', { exact: true }).waitFor();
  const source = fixture.service.getSource(fixture.service.getCanvas().outputId);
  const published = fixture.service.getOutput({ ...source, version: 0 }).document.items[0];
  assert.equal(published.visible, false);
  assert.equal(published.locked, true);
  await page.reload();
  await page.locator('.preview-canvas-layer').waitFor();
  assert.equal(await page.locator('.scene-editor-item').count(), 0);
});

test('layer drag commits only on release inside the strip, cancels outside or on Escape, and undoes once', { timeout: 30000 }, async t => {
  const { page, desktop } = await editor(t);
  await presetAction(page, '保存场景');
  await page.getByText('场景已保存，直播画面保持当前场景', { exact: true }).waitFor();
  await desktop.evaluate(() => {
    const document = window.controllers.canvas.getState().draft.document;
    document.items = ['底层', '中层', '顶层'].map(name => ({ ...document.items[0], id: crypto.randomUUID(), name }));
    window.controllers.canvas.edit({ document });
  });
  const layers = page.locator('.preview-canvas-layers');
  await layers.getByRole('button', { name: '顶层', exact: true }).waitFor();
  const stageOrder = () => page.locator('.scene-editor-item').evaluateAll(nodes =>
    nodes.map(node => [node.dataset.itemId, node.style.zIndex]));
  const before = await stageOrder();
  const drag = async () => {
    const from = await layers.getByRole('button', { name: '顶层', exact: true }).boundingBox();
    const to = await layers.locator('.preview-canvas-layer').filter({ hasText: '底层' }).boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width - 2, to.y + to.height / 2, { steps: 8 });
  };
  await drag();
  assert.deepEqual(await stageOrder(), before);
  await page.mouse.up();
  assert.notDeepEqual(await stageOrder(), before);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await stageOrder(), before);
  await drag();
  await page.mouse.move(400, 200);
  await page.mouse.up();
  assert.deepEqual(await stageOrder(), before);
  await drag();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.deepEqual(await stageOrder(), before);
});

test('scene presets retain drafts and delete through current output to a persistent empty canvas', { timeout: 30000 }, async t => {
  const { page, desktop, fixture } = await editor(t);
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.getByText('已保存并应用到直播源', { exact: true }).waitFor();
  const first = fixture.service.getCanvas();
  const source = fixture.service.getSource(first.outputId);
  const live = () => fixture.service.getOutput({ ...source, version: 0 });
  const selectPreset = async name => {
    await page.getByRole('button', { name: '场景', exact: true }).click();
    await page.getByRole('option', { name, exact: true }).click();
  };
  await presetAction(page, '新建场景');
  await desktop.waitForFunction(id => window.controllers.canvas.getState().draft.document.id !== id, first.outputId);
  await page.waitForFunction(() => document.querySelectorAll('.preview-canvas-layer').length === 0);
  assert.equal(live().document.items.length, 1);
  await page.getByRole('button', { name: '画布设置', exact: true }).click();
  await page.getByRole('textbox', { name: '场景名称', exact: true }).fill('游戏场景');
  await page.getByRole('textbox', { name: '场景名称', exact: true }).press('Tab');
  await presetAction(page, '保存场景');
  await page.getByText('场景已保存，直播画面保持当前场景', { exact: true }).waitFor();
  assert.equal(live().version, 1);
  await page.getByRole('spinbutton', { name: '画布宽度', exact: true }).fill('1600');
  await page.getByRole('spinbutton', { name: '画布宽度', exact: true }).press('Tab');
  fixture.failPublication(true);
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '模拟发布失败' }).waitFor();
  assert.equal(live().version, 1);
  fixture.failPublication(false);
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.getByText('已保存并应用到直播源', { exact: true }).waitFor();
  assert.equal(live().document.title, '游戏场景');
  assert.equal(live().document.canvas.width, 1600);
  assert.equal(live().document.items.length, 0);
  assert.equal(fixture.service.getSource(first.outputId).token, source.token);
  await selectPreset('直播场景');
  await page.locator('.preview-canvas-layers').getByRole('button', { name: '弹幕姬 1', exact: true }).waitFor();
  assert.equal(live().document.title, '游戏场景');
  await presetAction(page, '复制场景');
  await page.getByRole('button', { name: '场景', exact: true }).filter({ hasText: '直播场景 副本' }).waitFor();
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.title === '直播场景 副本');
  assert.equal(await desktop.evaluate(() => window.controllers.canvas.getState().draft.document.items[0].appearance.mode), 'independent');
  assert.equal(live().document.title, '游戏场景');
  await presetAction(page, '删除场景');
  const confirmation = page.getByRole('dialog', { name: '删除场景“直播场景 副本”？', exact: true });
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  await confirmation.waitFor({ state: 'hidden' });
  assert.equal(fixture.service.list().length, 3);
  await presetAction(page, '删除场景');
  await confirmation.getByRole('button', { name: '删除场景', exact: true }).click();
  await page.getByRole('button', { name: '场景', exact: true }).filter({ hasText: '游戏场景' }).waitFor();
  assert.equal(fixture.service.list().length, 2);
  assert.equal(live().version, 2);
  assert.equal(fixture.service.getSource(first.outputId).token, source.token);
  await selectPreset('直播场景');
  await page.getByRole('button', { name: '画布设置', exact: true }).click();
  await page.getByRole('textbox', { name: '场景名称', exact: true }).fill('未保存原场景');
  await page.getByRole('textbox', { name: '场景名称', exact: true }).press('Tab');
  await selectPreset('游戏场景 · 当前输出');
  await presetAction(page, '删除场景');
  await page.getByRole('dialog').getByRole('button', { name: '删除场景', exact: true }).click();
  await page.getByRole('button', { name: '场景', exact: true }).filter({ hasText: '未保存原场景 · 当前输出 · 未保存' }).waitFor();
  assert.equal(fixture.service.list().length, 1);
  assert.equal(live().document.title, '直播场景');
  assert.equal(live().version, 3);
  await presetAction(page, '删除场景');
  await page.getByRole('dialog').getByRole('button', { name: '删除场景', exact: true }).click();
  await page.getByText('暂无场景，请从顶部“场景操作”新建场景。', { exact: true }).waitFor();
  assert.equal(fixture.service.list().length, 0);
  assert.equal(live().document.items.length, 0);
  assert.equal(live().version, 4);
  assert.equal(fixture.service.getSource(first.outputId).token, source.token);
  await page.reload();
  await page.getByText('暂无场景，请从顶部“场景操作”新建场景。', { exact: true }).waitFor();
  const reopened = await openCanvasDesktop(desktop, fixture);
  await page.goto('about:blank');
  await page.goto(reopened);
  await page.getByText('暂无场景，请从顶部“场景操作”新建场景。', { exact: true }).waitFor();
  assert.equal(fixture.service.list().length, 0);
  await presetAction(page, '新建场景');
  await page.getByRole('button', { name: '场景', exact: true }).filter({ hasText: '场景 1' }).waitFor();
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.getByText('已保存并应用到直播源', { exact: true }).waitFor();
  assert.equal(live().document.title, '场景 1');
  assert.equal(fixture.service.getSource(first.outputId).token, source.token);
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
  await receiveDisplayUpdate(page, desktop);
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

test('canvas edge and corner resizing permits overflow, cancels cleanly, and saves the resulting size', { timeout: 30000 }, async (t) => {
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
  assert.ok(bounded[0] < 0);
  assert.equal(bounded[2], 1920);
  assert.equal(bounded[0] + bounded[2], enlarged[0] + enlarged[2]);
  assert.deepEqual(bounded.slice(3), enlarged.slice(3));
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await desktop.waitForFunction(x => window.controllers.canvas.getState().saved.document.items[0]?.x === x, bounded[0]);
  assert.equal(await desktop.evaluate(() => window.controllers.canvas.getState().saved.document.items[0].width), bounded[2]);
});

test('canvas dragging retains a visible corner and negative coordinate edits survive publication and reload', { timeout: 30000 }, async t => {
  const { page, desktop, fixture } = await editor(t);
  const item = page.locator('.scene-editor-item');
  const start = await item.boundingBox();
  await page.mouse.move(start.x + 40, start.y + 40);
  await page.mouse.down();
  await page.mouse.move(-1000, -1000, { steps: 5 });
  await page.mouse.up();
  const corner = await item.evaluate(node => ({ x: parseFloat(node.style.left), y: parseFloat(node.style.top),
    width: parseFloat(node.style.width), height: parseFloat(node.style.height) }));
  assert.equal(corner.x + corner.width, 24);
  assert.equal(corner.y + corner.height, 24);
  const x = page.getByRole('spinbutton', { name: 'X', exact: true });
  const y = page.getByRole('spinbutton', { name: 'Y', exact: true });
  await x.fill('-120');
  await x.press('Tab');
  await y.fill('-80');
  await y.press('Tab');
  const published = page.waitForResponse(async response => {
    if (!response.url().endsWith('/api/component-preview')) return false;
    const { data } = await response.json();
    return (data?.updates || [data]).some(update => update?.display?.result?.publishedVersion === 1);
  });
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await published;
  const saved = fixture.service.list()[0];
  assert.deepEqual([saved.document.items[0].x, saved.document.items[0].y], [-120, -80]);
  assert.deepEqual(await desktop.evaluate(() => {
    const item = window.controllers.canvas.getState().saved.document.items[0];
    return [item.x, item.y];
  }), [-120, -80]);
  await page.reload();
  await item.waitFor();
  assert.deepEqual(await item.evaluate(node => [parseFloat(node.style.left), parseFloat(node.style.top)]), [-120, -80]);
});

test('overtime width drafts survive automatic height updates', { timeout: 30000 }, async (t) => {
  const { page } = await editor(t);
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  await page.locator('[data-category="overtime"]').click();
  await page.locator('.preview-picker-style').first().click();
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
