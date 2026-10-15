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

async function poll(page) {
  await page.waitForResponse(response => response.url().endsWith('/api/component-preview')
    && response.request().postDataJSON()?.action === 'read');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
}

function waitForDraft(page, matches) {
  return page.waitForResponse(async response => {
    if (!response.url().endsWith('/api/component-preview') || response.request().postDataJSON()?.action !== 'read') return false;
    return matches((await response.json()).data?.state?.draft || {});
  });
}

async function presetAction(page, name) {
  await page.getByRole('button', { name: '场景操作', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

test('canvas invalid parameters show the field and reason in a top-right toast without publishing', { timeout: 30000 }, async t => {
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
  const toast = page.locator('#toast .toast-error').filter({ hasText: '宽度' });
  await toast.waitFor();
  assert.equal(await toast.locator('.toast-message').textContent(), '宽度不能小于 32');
  assert.equal(await width.evaluate(input => document.activeElement === input), true);
  assert.equal(await toast.count(), 1);
  assert.equal(publications, 0);
  assert.equal(await desktop.evaluate(() => window.controllers.canvas.getState().draft.document.items[0].width), Number(original));
  const position = await toast.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { top: rect.top, right: innerWidth - rect.right, left: rect.left, viewportWidth: innerWidth };
  });
  assert.ok(position.top >= 0 && position.top < 120);
  assert.equal(position.right, 24);
  assert.ok(position.left > position.viewportWidth / 2);

  await page.setViewportSize({ width: 1000, height: 760 });
  await page.waitForFunction(() => {
    const stack = document.getElementById('toast').getBoundingClientRect();
    const toolbar = document.querySelector('.preview-canvas-toolbar').getBoundingClientRect();
    return stack.top >= toolbar.bottom + 16;
  });
  assert.equal(await toast.evaluate(node => innerWidth - node.getBoundingClientRect().right), 24);
  await page.setViewportSize({ width: 1440, height: 960 });

  await width.fill(original);
  await width.press('Tab');
  await toast.click();
  await toast.waitFor({ state: 'detached' });
  const fontSize = page.locator('[data-preview-field="danmakuFontSize"]');
  await fontSize.fill('999');
  await fontSize.press('Tab');
  const fontToast = page.locator('#toast .toast-error').filter({ hasText: '之间的整数' });
  await fontToast.waitFor();
  assert.match(await fontToast.locator('.toast-message').textContent(), /^正文字号：请输入 \d+～\d+ 之间的整数$/);
  assert.notEqual(await fontSize.inputValue(), '999', 'The existing parameter owner still rejects invalid values.');
});

test('canvas source address dismisses outside, on Escape and on its trigger while remaining selectable', { timeout: 30000 }, async t => {
  const { page } = await editor(t, 'clock');
  await page.evaluate(() => {
    window.copiedSources = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { async writeText(value) { window.copiedSources.push(value); } } });
  });
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  const sceneCopy = page.getByRole('button', { name: '复制场景地址', exact: true });
  const componentCopy = page.getByRole('button', { name: '复制组件地址', exact: true });
  const address = page.getByRole('textbox', { name: '直播源地址', exact: true });
  await sceneCopy.click();
  await page.locator('.preview-canvas-status').filter({ hasText: '直播源地址已复制' }).waitFor();
  const sceneUrl = await address.inputValue();
  assert.equal(await page.evaluate(() => window.copiedSources.at(-1)), sceneUrl);
  await address.click();
  await address.press('Control+a');
  assert.equal(await address.isVisible(), true, 'The address remains available for manual copying.');
  await page.getByRole('textbox', { name: '组件名称', exact: true }).click();
  assert.equal(await address.isVisible(), false, 'Clicking outside dismisses the address.');

  await sceneCopy.click();
  await address.waitFor({ state: 'visible' });
  await sceneCopy.click();
  assert.equal(await address.isVisible(), false, 'Clicking the same copy button dismisses the address.');
  assert.equal(await page.evaluate(() => window.copiedSources.length), 2, 'Closing does not request or copy another source.');
  await sceneCopy.click();
  await address.waitFor({ state: 'visible' });
  await componentCopy.click();
  await page.locator('.preview-canvas-status').filter({ hasText: '单组件地址已复制' }).waitFor();
  assert.notEqual(await address.inputValue(), sceneUrl, 'The other copy button switches to its own source.');
  assert.equal(await page.evaluate(() => window.copiedSources.at(-1)), await address.inputValue());
  await address.focus();
  await address.press('Escape');
  assert.equal(await address.isVisible(), false);
  assert.equal(await componentCopy.evaluate(node => document.activeElement === node), true);
  await componentCopy.click();
  await address.waitFor({ state: 'visible' });
  await componentCopy.click();
  assert.equal(await address.isVisible(), false);
});

test('canvas surrounding whitespace clears selection even when a component fills the canvas', { timeout: 30000 }, async t => {
  const { page, desktop } = await editor(t);
  const item = page.locator('.scene-editor-item');
  const viewport = page.locator('.scene-editor-viewport');
  const selected = page.locator('.scene-editor-item.is-selected');
  const name = page.getByRole('textbox', { name: '组件名称', exact: true });
  await page.getByRole('spinbutton', { name: 'X', exact: true }).fill('0');
  await page.getByRole('spinbutton', { name: 'Y', exact: true }).fill('0');
  await page.getByRole('spinbutton', { name: '宽度', exact: true }).fill('1920');
  await page.getByRole('spinbutton', { name: '高度', exact: true }).fill('1080');
  await name.click();
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items
    .some(item => item.x === 0 && item.y === 0 && item.width === 1920 && item.height === 1080));
  const before = await desktop.evaluate(() => window.controllers.canvas.getState().draft.document);
  assert.equal(await selected.count(), 1, 'Using inspector inputs preserves selection.');
  await viewport.click({ position: { x: 4, y: 4 }, button: 'right' });
  assert.equal(await selected.count(), 1);
  await viewport.click({ position: { x: 4, y: 4 } });
  assert.equal(await selected.count(), 0);
  assert.equal(await page.locator('.preview-canvas-layer-select[aria-pressed="true"]').count(), 0);
  assert.equal(await page.getByRole('heading', { name: '画布设置', exact: true }).count(), 1);
  await item.click({ position: { x: 40, y: 40 } });
  assert.equal(await selected.count(), 1, 'Clicking the component can select it again.');
  await name.fill('取消选择前改名');
  const bounds = await viewport.boundingBox();
  await viewport.click({ position: { x: bounds.width - 4, y: bounds.height - 4 } });
  assert.equal(await selected.count(), 0);
  assert.equal(await item.getAttribute('aria-label'), '取消选择前改名');
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items[0].name === '取消选择前改名');
  assert.deepEqual(await desktop.evaluate(() => window.controllers.canvas.getState().draft.document), {
    ...before, items: before.items.map(item => ({ ...item, name: '取消选择前改名' })),
  }, 'Deselecting commits the focused input without changing other scene data.');
});

test('canvas parameter groups retain edits, slider values and existing lyric dimensions', { timeout: 30000 }, async t => {
  const { page, fixture } = await editor(t);
  const addLyrics = async () => {
    await page.getByRole('button', { name: '添加组件', exact: true }).click();
    await page.locator('[data-category="lyrics"]').click();
    await page.locator('[data-picker-style="default"]').click();
  };
  await addLyrics();
  const panel = page.locator('.component-preview-panel');
  assert.deepEqual(await panel.locator('.scene-parameter-group > summary').allTextContents(), [
    '位置与尺寸', '基础样式', '显示策略', '描边与阴影', '可见性与同步', '动画与布局', '背景与渲染',
  ]);
  const size = page.getByRole('spinbutton', { name: '高度', exact: true });
  assert.equal(await size.inputValue(), '360');
  const parameters = await panel.locator('[data-component-parameter]').evaluateAll(inputs => inputs.map(input => input.dataset.componentParameter));
  assert.equal(new Set(parameters).size, parameters.length, 'Each setting is rendered once.');
  assert.equal(await panel.locator('.scene-extra-parameters > .scene-parameter-control').count(), 0);
  assert.equal(await page.locator('[data-parameter-group="layout"]').evaluate(node => node.open), false);

  const font = page.locator('[data-component-parameter="desktopLyricFontFamily"]');
  assert.equal(await page.locator('[data-component-parameter="desktopLyricFallbackFontFamily"]').count(), 0);
  assert.equal(await font.inputValue(), 'Lira Maiyuan');
  assert.equal(await page.locator('[data-component-parameter="desktopLyricCurrentLineEnhanced"]').isChecked(), false);
  const lyricFrame = await page.locator('.scene-editor-item.is-selected iframe').elementHandle().then(handle => handle.contentFrame());
  await lyricFrame.locator('.desktop-lyric-preview-row.is-active').waitFor();
  const appearance = await lyricFrame.locator('.desktop-lyric-preview-row.is-active').evaluate(async row => {
    await document.fonts.ready;
    return { background: getComputedStyle(row).backgroundImage, shadow: getComputedStyle(row).boxShadow,
      fontLoaded: [...document.fonts].some(font => font.family === 'Lira Maiyuan' && font.status === 'loaded') };
  });
  assert.deepEqual(appearance, { background: 'none', shadow: 'none', fontLoaded: true });
  const fontSaved = page.waitForResponse(response => response.url().includes('/api/component-preview/appearance')
    && response.request().postDataJSON()?.patch?.desktopLyricFontFamily?.startsWith('Microsoft YaHei,'));
  await font.selectOption({ label: '系统字体' });
  const multilingualFont = await font.inputValue();
  assert.equal((await fontSaved).status(), 200);
  assert.equal(fixture.runtime.settings.desktopLyricFontFamily, multilingualFont, 'A complete font stack survives saving.');
  for (const family of ['Lira Xiaolai', 'Lira Assorted']) {
    await font.selectOption(family);
    await lyricFrame.waitForFunction(value => getComputedStyle(document.querySelector('.desktop-lyric-preview-card'))
      .getPropertyValue('--preview-font').includes(value), family);
    assert.ok(await lyricFrame.evaluate(async value => (await document.fonts.load(`40px "${value}"`, '可爱 Hello こんにちは')).length > 0, family),
      `${family} loads from the bundled font asset.`);
  }
  await font.selectOption('Lira Kuaile');

  const fontSize = page.locator('[data-component-parameter="desktopLyricFontSize"]');
  const slider = page.getByRole('slider', { name: '字号滑块', exact: true });
  await slider.focus();
  await slider.press('ArrowRight');
  await fontSize.press('Tab');
  assert.equal(await fontSize.inputValue(), '57');
  await page.waitForFunction(() => document.querySelector('[data-component-parameter="desktopLyricFontSize"]').value === '57');
  await fontSize.fill('64'); await fontSize.press('Tab');
  assert.equal(await slider.inputValue(), '64');
  await page.locator('[data-component-parameter="desktopLyricShowTranslation"]').uncheck();
  await page.locator('[data-parameter-group="basic"] > summary').click();
  await poll(page);
  assert.equal(await page.locator('[data-parameter-group="basic"]').evaluate(node => node.open), false,
    'Polling must not reopen collapsed groups.');
  assert.equal(await panel.evaluate(node => node.scrollWidth <= node.clientWidth), true);

  await size.fill('480'); await size.press('Tab');
  await addLyrics();
  assert.equal(await size.inputValue(), '360');
  const dimensions = await page.locator('.scene-editor-item[data-component="lyrics"]').evaluateAll(items => items.map(item => item.style.height));
  assert.deepEqual(dimensions, ['480px', '360px']);
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  assert.equal(fixture.runtime.settings.desktopLyricFontSize, '64');
  assert.equal(fixture.runtime.settings.desktopLyricFontFamily, 'Lira Kuaile');
  assert.equal(fixture.runtime.settings.desktopLyricShowTranslation, 'false');
});

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

  await color.click();
  const nextColorUpdate = waitForDraft(page, draft => draft.themeText === '#345678');
  await desktop.evaluate(() => window.controllers.queue.edit({ themeText: '#345678' }));
  await nextColorUpdate;
  const beforeEscape = edits.length;
  const picker = page.getByRole('dialog', { name: '颜色与不透明度' });
  await picker.press('Escape');
  await page.waitForFunction(() => document.querySelector('[data-preview-field="themeText"]').value === '#345678');
  assert.equal(await color.evaluate(node => document.activeElement === node), true, 'Closing the picker retains its keyboard focus.');
  await color.press('Enter');
  assert.equal(await picker.getByLabel('十六进制颜色').inputValue(), '#345678');
  assert.equal(edits.length, beforeEscape);
  await picker.press('Escape');
  await radius.fill('9');
  await radius.press('Tab');
  await desktop.waitForFunction(() => window.controllers.queue.getState().draft.themeRadius === '9');
  assert.deepEqual(await desktop.evaluate(() => {
    const { draft } = window.controllers.queue.getState();
    return [draft.overlayTitle, draft.themeText];
  }), ['Desktop title', '#345678'], 'Editing another field cannot write stale title or color values back.');
});

test('danmaku fields refill after focus and keep change commits while their acknowledgement is delayed', { timeout: 30000 }, async t => {
  const { page, desktop } = await editor(t);
  const font = page.locator('[data-preview-field="danmakuFontSize"]');
  const original = await font.inputValue();
  await font.focus();
  const remoteUpdate = waitForDraft(page, draft => draft.styleOptions?.signal?.fontSize === 38);
  await desktop.evaluate(() => {
    const { draft } = window.controllers.danmaku.getState();
    window.controllers.danmaku.edit({ styleOptions: { ...draft.styleOptions, signal: { ...draft.styleOptions.signal, fontSize: 38 } } });
  });
  await remoteUpdate;
  assert.equal(await font.inputValue(), original);
  await font.press('Tab');
  await page.waitForFunction(() => document.querySelector('[data-preview-field="danmakuFontSize"]').value === '38');

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
  await poll(page);
  assert.equal(await font.inputValue(), '40', 'The field uses the pending local draft before the desktop acknowledges it.');
  assert.equal(edits, 1, 'Blur does not create a second command.');
  assert.equal(await desktop.evaluate(() => window.controllers.danmaku.getState().draft.styleOptions.signal.fontSize), 38);
  release();
  await desktop.waitForFunction(() => window.controllers.danmaku.getState().draft.styleOptions.signal.fontSize === 40);
});

test('shared clock effect fields refill the latest values after leaving an untouched number', { timeout: 30000 }, async t => {
  const { page, desktop } = await editor(t, 'clock');
  const shadow = page.locator('[data-effect-group="shadow"]');
  await shadow.locator('summary').click();
  await shadow.locator('[data-effect-enabled="shadow"]').check();
  await desktop.waitForFunction(() => window.controllers.clock.getState().draft.styleParameters?.peach?.shadow);
  const blur = shadow.locator('[data-effect-field="shadow.blur"]');
  const original = await blur.inputValue();
  await blur.focus();
  const remoteUpdate = waitForDraft(page, draft => draft.styleParameters?.peach?.shadow?.blur === 19);
  await desktop.evaluate(() => {
    const { draft } = window.controllers.clock.getState();
    const current = draft.styleParameters.peach;
    window.controllers.clock.edit({ styleParameters: { ...draft.styleParameters, peach: { ...current, shadow: { ...current.shadow, blur: 19 } } } });
  });
  await remoteUpdate;
  assert.equal(await blur.inputValue(), original);
  await blur.press('Tab');
  await page.waitForFunction(() => document.querySelector('[data-effect-field="shadow.blur"]').value === '19');
});

test('canvas layer controls toggle visibility and locking, preserve selection and support undo', { timeout: 30000 }, async (t) => {
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
  assert.equal(await visible.isVisible(), false);
  await toggle.click();
  assert.equal(await visible.textContent(), '隐藏组件');
  assert.equal(await lock.textContent(), '锁定组件');
  await visible.click();
  assert.equal(await page.locator('.scene-editor-item').count(), 1);
  assert.equal(await visible.textContent(), '显示组件');
  assert.equal(await toggle.evaluate(node => document.activeElement === node), true);
  assert.equal(await page.locator('.scene-editor-item.is-selected').getAttribute('data-component'), 'danmaku');
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('.scene-editor-item').count(), 2);
  assert.equal(await visible.textContent(), '隐藏组件');
  await toggle.press('ArrowDown');
  await visible.press('Space');
  assert.equal(await page.locator('.scene-editor-item').count(), 1);
  await toggle.press('ArrowDown');
  await visible.press('Enter');
  assert.equal(await page.locator('.scene-editor-item').count(), 2);
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  const bounds = await menu.boundingBox();
  const trigger = await toggle.boundingBox();
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= trigger.y, 'The menu appears above the scrolling layer strip.');
  await page.keyboard.press('Escape');
  await toggle.press('ArrowDown');
  await menu.getByRole('menuitem', { name: '删除', exact: true }).waitFor({ state: 'visible' });
  await page.keyboard.press('ArrowDown');
  assert.equal(await lock.evaluate(node => document.activeElement === node), true);
  await page.keyboard.press('Escape');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await toggle.click();
  await page.getByRole('button', { name: '画布设置', exact: true }).click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await page.locator('.preview-canvas-layer-select').last().click();
  await poll(page);
  // The preceding visibility edit must reach the desktop before capturing the undo baseline.
  await desktop.waitForFunction(id => window.controllers.canvas.getState().draft.document.items
    .find(item => item.id === id)?.visible === true, clockId);
  const beforeRemoval = await desktop.evaluate(() => window.controllers.canvas.getState().draft.document);
  await toggle.click();
  await menu.getByRole('menuitem', { name: '删除', exact: true }).click();
  assert.equal(await page.locator('.scene-editor-item').count(), 1);
  assert.equal(await page.locator('.scene-editor-item.is-selected').getAttribute('data-component'), 'danmaku');
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items.length === 1);
  await poll(page);
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('.scene-editor-item.is-selected').getAttribute('data-item-id'), clockId);
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items.length === 2);
  assert.deepEqual(await desktop.evaluate(() => window.controllers.canvas.getState().draft.document), beforeRemoval);
  await toggle.click();
  await lock.click();
  assert.equal(await lock.textContent(), '解锁组件');
  assert.equal(await toggle.evaluate(node => document.activeElement === node), true);
  assert.equal(await page.getByRole('button', { name: '解锁', exact: true }).count(), 1);
  assert.equal(await clock.locator('.scene-editor-resize-handle:visible').count(), 0);
  const geometry = () => clock.evaluate(node => ['left', 'top', 'width', 'height'].map(key => node.style[key]));
  const lockedGeometry = await geometry();
  const lockedBounds = await clock.boundingBox();
  await page.mouse.move(lockedBounds.x + 40, lockedBounds.y + 40);
  await page.mouse.down();
  await page.mouse.move(lockedBounds.x + 80, lockedBounds.y + 64, { steps: 5 });
  await page.mouse.up();
  assert.deepEqual(await geometry(), lockedGeometry);
  await toggle.click();
  await visible.click();
  assert.equal(await clock.count(), 0, 'Visibility can be changed while movement is locked.');
  assert.equal(await lock.textContent(), '解锁组件');
  await toggle.click();
  await visible.click();
  assert.equal(await clock.count(), 1);
  assert.equal(await clock.locator('.scene-editor-resize-handle:visible').count(), 0);
  await toggle.click();
  assert.equal(await menu.getByRole('menuitem', { name: '删除', exact: true }).isDisabled(), true);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Delete');
  assert.equal(await page.locator('.scene-editor-item').count(), 2);
  await toggle.press('ArrowDown');
  await lock.press('Space');
  assert.equal(await lock.textContent(), '锁定组件');
  assert.equal(await clock.locator('.scene-editor-resize-handle:visible').count(), 8);
  await page.keyboard.press('Control+z');
  assert.equal(await lock.textContent(), '解锁组件');
  await page.getByRole('button', { name: '解锁', exact: true }).click();
  assert.equal(await lock.textContent(), '锁定组件');
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
  await toggle.click();
  await visible.waitFor();
  assert.equal(await visible.textContent(), '显示组件');
  assert.equal(await lock.textContent(), '解锁组件');
  assert.equal(await page.locator('.scene-editor-item').count(), 0);
  await visible.click();
  assert.equal(await page.locator('.scene-editor-item.is-locked').count(), 1);
  assert.equal(await page.locator('.scene-editor-resize-handle:visible').count(), 0);
});

test('layer drag commits only inside the strip on release, cancels outside or on Escape, and undoes once', { timeout: 30000 }, async t => {
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
  const rowOrder = () => layers.locator('.preview-canvas-layer-select').allTextContents();
  const stageOrder = () => page.locator('.scene-editor-item').evaluateAll(nodes =>
    nodes.map(node => [node.dataset.itemId, node.style.zIndex]));
  const before = await stageOrder();
  const ghost = page.locator('.preview-canvas-layer-ghost');
  const drag = async () => {
    const from = await layers.getByRole('button', { name: '顶层', exact: true }).boundingBox();
    const to = await layers.locator('.preview-canvas-layer').filter({ hasText: '底层' }).boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width - 2, to.y + to.height / 2, { steps: 8 });
    const floating = await ghost.boundingBox();
    assert.ok(Math.abs(floating.x - (to.x + to.width - 2 - from.width / 2)) < 1,
      'The lifted layer follows the pointer while preserving the grab offset.');
    await page.mouse.move(to.x + to.width - 2, to.y + to.height / 2 + 3);
    const moved = await ghost.boundingBox();
    assert.ok(Math.abs(moved.y - floating.y - 3) < 1, 'The lifted layer also follows vertical movement.');
  };
  await drag();
  assert.deepEqual(await rowOrder(), ['中层', '底层', '顶层']);
  assert.deepEqual(await stageOrder(), before);
  await page.mouse.up();
  assert.equal(await ghost.count(), 0);
  assert.notDeepEqual(await stageOrder(), before);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await rowOrder(), ['顶层', '中层', '底层']);
  assert.deepEqual(await stageOrder(), before);
  await drag();
  await page.mouse.move(400, 200);
  await page.mouse.up();
  assert.equal(await ghost.count(), 0);
  assert.deepEqual(await rowOrder(), ['顶层', '中层', '底层']);
  assert.deepEqual(await stageOrder(), before);
  await drag();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.equal(await ghost.count(), 0);
  assert.deepEqual(await rowOrder(), ['顶层', '中层', '底层']);
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
  await selectPreset('直播场景 · 当前输出');
  await page.locator('.preview-canvas-layers').getByRole('button', { name: '弹幕姬 1', exact: true }).waitFor();
  await selectPreset('游戏场景 · 未保存');
  await page.getByRole('button', { name: '画布设置', exact: true }).click();
  assert.equal(await page.getByRole('spinbutton', { name: '画布宽度', exact: true }).inputValue(), '1600');
  await page.reload();
  await page.getByRole('button', { name: '画布设置', exact: true }).click();
  assert.equal(await page.getByRole('spinbutton', { name: '画布宽度', exact: true }).inputValue(), '1600');
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
  const deletingOutput = page.getByRole('dialog');
  await deletingOutput.getByText(/这是当前输出场景/).waitFor();
  await deletingOutput.getByRole('button', { name: '删除场景', exact: true }).click();
  await page.getByRole('button', { name: '场景', exact: true }).filter({ hasText: '未保存原场景 · 当前输出 · 未保存' }).waitFor();
  assert.equal(fixture.service.list().length, 1);
  assert.equal(live().document.title, '直播场景');
  assert.equal(live().version, 3);
  assert.equal(await page.locator('.preview-canvas-live-preset').textContent(), '当前输出：直播场景');
  await presetAction(page, '删除场景');
  await page.getByRole('dialog').getByText(/透明空画面/).waitFor();
  await page.getByRole('dialog').getByRole('button', { name: '删除场景', exact: true }).click();
  await page.getByText('暂无场景，请从顶部“场景操作”新建场景。', { exact: true }).waitFor();
  assert.equal(fixture.service.list().length, 0);
  assert.equal(live().document.items.length, 0);
  assert.equal(live().version, 4);
  assert.equal(fixture.service.getSource(first.outputId).token, source.token);
  assert.equal(await page.getByRole('button', { name: '保存并应用', exact: true }).isDisabled(), true);
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
  await item.locator('.scene-editor-item-label').evaluate(label => { window.labelBeforeMove = label.firstChild; });
  const start = await item.boundingBox();
  await page.mouse.move(start.x + 40, start.y + 40);
  await page.mouse.down();
  await page.mouse.move(start.x + 72, start.y + 56, { steps: 5 });
  await page.mouse.up();
  const moved = await geometry();
  assert.notDeepEqual(moved, before);
  assert.equal(await item.locator('.scene-editor-item-label').evaluate(label => label.firstChild === window.labelBeforeMove), true,
    'moving a layer retains its unchanged dimension label');
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
  assert.ok(bounded[0] < 0);
  assert.equal(bounded[2], 1920);
  assert.equal(bounded[0] + bounded[2], enlarged[0] + enlarged[2]);
  assert.deepEqual(bounded.slice(3), enlarged.slice(3));
  await page.getByRole('button', { name: '锁定', exact: true }).click();
  assert.equal(await item.locator('.scene-editor-resize-handle:visible').count(), 0);
  await page.getByRole('button', { name: '解锁', exact: true }).click();
  assert.equal(await item.locator('.scene-editor-resize-handle:visible').count(), 8);
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
  assert.equal(await page.locator('.scene-editor-extent').evaluate(node => getComputedStyle(node).overflow), 'hidden');
  const x = page.getByRole('spinbutton', { name: 'X', exact: true });
  const y = page.getByRole('spinbutton', { name: 'Y', exact: true });
  await x.fill('-120');
  await x.press('Tab');
  await y.fill('-80');
  await y.press('Tab');
  const published = page.waitForResponse(async response => response.url().endsWith('/api/component-preview')
    && (await response.json()).data?.display?.result?.publishedVersion === 1);
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
