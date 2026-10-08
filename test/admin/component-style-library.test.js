'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');
const { useSharedBrowser } = require('../helpers/shared-browser');

const openBrowserSession = useSharedBrowser();

async function setup(t) {
  const root = path.resolve(__dirname, '../../tmp');
  fs.mkdirSync(root, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(root, 'component-style-browser-'));
  const fixture = await startCanvasOutputFixture({ dataDir });
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const media = { name: 'frame.webp', mimeType: 'image/webp',
    buffer: fs.readFileSync(path.resolve(__dirname, '../../public/img/component-previews/clock-moonlit-fan.webp')) };
  async function request(action, body) {
    const file = Buffer.isBuffer(body);
    const response = await fetch(`${fixture.origin}/api/component-styles/${action}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${fixture.token}`,
        'Content-Type': file ? 'application/octet-stream' : 'application/json' },
      body: body === undefined ? undefined : file ? body : JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.status, 200, result.error);
    return result.data;
  }
  return { fixture, context, page, errors, media, request, dataDir };
}

// The library no longer renders its own hidden file input: an add-style entry opens the
// source dialog, whose dialog hands the chosen file to onMedia or onArchive. That entry
// is not inside the list container in every mount — the component picker moves it into
// its category bar — so callers pass the host that owns the list being used.
async function pickImportFile(page, host, file) {
  await host.locator('.component-style-add, .preview-picker-import').first().click();
  const source = page.getByRole('dialog', { name: '添加第三方样式', exact: true });
  await source.waitFor();
  await source.locator('input[type="file"]').first().setInputFiles(file);
  return source;
}

// The suite header imports a ZIP through its own button, which drives the same
// archive handler that the source dialog reaches for a selected .zip file.
async function importArchive(page, host, file) {
  const chooser = page.waitForEvent('filechooser');
  await host.getByRole('button', { name: '导入套装', exact: true }).click();
  await (await chooser).setFiles(file);
}

test('style ZIP classification and import apply to every registered component', async t => {
  const { fixture, page, errors } = await setup(t);
  await openCanvasDesktop(page, fixture);
  await page.evaluate(async () => {
    const { mountComponentStyleLibrary } = await import('/js/admin/component-style-library.js');
    const { COMPONENT_PREVIEW_DEFINITIONS } = await import('/js/admin/component-preview-definitions.js');
    const style = (type, name) => ({ id: name, type, name, config: { mediaStyle: {
      kind: 'image', src: '/img/component-previews/clock-moonlit-fan.webp', width: 640, height: 400,
    } } });
    window.examplePacks = [
      { id: 'single', packageId: 'old.single', name: '独立感谢', version: '1.0.0', bytes: 100,
        styles: [style('guard-thanks', '独立感谢')] },
      { id: 'variants', packageId: 'old.variants', name: '感谢变体', version: '1.0.0', bytes: 100,
        styles: [style('guard-thanks', '蓝色感谢'), style('guard-thanks', '紫色感谢')] },
      { id: 'suite', packageId: 'real.suite', name: '时钟背景套装', version: '1.0.0', bytes: 100, isSuite: true,
        styles: [style('clock', '套装时钟'), style('background', '套装背景')] },
      ...Object.keys(COMPONENT_PREVIEW_DEFINITIONS).filter(type => type !== 'guard-thanks').map(type => ({
        id: type, packageId: `test.${type}`, name: `${type} 样式`, version: '1.0.0', bytes: 100,
        styles: [style(type, `${type} 普通`), type === 'clock'
          ? { ...style('browser', 'clock 网页'), category: 'clock' } : style(type, `${type} 动效`)],
      })),
    ];
    window.cancelledStyleImports = [];
    window.inspectStylePack = window.examplePacks[1];
    const request = async (action, args) => {
      if (action === 'list') return window.examplePacks;
      if (action === 'inspect') return window.inspectStylePack;
      if (action === 'cancel') { window.cancelledStyleImports.push(args.id); return {}; }
      throw Error(`Unexpected action: ${action}`);
    };
    window.showStyleLibrary = options => {
      window.styleLibraryTest?.dispose();
      window.styleLibraryTest = mountComponentStyleLibrary(document.body, { ...options, request });
    };
    window.showStyleLibrary({ suitesOnly: true });
  });
  const library = page.locator('.component-style-library');
  await library.getByRole('button', { name: '添加到画布：套装背景', exact: true }).waitFor();
  assert.equal(await library.locator('.component-style-card').count(), 2);
  const archive = { name: 'style.zip', mimeType: 'application/zip', buffer: Buffer.from('synthetic upload') };
  await importArchive(page, library, archive);
  await library.getByRole('status').filter({ hasText: '这是大航海感谢的样式包' }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.cancelledStyleImports), ['variants']);
  await page.evaluate(() => { window.showStyleLibrary({ type: 'guard-thanks' }); window.inspectStylePack = window.examplePacks[2]; });
  await library.getByRole('button', { name: '添加到画布：紫色感谢', exact: true }).waitFor();
  assert.equal(await library.locator('.component-style-card').count(), 3);
  assert.equal(await library.getByRole('button', { name: '导入套装', exact: true }).count(), 0);
  await pickImportFile(page, library, archive);
  await library.getByRole('status').filter({ hasText: '这是多个组件组合的套装' }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.cancelledStyleImports), ['variants', 'suite']);
  await page.evaluate(() => { window.inspectStylePack = window.examplePacks[1]; });
  const confirmation = page.getByRole('dialog', { name: '确认添加样式', exact: true });
  await pickImportFile(page, library, archive);
  await confirmation.getByRole('button', { name: '添加样式', exact: true }).waitFor();
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  const types = await page.evaluate(() => window.examplePacks.slice(3).map(pack => pack.id));
  for (const type of types) {
    await page.evaluate(type => {
      window.showStyleLibrary({ type });
      window.inspectStylePack = window.examplePacks.find(pack => pack.id === type);
    }, type);
    await library.locator('.component-style-add').waitFor();
    const expectedCards = type === 'browser' ? 3 : ['clock', 'background'].includes(type) ? 3 : 2;
    assert.equal(await library.locator('.component-style-card').count(), expectedCards, type);
    assert.equal(await library.getByRole('button', { name: '导入套装', exact: true }).count(), 0, type);
    await pickImportFile(page, library, archive);
    await confirmation.getByRole('button', { name: '添加样式', exact: true }).waitFor();
    await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  }
  assert.deepEqual(errors, []);
});

test('suite management groups versions, confirms whole deletion and replaces through the canvas capability', async t => {
  const { fixture, context, page, errors, request, dataDir } = await setup(t);
  const { randomUUID } = require('node:crypto');
  const { createComponentStyleStore } = require('../../src/storage/component-style-store');
  const store = createComponentStyleStore(dataDir);
  const pack = { id: randomUUID(), packageId: 'test.ui-suite', name: '测试套装', version: '1.0.0', bytes: 100, digest: 'v1',
    styles: ['clock', 'background'].map(type => ({ id: randomUUID(), type, name: `测试套装 · ${type === 'clock' ? '时钟' : '背景'}`,
      config: { mediaStyle: { kind: 'image', src: '/img/component-previews/clock-moonlit-fan.webp', width: 640, height: 400 } } })) };
  store.stage(pack); store.install(pack.id);
  const desktop = await context.newPage();
  const url = await openCanvasDesktop(desktop, fixture);
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '添加组件', exact: true });
  await picker.getByRole('button', { name: '套装', exact: true }).click();
  const library = picker.locator('.component-style-library');
  const group = library.getByRole('region', { name: '测试套装 1.0.0', exact: true });
  await group.waitFor();
  assert.match(await group.textContent(), /版本 1\.0\.0 · 2 个组件样式/);
  assert.equal(await group.locator('.component-style-delete').count(), 0);
  await group.getByRole('button', { name: '删除套装', exact: true }).click();
  const deletion = page.getByRole('dialog', { name: '删除套装', exact: true });
  await deletion.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal((await request('list')).length, 1);
  let inspected;
  await page.route('**/api/component-preview/styles/inspect?*', route => route.fulfill({
    json: { ok: true, data: store.describe(inspected) },
  }));
  const archive = { name: 'update.zip', mimeType: 'application/zip', buffer: Buffer.from('inspection fixture') };
  const uploadUpdate = async () => {
    const chooser = page.waitForEvent('filechooser');
    await library.getByRole('button', { name: '更新套装', exact: true }).click();
    await (await chooser).setFiles(archive);
  };
  inspected = { ...pack, id: randomUUID(), packageId: 'test.wrong-suite', version: '2.0.0' };
  store.stage(inspected);
  await uploadUpdate();
  await library.getByRole('status').filter({ hasText: '请选择「测试套装」的更新包' }).waitFor();
  assert.ok(!fs.existsSync(store.directory(inspected.id, true)));
  assert.equal((await request('list'))[0].version, '1.0.0');
  inspected = { ...pack, id: randomUUID(), version: '2.0.0', digest: 'v2', styles: [pack.styles[0]] };
  store.stage(inspected);
  await uploadUpdate();
  const confirmation = page.getByRole('dialog', { name: '确认导入套装', exact: true });
  await confirmation.getByText('将替换已安装版本 1.0.0 → 2.0.0，样式库只保留本次导入的版本。', { exact: true }).waitFor();
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  await confirmation.waitFor({ state: 'hidden' });
  assert.equal((await request('list'))[0].version, '1.0.0');
  inspected = { ...inspected, id: randomUUID() }; store.stage(inspected);
  await uploadUpdate();
  await confirmation.getByRole('button', { name: '替换套装', exact: true }).click();
  const updated = library.getByRole('region', { name: '测试套装 2.0.0', exact: true });
  await updated.waitFor();
  assert.equal(await library.locator('.component-style-suite').count(), 1);
  assert.equal(await library.locator('.component-style-card').count(), 1);
  assert.deepEqual((await request('list')).map(item => item.id), [inspected.id]);
  inspected = { ...inspected, id: randomUUID() }; store.stage(inspected);
  await library.locator('input[accept=".zip"]').setInputFiles(archive);
  await confirmation.getByRole('button', { name: '导入套装', exact: true }).click();
  await library.getByRole('status').filter({ hasText: '这个版本已经导入。' }).waitFor();
  assert.equal(await library.locator('.component-style-suite').count(), 1);
  await updated.getByRole('button', { name: '删除套装', exact: true }).click();
  await deletion.getByRole('button', { name: '删除整套', exact: true }).click();
  await library.getByRole('heading', { name: '还没有套装', exact: true }).waitFor();
  assert.deepEqual(await request('list'), []);
  assert.deepEqual(errors, []);
});

test('every component combines built-in, standalone and suite styles in its own category', { timeout: 30000 }, async t => {
  const { fixture, context, page, errors } = await setup(t);
  const desktop = await context.newPage();
  const url = await openCanvasDesktop(desktop, fixture);
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  const types = await page.evaluate(async () => {
    const { COMPONENT_PREVIEW_DEFINITIONS } = await import('/js/admin/component-preview-definitions.js');
    const { SCENE_EXTRA_COMPONENTS } = await import('/js/shared/scene-extra-components.js');
    return Object.entries(COMPONENT_PREVIEW_DEFINITIONS).filter(([id]) => id !== 'browser')
      .map(([id, definition]) => ({ id, category: definition.category || id,
        subcategory: definition.category ? SCENE_EXTRA_COMPONENTS[id].title : null,
        hasBuiltins: !['background', 'gift-frame'].includes(id) }));
  });
  const style = type => ({ id: `suite-${type}`, type, name: `${type} 套装样式`, config: { mediaStyle: {
    kind: 'image', src: '/img/component-previews/clock-moonlit-fan.webp', width: 640, height: 400,
  } } });
  const packs = [
    { id: 'suite', isSuite: true, name: '分类测试套装', version: '1.0.0', styles: types.map(({ id }) => style(id)) },
    { id: 'standalone', styles: [{ ...style('clock'), id: 'standalone-clock', name: '单独导入的时钟' },
      { id: 'web-clock', type: 'browser', category: 'clock', name: '网页时钟',
        config: { url: 'https://example.test/clock', viewportWidth: 640, viewportHeight: 400 } }] },
  ];
  let listRequests = 0;
  await page.route('**/api/component-preview/styles/list?*', route => {
    listRequests += 1;
    return route.fulfill({ json: { ok: true, data: packs } });
  });
  await page.route('https://example.test/clock', route => route.fulfill({ contentType: 'text/html', body: '<p>网页时钟</p>' }));
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '添加组件', exact: true });
  for (const { id, category, subcategory, hasBuiltins } of types) {
    await picker.locator(`[data-category="${category}"]`).click();
    if (subcategory) await picker.locator('.preview-picker-subcategories').getByRole('button', { name: subcategory, exact: true }).click();
    const custom = picker.locator(`[data-custom-style-id="suite-${id}"]`);
    await custom.waitFor();
    assert.equal(await picker.getByRole('heading', { name: '本机样式' }).count(), 0);
    assert.equal(await picker.getByRole('button', { name: '添加样式', exact: true }).count(), 1);
    assert.equal(await picker.locator('.preview-picker-styles').count(), 1);
    const contents = await custom.evaluate(card => ({
      builtinCount: card.parentElement.querySelectorAll('[data-picker-style]').length,
      customIds: [...card.parentElement.querySelectorAll('[data-custom-style-id]')].map(node => node.dataset.customStyleId),
    }));
    // background and gift-frame ship no built-in cards: both are distributed as
    // external packages, so a category without variants shows only imported styles.
    if (hasBuiltins) assert.ok(contents.builtinCount > 0, `${id} combines built-ins with imported styles`);
    else assert.equal(contents.builtinCount, 0, `${id} ships no built-in cards, so ${category} must import its own`);
    assert.deepEqual(contents.customIds, id === 'clock' ? ['suite-clock', 'standalone-clock', 'web-clock'] : [`suite-${id}`]);
  }
  await picker.locator('[data-category="clock"]').click();
  await picker.getByRole('button', { name: '添加到画布：网页时钟', exact: true }).waitFor();
  const requestsBeforeRefresh = listRequests;
  const refreshed = page.waitForResponse(response => response.url().includes('/styles/list?'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await refreshed;
  assert.equal(listRequests, requestsBeforeRefresh + 1, 'only the active category retains its refresh listener');
  assert.equal(await picker.locator('[data-custom-style-id="web-clock"]').count(), 1);
  await picker.getByRole('button', { name: '添加到画布：网页时钟', exact: true }).click();
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items.length === 1);
  const added = await desktop.evaluate(() => window.controllers.canvas.getState().draft.document.items[0]);
  assert.equal(added.type, 'browser', 'an imported HTML clock retains its browser renderer');
  assert.equal(added.name, '网页时钟');
  assert.deepEqual(errors, []);
});

test('danmaku picker groups all sources by motion and preserves the selected style through edits and reload', { timeout: 45000 }, async t => {
  const { fixture, context, page, errors, media, request } = await setup(t);
  const desktop = await context.newPage();
  const url = await openCanvasDesktop(desktop, fixture);
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '添加组件', exact: true });
  await picker.locator('[data-category="danmaku"]').click();
  await pickImportFile(page, picker, media);
  const editor = page.getByRole('dialog', { name: '添加弹幕装饰', exact: true });
  await editor.getByLabel('样式名称').fill('测试弹幕样式');
  await editor.getByRole('button', { name: '添加样式', exact: true }).click();
  await editor.waitFor({ state: 'hidden' });
  const imported = (await request('list'))[0].styles[0];
  const custom = picker.locator(`[data-custom-style-id="${imported.id}"]`);
  await custom.waitFor();
  assert.equal(await picker.getByRole('heading', { name: '本机样式' }).count(), 0);
  assert.equal(await custom.evaluate(card => card.parentElement.querySelector('[data-picker-style="bubble"]')?.hidden), false);
  const builtinBox = await picker.locator('[data-picker-style="bubble"]').boundingBox();
  const customBox = await custom.boundingBox();
  assert.ok(Math.abs(builtinBox.width - customBox.width) < 1, 'built-in and imported cards share the grid');
  for (const [label, style] of [['随机弹幕', 'starveil'], ['飘窗弹幕', 'comet']]) {
    await picker.getByRole('button', { name: label, exact: true }).click();
    assert.equal(await picker.locator(`[data-picker-style="${style}"]`).isVisible(), true);
    assert.equal(await picker.locator('[data-picker-style="bubble"]').isHidden(), true);
    assert.equal(await custom.isHidden(), true);
  }
  await picker.getByRole('button', { name: '固定弹幕', exact: true }).click();
  await custom.getByRole('button', { name: '添加到画布：测试弹幕样式', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: /更换样式|改用内置样式/ }).count(), 0);
  assert.equal(await page.locator('[data-danmaku-style]').count(), 0);
  assert.equal(await page.locator('[data-preview-field="danmakuFontSize"]').isVisible(), false);
  await page.locator('[data-media-field="fontSize"]').fill('42');
  await page.locator('[data-media-field="fontSize"]').press('Tab');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  const saved = fixture.service.list()[0].document.items[0];
  assert.equal(saved.appearance.config.mediaStyle.id, imported.id);
  assert.equal(saved.appearance.config.mediaStyle.fontSize, 42);
  await page.reload();
  await page.locator('.preview-canvas-layer-select').click();
  assert.equal(await page.locator('[data-media-field="fontSize"]').inputValue(), '42');
  assert.equal(await page.getByRole('button', { name: /更换样式|改用内置样式/ }).count(), 0);
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  await picker.locator('[data-category="danmaku"]').click();
  await custom.getByRole('button', { name: '删除样式：测试弹幕样式', exact: true }).click();
  await custom.waitFor({ state: 'detached' });
  assert.equal(await picker.locator('[data-picker-style="bubble"]').count(), 1, 'library refresh does not duplicate built-ins');
  assert.equal(fixture.service.list()[0].document.items[0].appearance.config.mediaStyle.id, imported.id);
  assert.deepEqual(errors, []);
});

test('local styles import, replace in place, publish and survive library removal', { timeout: 60000 }, async t => {
  const { fixture, context, page, errors, media, request } = await setup(t);
  const desktop = await context.newPage();
  const url = await openCanvasDesktop(desktop, fixture);
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '添加组件', exact: true });
  await picker.locator('[data-category="clock"]').click();
  await pickImportFile(page, picker, media);
  const editor = page.getByRole('dialog', { name: '添加时钟底图', exact: true });
  await editor.getByRole('button', { name: '添加样式', exact: true }).waitFor();
  await editor.getByLabel('样式名称').fill('我的时钟');
  const area = editor.locator('.component-style-area');
  await area.focus();
  await area.press('ArrowRight');
  const beforeDrag = await area.boundingBox();
  await page.mouse.move(beforeDrag.x + 25, beforeDrag.y + 25);
  await page.mouse.down();
  await page.mouse.move(beforeDrag.x + 35, beforeDrag.y + 35, { steps: 3 });
  await page.mouse.up();
  const resize = await editor.locator('.component-style-area-resize').boundingBox();
  await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2);
  await page.mouse.down();
  await page.mouse.move(resize.x - 20, resize.y - 20, { steps: 3 });
  await page.mouse.up();
  await editor.getByRole('button', { name: '添加样式', exact: true }).click();
  await editor.waitFor({ state: 'hidden' });
  const imported = (await request('list'))[0].styles[0];
  assert.ok(imported.config.mediaStyle.content.x > 11);
  assert.ok(imported.config.mediaStyle.content.width < 80);
  await picker.getByRole('button', { name: '添加到画布：我的时钟', exact: true }).click();
  await page.locator('.scene-editor-item').waitFor();
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items.length === 1);
  const original = await desktop.evaluate(() => window.controllers.canvas.getState().draft.document.items[0]);
  const getItem = () => desktop.evaluate(() => window.controllers.canvas.getState().draft.document.items[0]);
  await page.getByRole('button', { name: '更换样式 / 添加素材', exact: true }).click();
  const library = page.getByRole('dialog', { name: '时钟底图样式', exact: true });
  await pickImportFile(page, library, { ...media, name: 'replacement.webp' });
  await editor.getByLabel('样式名称').fill('替换时钟');
  await editor.getByRole('button', { name: '添加样式', exact: true }).click();
  await editor.waitFor({ state: 'hidden' });
  await library.getByRole('button', { name: '更换「我的时钟」的样式：替换时钟', exact: true }).click();
  await desktop.waitForFunction(id => window.controllers.canvas.getState().draft.document.items[0].appearance.config.mediaStyle.id !== id, imported.id);
  const replaced = await getItem();
  for (const key of ['id', 'type', 'name', 'x', 'y', 'width', 'height', 'locked', 'visible']) assert.deepEqual(replaced[key], original[key], key);
  assert.equal(await page.locator('.scene-editor-item').count(), 1);
  await page.locator('[data-media-field="fontSize"]').fill('48');
  await page.locator('[data-media-field="fontSize"]').press('Tab');
  await page.getByRole('button', { name: '更换样式 / 添加素材', exact: true }).focus();
  await page.keyboard.press('Control+z');
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items[0].appearance.config.mediaStyle.fontSize === 64);
  assert.equal(await page.locator('[data-media-field="fontSize"]').inputValue(), '64', 'Undo also restores the visible media controls.');
  assert.equal(fixture.service.list()[0].hasPublication, false, 'Library changes do not go live.');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  const saved = fixture.service.list()[0];
  const source = fixture.service.getSource(saved.document.id);
  const outputUrl = `${fixture.origin}/scene?id=${source.id}#token=${source.token}`;
  assert.equal((await fetch(outputUrl)).status, 200);
  const output = await context.newPage();
  output.on('pageerror', error => errors.push(error.message));
  await output.goto(outputUrl);
  const live = output.frameLocator('.scene-version:not(.is-staging) iframe');
  await live.locator('.component-media-art').waitFor({ state: 'visible' });
  await live.locator('.clock-time').waitFor({ state: 'visible' });
  const bounds = await live.locator('.clock-time').evaluate(element => {
    const text = element.getBoundingClientRect(); const region = document.querySelector('.component-media-content').getBoundingClientRect();
    return { text: { x: text.x, y: text.y, right: text.right, bottom: text.bottom }, region: { x: region.x, y: region.y, right: region.right, bottom: region.bottom } };
  });
  assert.ok(bounds.text.x >= bounds.region.x && bounds.text.right <= bounds.region.right + 1);
  assert.ok(bounds.text.y >= bounds.region.y && bounds.text.bottom <= bounds.region.bottom + 1);
  await page.getByRole('button', { name: '更换样式 / 添加素材', exact: true }).click();
  await library.getByRole('button', { name: '删除样式：替换时钟', exact: true }).click();
  await library.getByRole('button', { name: '删除样式：替换时钟', exact: true }).waitFor({ state: 'hidden' });
  await library.getByRole('button', { name: '关闭', exact: true }).click();
  await output.reload();
  await live.locator('.component-media-art').waitFor({ state: 'visible' });
  assert.equal((await fetch(`${fixture.origin}${replaced.appearance.config.mediaStyle.src}`)).status, 200);
  await page.getByRole('button', { name: '改用内置样式', exact: true }).click();
  await desktop.waitForFunction(() => !window.controllers.canvas.getState().draft.document.items[0].appearance.config.mediaStyle);
  assert.equal(await live.locator('.component-media-art').count(), 1, 'Draft changes do not affect published output.');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  await output.reload();
  await live.locator('.clock-time').waitFor({ state: 'visible' });
  assert.equal(await live.locator('.component-media-art').count(), 0);
  await page.getByRole('button', { name: '更换样式 / 添加素材', exact: true }).click();
  const count = (await request('list')).flatMap(pack => pack.styles).length;
  await pickImportFile(page, library, { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') });
  await editor.getByRole('status').filter({ hasText: '无法播放此素材' }).waitFor();
  assert.equal(await editor.getByRole('button', { name: '添加样式', exact: true }).isDisabled(), true);
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal((await request('list')).flatMap(pack => pack.styles).length, count);
  assert.deepEqual(errors, []);
});

test('background controls keep author defaults, instance isolation and published appearance', { timeout: 60000 }, async t => {
  const { fixture, context, page, errors, media, request } = await setup(t);
  const defaults = { opacity: 0.8, blur: 2, fit: 'contain', brightness: 1.1, saturation: 0.9,
    contrast: 1.05, overlayColor: '#ffffff', overlayOpacity: 0.1 };
  const description = { type: 'background', filename: media.name, name: '测试背景', width: 640, height: 400, config: defaults };
  const installed = await request(`add?description=${encodeURIComponent(JSON.stringify(description))}`, media.buffer);
  const style = installed.styles[0];
  const desktop = await context.newPage();
  const url = await openCanvasDesktop(desktop, fixture);
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  async function addBackground() {
    await page.getByRole('button', { name: '添加组件', exact: true }).click();
    const picker = page.getByRole('dialog', { name: '添加组件', exact: true });
    await picker.locator('[data-category="background"]').click();
    await picker.getByRole('button', { name: '添加到画布：测试背景', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.scene-editor-item.is-selected .component-preview-load-state')?.hidden);
  }
  await addBackground();
  await addBackground();
  const field = key => page.locator(`[data-component-parameter="${key}"]`);
  assert.equal(await field('opacity').inputValue(), '80');
  assert.equal(await field('playbackRate').isVisible(), false);
  const frame = page.frameLocator('.scene-editor-item.is-selected iframe');
  const artwork = frame.locator('.component-media-art');
  await page.locator('[data-background-slider="opacity"]').fill('55');
  await artwork.evaluate(image => { image.dataset.originalBackground = 'true'; });
  await field('blur').fill('8');
  await field('fit').selectOption('cover');
  await page.locator('.background-parameters summary').filter({ hasText: '基础调色' }).click();
  for (const [key, value] of Object.entries({ brightness: '120', saturation: '70', contrast: '90', overlayOpacity: '25' })) {
    await field(key).fill(value);
  }
  await field('overlayColor').fill('#123456');
  await page.waitForFunction(() => document.querySelector('[data-component-parameter="opacity"]').value === '55');
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items.at(-1).appearance.config.overlayColor === '#123456');
  const edited = await desktop.evaluate(() => window.controllers.canvas.getState().draft.document.items);
  assert.equal(edited[0].appearance.config.opacity, 0.8, 'The other instance retains its defaults.');
  assert.equal(edited.at(-1).appearance.config.backgroundDefaults.opacity, 0.8);
  assert.deepEqual((await request('list'))[0].styles[0].config, style.config, 'Editing does not mutate the library template.');
  await artwork.evaluate(image => {
    if (getComputedStyle(image).filter !== 'blur(8px) brightness(1.2) saturate(0.7) contrast(0.9)') throw new Error('Appearance not applied');
  });
  assert.equal(await artwork.getAttribute('data-original-background'), 'true');
  assert.equal(await frame.locator('body').evaluate(body => getComputedStyle(body).opacity), '0.55');
  assert.equal(await frame.locator('body').evaluate(body => getComputedStyle(body, '::after').backgroundColor), 'rgb(18, 52, 86)');
  assert.equal(await frame.locator('body').evaluate(body => getComputedStyle(body, '::after').opacity), '0.25');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  const saved = fixture.service.list()[0];
  assert.equal(saved.document.items.at(-1).appearance.config.blur, 8);
  const source = fixture.service.getSource(saved.document.id);
  const outputUrl = `${fixture.origin}/scene?id=${source.id}#token=${source.token}`;
  assert.equal((await fetch(outputUrl)).status, 200);
  const output = await context.newPage();
  await output.goto(outputUrl);
  const published = output.frameLocator('.scene-version:not(.is-staging) iframe').last();
  await published.locator('.component-media-art').waitFor();
  assert.equal(await published.locator('body').evaluate(body => getComputedStyle(body).opacity), '0.55');
  assert.equal(await published.locator('.component-media-art').evaluate(image => getComputedStyle(image).objectFit), 'cover');
  await output.close();
  await request('remove', { id: style.id });
  await page.getByRole('button', { name: '恢复样式默认', exact: true }).click();
  assert.equal(await field('opacity').inputValue(), '80');
  assert.equal(await field('blur').inputValue(), '2');
  assert.equal(await field('fit').inputValue(), 'contain');
  assert.equal(await field('overlayOpacity').inputValue(), '10');
  const replacement = await request(`add?description=${encodeURIComponent(JSON.stringify({ ...description, name: '新背景', config: { opacity: 0.9, blur: 1 } }))}`, media.buffer);
  await page.getByRole('button', { name: '更换样式 / 添加素材', exact: true }).click();
  await page.getByRole('dialog', { name: '背景样式', exact: true }).getByRole('button', { name: '更换「测试背景」的样式：新背景', exact: true }).click();
  await desktop.waitForFunction(id => window.controllers.canvas.getState().draft.document.items.at(-1).appearance.config.mediaStyle.id === id, replacement.styles[0].id);
  assert.equal(await field('opacity').inputValue(), '90');
  assert.equal(await field('blur').inputValue(), '1');
  const replaced = await desktop.evaluate(() => window.controllers.canvas.getState().draft.document.items.at(-1));
  for (const key of ['id', 'name', 'x', 'y', 'width', 'height']) assert.equal(replaced[key], edited.at(-1)[key]);
  assert.deepEqual(errors, []);
});

test('custom media keeps live wishes, ordered gift events and opening/video lifecycle', { timeout: 60000 }, async t => {
  const { fixture, page, errors, media, request } = await setup(t);
  const hostUrl = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(hostUrl)).status, 200);
  await page.goto(hostUrl);
  const makeStyle = async (type, extra = {}, bytes = media.buffer, filename = media.name) => {
    const description = { type, filename, name: type, width: 640, height: 400, media: { durationMs: 700, ...extra } };
    return (await request(`add?description=${encodeURIComponent(JSON.stringify(description))}`, bytes)).styles[0].config;
  };
  const mount = async (route, config) => {
    assert.equal((await fetch(`${fixture.origin}${route}`)).status, 200);
    await page.evaluate(({ route, config }) => {
      document.body.replaceChildren();
      const frame = document.createElement('iframe'); frame.allow = 'autoplay'; frame.style.cssText = 'width:640px;height:400px;border:0';
      window.prepared = false; window.mediaStatus = '';
      window.onmessage = event => {
        if (event.source !== frame.contentWindow) return;
        if (event.data.type === 'component-preview:ready') frame.contentWindow.postMessage({ type: 'component-preview:init', config }, '*');
        if (event.data.type === 'component-preview:prepared') window.prepared = true;
        if (event.data.type === 'component-preview:status') window.mediaStatus = event.data.message;
      };
      frame.src = `${route}${route.includes('?') ? '&' : '?'}componentPreview=1&sceneComponent=1`;
      document.body.append(frame);
      window.sendMediaData = data => frame.contentWindow.postMessage({ type: 'component-preview:data', data }, '*');
    }, { route, config });
    await page.waitForFunction(() => window.prepared || window.mediaStatus);
    assert.equal(await page.evaluate(() => window.mediaStatus), '');
    return page.frameLocator('iframe');
  };
  const send = data => page.evaluate(value => window.sendMediaData(value), data);
  const wishes = await mount('/gift-wishes', await makeStyle('gift-wishes', { textColor: '#aaffdd', fontSize: 32 }));
  const data = { items: [{ id: 'synthetic-wish', period: 'day', giftName: '合成礼物',
    target: 100, count: 36, todayCount: 36, progress: 36, remaining: 64, displayStyle: 'card' }] };
  await send(data);
  await wishes.locator('.wish-card').waitFor({ state: 'visible' });
  data.items[0].count = 72; data.items[0].todayCount = 72; data.items[0].progress = 72; data.items[0].remaining = 28;
  await send(data);
  await wishes.getByText('72', { exact: true }).waitFor();
  assert.equal(await wishes.locator('.component-media-art').count(), 1);
  for (const [type, route] of [['gift-frame', '/gift-effects?giftComponent=frame'], ['guard-thanks', '/gift-effects?giftComponent=guard']]) {
    const frame = await mount(route, await makeStyle(type));
    const event = type === 'gift-frame'
      ? { type: 'gift:frame', eventId: 'one', userName: '观众甲', giftName: '测试礼物', num: 2, totalPriceCents: 1000, themeId: 'woodland-bloom' }
      : { type: 'gift:guard-thanks', eventId: 'one', userName: '观众甲', tier: 'captain', months: 3, textMode: 'bilingual', style: 'aurora' };
    await send({ reset: false, events: [event, event, { ...event, eventId: 'two', userName: '观众乙' }] });
    await frame.locator('.component-media-thanks').filter({ hasText: '观众甲' }).waitFor({ state: 'visible' });
    await frame.locator('.component-media-thanks').filter({ hasText: '观众乙' }).waitFor({ state: 'visible' });
    await frame.locator('.component-media-playback').waitFor({ state: 'hidden' });
    await send({ reset: false, events: [event] });
    assert.equal(await frame.locator('.component-media-playback').isVisible(), false, 'Repeated event stays consumed.');
    await send({ reset: false, events: [{ ...event, eventId: 'three' }] });
    await frame.locator('.component-media-playback').waitFor({ state: 'visible' });
    await send({ reset: true, events: [] });
    await frame.locator('.component-media-playback').waitFor({ state: 'hidden' });
  }
  const opening = await mount('/opening', await makeStyle('opening'));
  await send({ enabled: true });
  await opening.locator('.component-media-playback').waitFor({ state: 'visible' });
  await opening.locator('.component-media-playback').waitFor({ state: 'hidden' });
  await send({ enabled: true });
  assert.equal(await opening.locator('.component-media-playback').isVisible(), false);
  await send({ enabled: false }); await send({ enabled: true });
  await opening.locator('.component-media-playback').waitFor({ state: 'visible' });
  await send({ enabled: false });
  await opening.locator('.component-media-playback').waitFor({ state: 'hidden' });
  const longStyle = await makeStyle('gift-frame', { durationMs: 9000 });
  // Fake timers let the 8-second preview limit elapse without waiting in real time.
  await page.clock.install();
  const longPreview = await mount('/gift-effects?giftComponent=frame', longStyle);
  await send({ preview: true, events: [{ type: 'gift:frame', eventId: 'long', userName: '长动画观众', giftName: '礼物', num: 1, totalPriceCents: 1000 }] });
  await longPreview.locator('.component-media-playback').waitFor({ state: 'visible' });
  await longPreview.locator('.component-media-playback').evaluate(element => {
    element.dataset.longPreview = 'original'; element.dataset.visibilityChanges = '0';
    new MutationObserver(records => { element.dataset.visibilityChanges = String(Number(element.dataset.visibilityChanges) + records.length); })
      .observe(element, { attributes: true, attributeFilter: ['hidden'] });
  });
  await page.clock.fastForward(8250);
  assert.equal(await longPreview.locator('.component-media-playback').getAttribute('data-long-preview'), 'original', 'Long previews are not recreated at eight seconds.');
  assert.equal(await longPreview.locator('.component-media-playback').isVisible(), true);
  assert.equal(await longPreview.locator('.component-media-playback').getAttribute('data-visibility-changes'), '0');
  await send({ reset: true, events: [] });
  const videoBytes = Buffer.from(await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
    canvas.getContext('2d').fillRect(0, 0, 160, 90);
    const stream = canvas.captureStream(10); const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    recorder.ondataavailable = event => chunks.push(event.data);
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.start();
    const timer = setInterval(() => { const ctx = canvas.getContext('2d'); ctx.fillStyle = '#9870ee'; ctx.fillRect(0, 0, 160, 90); stream.getVideoTracks()[0].requestFrame(); }, 50);
    await new Promise(resolve => setTimeout(resolve, 1000)); recorder.stop(); await stopped;
    clearInterval(timer); stream.getTracks().forEach(track => track.stop());
    return [...new Uint8Array(await new Blob(chunks).arrayBuffer())];
  }));
  assert.ok(videoBytes.length > 64, 'The synthetic video includes encoded frames.');
  const videoConfig = await makeStyle('background', {}, videoBytes, 'motion.webm');
  const background = await mount('/background', videoConfig);
  await background.locator('video.component-media-art').waitFor({ state: 'visible' });
  await background.locator('video.component-media-art').evaluate(video => new Promise(resolve => {
    if (video.currentTime > 0) resolve(); else video.addEventListener('timeupdate', resolve, { once: true });
  }));
  assert.equal(await background.locator('video.component-media-art').evaluate(video => video.loop && !video.paused), true);
  await background.locator('video.component-media-art').evaluate(video => { video.dataset.originalVideo = 'true'; });
  await page.evaluate(config => document.querySelector('iframe').contentWindow.postMessage({ type: 'component-preview:config', config }, '*'),
    { ...videoConfig, opacity: 0.6, blur: 5, playbackRate: 0.75, volume: 0.2 });
  await background.locator('video.component-media-art').evaluate(video => new Promise((resolve, reject) => {
    const timer = setInterval(() => { if (video.playbackRate === 0.75) { clearInterval(timer); clearTimeout(timeout); resolve(); } }, 20);
    const timeout = setTimeout(() => { clearInterval(timer); reject(new Error('Video appearance did not update')); }, 3000);
  }));
  assert.deepEqual(await background.locator('video.component-media-art').evaluate(video => ({ original: video.dataset.originalVideo,
    rate: video.playbackRate, volume: video.volume, fit: getComputedStyle(video).objectFit, opacity: getComputedStyle(document.body).opacity })),
    { original: 'true', rate: 0.75, volume: 0.2, fit: 'cover', opacity: '0.6' });
  const eventVideo = await mount('/opening', await makeStyle('opening', { durationMs: 120000 }, videoBytes, 'opening.webm'));
  await send({ enabled: true });
  await eventVideo.locator('.component-media-playback').waitFor({ state: 'visible' });
  await eventVideo.locator('.component-media-playback').waitFor({ state: 'hidden', timeout: 4000 });
  assert.equal(await eventVideo.locator('video.component-media-art').evaluate(video => video.paused), true);
  assert.deepEqual(errors, []);
});
