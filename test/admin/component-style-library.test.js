'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');
const { useSharedBrowser } = require('../helpers/shared-browser');

const openBrowserSession = useSharedBrowser();

test('canvas ZIP selection stays in the browser and wrong-category guidance reuses the chosen file', async t => {
  const { fixture, context, page, media, errors } = await setup(t);
  const desktop = await context.newPage();
  const url = await openCanvasDesktop(desktop, fixture);
  assert.equal((await fetch(url)).status, 200); await page.goto(url);
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '添加组件', exact: true });
  await picker.getByRole('button', { name: '背景', exact: true }).click();
  const { createStoredStyleZip } = require('../../scripts/component-style-zip');
  const manifest = { schemaVersion: 1, id: 'test.redirect', version: '1.0.0', name: '导入引导套装',
    styles: ['clock', 'background'].map(type => ({ type, name: type, file: 'frame.webp', width: 640, height: 400 })) };
  const file = { name: 'redirect.zip', mimeType: 'application/zip', buffer: createStoredStyleZip(new Map([
    ['lira-pack.json', Buffer.from(JSON.stringify(manifest))], ['frame.webp', media.buffer],
  ])) };
  let desktopPickerRequests = 0;
  await page.route('**/styles/pick-web?*', route => {
    desktopPickerRequests++;
    return route.fulfill({ json: { ok: true, data: null } });
  });
  await pickImportFile(page, picker, file);
  assert.equal(desktopPickerRequests, 0, 'Canvas imports open the chooser in the current browser, even when the desktop picker is available.');
  await picker.getByRole('button', { name: '前往「套装」导入', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '确认导入套装', exact: true });
  await confirmation.getByRole('button', { name: '导入套装', exact: true }).click();
  await picker.getByRole('region', { name: '导入引导套装 1.0.0', exact: true }).waitFor();
  assert.equal(await picker.locator('.component-style-card').count(), 2);
  await picker.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '素材管理', exact: true }).click();
  const manager = page.getByRole('dialog', { name: '素材管理', exact: true });
  const chooser = page.waitForEvent('filechooser');
  await manager.getByRole('button', { name: '更新素材包', exact: true }).click();
  manifest.version = '2.0.0';
  await (await chooser).setFiles({ ...file, buffer: createStoredStyleZip(new Map([
    ['lira-pack.json', Buffer.from(JSON.stringify(manifest))], ['frame.webp', media.buffer],
  ])) });
  await confirmation.getByRole('button', { name: '替换套装', exact: true }).click();
  await picker.getByRole('region', { name: '导入引导套装 2.0.0', exact: true }).waitFor();
  assert.equal(await picker.locator('.component-style-card').count(), 2);
  assert.deepEqual(errors, []);
});

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

test('canvas management restores a backup and refreshes presets without replacing the current draft', async t => {
  const { fixture, context, page, media, request, dataDir, errors } = await setup(t);
  const desktop = await context.newPage();
  const url = await openCanvasDesktop(desktop, fixture);
  const pack = await request(`add?description=${encodeURIComponent(JSON.stringify({ type: 'background', filename: 'frame.webp', name: '备份背景', width: 640, height: 400 }))}`, media.buffer);
  assert.equal((await fetch(url)).status, 200); await page.goto(url);
  const original = await page.locator('select[aria-label="场景"]').inputValue();
  await page.getByRole('button', { name: '素材管理', exact: true }).click();
  const manager = page.getByRole('dialog', { name: '素材管理', exact: true });
  await manager.getByText('背景 · 1 个样式', { exact: true }).waitFor();
  const downloaded = page.waitForEvent('download');
  await manager.getByRole('button', { name: '导出素材与场景备份', exact: true }).click();
  const backup = path.join(dataDir, 'canvas-backup.zip'); await (await downloaded).saveAs(backup);
  await manager.getByRole('status').filter({ hasText: '备份已导出' }).waitFor();
  let resumeInspection; let notifyInspection;
  const inspectionStarted = new Promise(resolve => { notifyInspection = resolve; });
  const inspectionHeld = new Promise(resolve => { resumeInspection = resolve; });
  await page.route(/\/api\/component-preview\/styles\/inspect-backup\?/, async route => {
    notifyInspection(); await inspectionHeld; await route.continue();
  }, { times: 1 });
  const chooser = page.waitForEvent('filechooser');
  await manager.getByRole('button', { name: '从备份恢复为副本', exact: true }).click();
  await (await chooser).setFiles(backup);
  await inspectionStarted;
  try {
    assert.equal(await manager.getByRole('button', { name: '移除整包', exact: true }).isDisabled(), true);
    assert.equal(await manager.getByRole('button', { name: '关闭', exact: true }).isDisabled(), true);
  } finally { resumeInspection(); }
  await manager.getByText(/备份包含 1 个素材包、1 份/).waitFor();
  await manager.getByRole('button', { name: '确认', exact: true }).click();
  await manager.getByRole('status').filter({ hasText: '已恢复 1 份布局' }).waitFor();
  assert.equal(await page.locator('select[aria-label="场景"] option').count(), 2);
  assert.equal(await page.locator('select[aria-label="场景"]').inputValue(), original);
  assert.deepEqual((await request('list')).map(entry => entry.id).includes(pack.id), true);
  assert.deepEqual(errors, []);
});

// The library no longer renders its own hidden file input: an add-style entry opens the
// source dialog, whose dialog hands the chosen file to onMedia or onArchive. That entry
// is not inside the list container in every mount — the component picker moves it into
// its category bar — so callers pass the host that owns the list being used.
async function pickImportFile(page, host, file) {
  await host.locator('.component-style-add, .preview-picker-import').first().click();
  const source = page.getByRole('dialog', { name: '添加第三方样式', exact: true });
  await source.waitFor();
  const chooser = page.waitForEvent('filechooser');
  await source.getByRole('button', { name: '选择文件', exact: true }).click();
  await (await chooser).setFiles(file);
  return source;
}

// The suite header imports a ZIP through its own button, which drives the same
// archive handler that the source dialog reaches for a selected .zip file.
async function importArchive(page, host, file) {
  const chooser = page.waitForEvent('filechooser');
  await host.getByRole('button', { name: '导入套装', exact: true }).click();
  await (await chooser).setFiles(file);
}

test('style libraries send each entry as the import target and keep rejected imports unpending', async t => {
  const { fixture, page, errors } = await setup(t);
  await openCanvasDesktop(page, fixture);
  await page.evaluate(async () => {
    const { mountComponentStyleLibrary } = await import('/js/admin/component-style-library.js');
    const style = (type, name) => ({ id: name, type, name, config: { mediaStyle: {
      kind: 'image', src: '/img/component-previews/clock-moonlit-fan.webp', width: 640, height: 400,
    } } });
    window.examplePacks = [
      { id: 'variants', packageId: 'old.variants', name: '感谢变体', version: '1.0.0', bytes: 100,
        styles: [style('guard-thanks', '蓝色感谢'), style('guard-thanks', '紫色感谢')] },
      { id: 'suite', packageId: 'real.suite', name: '时钟背景套装', version: '1.0.0', bytes: 100, isSuite: true,
        styles: [style('clock', '套装时钟'), style('background', '套装背景')] },
    ];
    window.cancelledStyleImports = [];
    window.styleImportTargets = [];
    window.inspectStyleError = '这是大航海感谢样式包，请从「添加组件 → 大航海感谢 → 添加样式」导入。';
    window.inspectStylePack = window.examplePacks[0];
    const request = async (action, args) => {
      if (action === 'list') return window.examplePacks;
      if (action === 'inspect') {
        window.styleImportTargets.push(args.target);
        if (window.inspectStyleError) throw new Error(window.inspectStyleError);
        return window.inspectStylePack;
      }
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
  const archive = { name: 'style.zip', mimeType: 'application/zip', buffer: Buffer.from('synthetic upload') };
  await importArchive(page, library, archive);
  await library.getByRole('status').filter({ hasText: '添加组件 → 大航海感谢 → 添加样式' }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.cancelledStyleImports), [], 'Rejected inspection creates no pending import to cancel.');
  await page.evaluate(() => {
    window.showStyleLibrary({ type: 'guard-thanks' });
    window.inspectStyleError = '';
  });
  await library.getByRole('button', { name: '添加到画布：紫色感谢', exact: true }).waitFor();
  const confirmation = page.getByRole('dialog', { name: '确认添加样式', exact: true });
  await pickImportFile(page, library, archive);
  await confirmation.getByRole('button', { name: '添加样式', exact: true }).waitFor();
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.styleImportTargets), ['suite', 'guard-thanks']);
  assert.deepEqual(errors, []);
});

test('suite management groups versions, confirms whole deletion and replaces through the canvas capability', async t => {
  const { fixture, context, page, errors, request, dataDir } = await setup(t);
  const { randomUUID } = require('node:crypto');
  const { createComponentStyleStore } = require('../../src/storage/component-style-store');
  const { createComponentStyleLibrary } = require('../../src/server/component-style-library');
  const store = createComponentStyleStore(dataDir);
  const pack = { id: randomUUID(), packageId: 'test.ui-suite', name: '测试套装', version: '1.0.0', bytes: 100, digest: 'v1',
    styles: ['clock', 'background'].map(type => ({ id: randomUUID(), type, name: `测试套装 · ${type === 'clock' ? '时钟' : '背景'}`,
      config: { mediaStyle: { kind: 'image', src: '/img/component-previews/clock-moonlit-fan.webp', width: 640, height: 400 } } })) };
  store.stage(pack); await createComponentStyleLibrary(dataDir).install(pack.id);
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
  await group.getByRole('button', { name: '删除套装', exact: true }).click();
  const deletion = page.getByRole('dialog', { name: '删除套装', exact: true });
  await deletion.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal((await request('list')).length, 1);
  let inspected;
  await page.route('**/api/component-preview/styles/inspect?*', route => {
    assert.equal(new URL(route.request().url()).searchParams.get('target'), 'suite');
    return route.fulfill({ json: { ok: true, data: store.describe(inspected) } });
  });
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

test('clock category combines built-in, standalone, suite and web styles and adds web clocks as browser items', { timeout: 30000 }, async t => {
  const { fixture, context, page, errors } = await setup(t);
  const desktop = await context.newPage();
  const url = await openCanvasDesktop(desktop, fixture);
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  const style = { id: 'suite-clock', type: 'clock', name: 'clock 套装样式', config: { mediaStyle: {
    kind: 'image', src: '/img/component-previews/clock-moonlit-fan.webp', width: 640, height: 400,
  } } };
  const packs = [
    { id: 'suite', isSuite: true, name: '分类测试套装', version: '1.0.0', styles: [style] },
    { id: 'standalone', styles: [{ ...style, id: 'standalone-clock', name: '单独导入的时钟' },
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
  await picker.locator('[data-category="clock"]').click();
  const custom = picker.locator('[data-custom-style-id="suite-clock"]');
  await custom.waitFor();
  const contents = await custom.evaluate(card => ({
    builtinCount: card.parentElement.querySelectorAll('[data-picker-style]').length,
    customIds: [...card.parentElement.querySelectorAll('[data-custom-style-id]')].map(node => node.dataset.customStyleId),
  }));
  assert.ok(contents.builtinCount > 0);
  assert.deepEqual(contents.customIds, ['suite-clock', 'standalone-clock', 'web-clock']);
  await picker.getByRole('button', { name: '添加到画布：网页时钟', exact: true }).waitFor();
  const requestsBeforeRefresh = listRequests;
  const refreshed = page.waitForResponse(response => response.url().includes('/styles/list?'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await refreshed;
  assert.equal(listRequests, requestsBeforeRefresh + 1, 'only the active category retains its refresh listener');
  await picker.getByRole('button', { name: '添加到画布：网页时钟', exact: true }).click();
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items.length === 1);
  const added = await desktop.evaluate(() => window.controllers.canvas.getState().draft.document.items[0]);
  assert.equal(added.type, 'browser', 'an imported HTML clock retains its browser renderer');
  assert.deepEqual(errors, []);
});

test('imported danmaku styles keep edits through reload and confirm library removal without changing the scene', { timeout: 45000 }, async t => {
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
  await custom.getByRole('button', { name: '添加到画布：测试弹幕样式', exact: true }).click();
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
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  await picker.locator('[data-category="danmaku"]').click();
  const removeStyle = custom.getByRole('button', { name: '删除样式：测试弹幕样式', exact: true });
  let removals = 0;
  page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/styles/remove')) removals += 1; });
  await removeStyle.click();
  const deletion = page.getByRole('dialog', { name: '删除样式', exact: true });
  await deletion.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(removals, 0, 'Cancelling the confirmation must not delete the style.');
  await removeStyle.click();
  await deletion.getByRole('button', { name: '删除样式', exact: true }).click();
  await custom.waitFor({ state: 'detached' });
  assert.equal(removals, 1, 'Confirming removes the style once.');
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
  await page.getByRole('button', { name: '更换样式 / 添加素材', exact: true }).click();
  await library.getByRole('button', { name: '删除样式：替换时钟', exact: true }).click();
  await page.getByRole('dialog', { name: '删除样式', exact: true }).getByRole('button', { name: '删除样式', exact: true }).click();
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
  await page.locator('[data-background-slider="opacity"]').fill('55');
  await field('blur').fill('8');
  await field('fit').selectOption('cover');
  await page.waitForFunction(() => document.querySelector('[data-component-parameter="opacity"]').value === '55');
  await desktop.waitForFunction(() => {
    const config = window.controllers.canvas.getState().draft.document.items.at(-1).appearance.config;
    return config.opacity === 0.55 && config.blur === 8 && config.fit === 'cover';
  });
  const edited = await desktop.evaluate(() => window.controllers.canvas.getState().draft.document.items);
  assert.equal(edited[0].appearance.config.opacity, 0.8, 'The other instance retains its defaults.');
  assert.deepEqual((await request('list'))[0].styles[0].config, style.config, 'Editing does not mutate the library template.');
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
  assert.equal(await field('fit').inputValue(), 'contain');
  const replacement = await request(`add?description=${encodeURIComponent(JSON.stringify({ ...description, name: '新背景', config: { opacity: 0.9, blur: 1 } }))}`, media.buffer);
  await page.getByRole('button', { name: '更换样式 / 添加素材', exact: true }).click();
  await page.getByRole('dialog', { name: '背景样式', exact: true }).getByRole('button', { name: '更换「测试背景」的样式：新背景', exact: true }).click();
  await desktop.waitForFunction(id => window.controllers.canvas.getState().draft.document.items.at(-1).appearance.config.mediaStyle.id === id, replacement.styles[0].id);
  assert.equal(await field('opacity').inputValue(), '90');
  const replaced = await desktop.evaluate(() => window.controllers.canvas.getState().draft.document.items.at(-1));
  for (const key of ['id', 'name', 'x', 'y', 'width', 'height']) assert.equal(replaced[key], edited.at(-1)[key]);
  assert.deepEqual(errors, []);
});

test('custom media consumes gift events once and keeps opening/video lifecycle', { timeout: 60000 }, async t => {
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
  {
    const frame = await mount('/gift-effects?giftComponent=frame', await makeStyle('gift-frame'));
    const event = { type: 'gift:frame', eventId: 'one', userName: '观众甲', giftName: '测试礼物', num: 2, totalPriceCents: 1000, themeId: 'woodland-bloom' };
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
  const eventVideo = await mount('/opening', await makeStyle('opening', { durationMs: 120000 }, videoBytes, 'opening.webm'));
  await send({ enabled: true });
  await eventVideo.locator('.component-media-playback').waitFor({ state: 'visible' });
  await eventVideo.locator('.component-media-playback').waitFor({ state: 'hidden', timeout: 4000 });
  assert.equal(await eventVideo.locator('video.component-media-art').evaluate(video => video.paused), true);
  assert.deepEqual(errors, []);
});
