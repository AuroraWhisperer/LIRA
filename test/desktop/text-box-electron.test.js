'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launchElectron } = require('../helpers/shared-electron');
const { useSharedBrowser } = require('../helpers/shared-browser');

const openBrowserSession = useSharedBrowser();

async function openTextBoxDesktop(t) {
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
  app = await launchElectron({ cwd: root, args: ['test/fixtures/danmaku-canvas-editor.cjs', directory], timeout: 15000 });
  const desktop = await app.firstWindow();
  desktop.setDefaultTimeout(5000);
  const errors = [];
  desktop.on('pageerror', error => errors.push(error.message));
  let initialLoadComplete = false;
  async function openTextBoxes() {
    await desktop.locator('#danmakuStyleChip').filter({ hasText: '已应用' }).waitFor();
    if (!initialLoadComplete) {
      // Only startup awaits loadURL; reopening needs the renderer, not every page resource.
      await desktop.waitForLoadState('load');
      initialLoadComplete = true;
    }
    // Reuse the fixture's authorized desktop session and real scene owner.
    await desktop.evaluate(async markup => {
      const html = new DOMParser().parseFromString(markup, 'text/html');
      document.body.replaceChildren(html.getElementById('textBoxPage'));
      const { enhanceSelects } = await import('/js/shared/select-menu.js');
      const { enhanceColorControls } = await import('/js/shared/color-control.js');
      const { initTextBoxes } = await import('/js/admin/text-box.js');
      enhanceSelects(); enhanceColorControls(); initTextBoxes();
    }, markup);
    await desktop.waitForFunction(() => !document.querySelector('[data-text-box="add"]').disabled);
  }
  await openTextBoxes();
  return { app, desktop, openTextBoxes, errors };
}

test('desktop text formatting survives undo, publication and reopening', { timeout: 60000 }, async t => {
  const { app, desktop, openTextBoxes, errors } = await openTextBoxDesktop(t);
  await desktop.evaluate(async () => {
    const { prepareComponentPreviews } = await import('/js/admin/component-preview-registry.js');
    window.textBoxCanvas = (await prepareComponentPreviews()).find(component => component.id === 'canvas');
    const { document } = textBoxCanvas.controller.getState().draft;
    document.title = '其他场景修改';
    textBoxCanvas.controller.edit({ document });
  });
  await desktop.locator('[data-text-box="discard"]').click({ force: true });
  await desktop.getByRole('dialog', { name: '放弃整个场景的修改？' }).waitFor();
  await desktop.locator('.lira-confirm-cancel').click({ force: true });
  await desktop.locator('.lira-confirm-backdrop').waitFor({ state: 'detached' });
  assert.equal(await desktop.evaluate(() => textBoxCanvas.controller.getState().draft.document.title), '其他场景修改');
  await desktop.locator('[data-text-box="discard"]').click({ force: true });
  await desktop.locator('.lira-confirm-confirm').click({ force: true });
  await desktop.locator('.lira-confirm-backdrop').waitFor({ state: 'detached' });
  assert.equal(await desktop.evaluate(() => textBoxCanvas.controller.getState().dirty), false);
  await desktop.locator('[data-text-box="add"]').click({ force: true });
  await desktop.getByLabel('文本框背景颜色', { exact: true }).click({ force: true });
  await desktop.getByRole('textbox', { name: '十六进制颜色', exact: true }).fill('#24314d');
  await desktop.getByRole('spinbutton', { name: '不透明度（%）', exact: true }).fill('80');
  await desktop.getByRole('button', { name: '完成', exact: true }).click({ force: true });
  const speed = desktop.getByRole('slider', { name: '滚动速度', exact: true });
  await desktop.getByRole('radio', { name: '横向', exact: true }).click({ force: true });
  await speed.fill('85');
  await desktop.getByRole('radio', { name: '纵向', exact: true }).click({ force: true });
  await desktop.getByRole('radio', { name: '静止', exact: true }).click({ force: true });
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
  // The browser editor suite owns formatting stress; cover one on/off cycle through Electron input here.
  for (let cycle = 0; cycle < 2; cycle++) {
    // Hidden Electron windows throttle animation frames; force skips only the
    // actionability wait, while retaining real mouse input and click handlers.
    for (const name of ['加粗 (Ctrl+B)', '斜体 (Ctrl+I)', '下划线 (Ctrl+U)']) {
      await desktop.getByRole('button', { name, exact: true }).click({ force: true });
    }
    const more = desktop.getByRole('button', { name: '更多文字格式', exact: true });
    if (await more.getAttribute('aria-expanded') === 'false') await more.click({ force: true });
    await desktop.getByRole('button', { name: '文字描边', exact: true }).click({ force: true });
    await desktop.getByRole('button', { name: '轻阴影', exact: true }).click({ force: true });
  }
  const readNodes = () => desktop.evaluate(() => textBoxCanvas.controller.getState().draft.document.items[0].appearance.config.nodes);
  const nodes = await readNodes();
  assert.equal(nodes[0].text, '在这里输入文字');
  assert.equal(nodes.filter(node => node.type === 'gift').length, 2);
  for (const key of ['bold', 'italic', 'underline', 'stroke', 'shadow']) assert.ok(!nodes[0][key], key);
  await desktop.keyboard.press('Control+z');
  assert.equal((await readNodes())[0].shadow, true);
  await desktop.keyboard.press('Control+Shift+z');
  assert.equal(Boolean((await readNodes())[0].shadow), false);
  await editor.focus();
  await desktop.keyboard.press('Control+a');
  await desktop.getByRole('button', { name: '下划线 (Ctrl+U)', exact: true }).click({ force: true });
  await desktop.getByRole('button', { name: '文字字体', exact: true }).click({ force: true });
  await desktop.getByRole('searchbox', { name: '文字字体：搜索', exact: true }).fill('小赖');
  await desktop.getByRole('option', { name: '小赖字体 · 软萌手写', exact: true }).click({ force: true });
  const frame = desktop.frames().find(frame => new URL(frame.url()).pathname === '/text-box');
  await frame.waitForFunction(() => getComputedStyle(document.querySelector('#textBox > span')).textDecorationLine === 'underline');
  await desktop.locator('[data-text-box="save"]').click({ force: true });
  await desktop.waitForFunction(() => document.querySelector('[data-text-box="status"]').textContent === '已保存');
  const saved = await app.evaluate(() => global.canvasTest.scene());
  assert.equal(saved.document.items[0].appearance.config.nodes[0].underline, true);
  assert.equal(saved.document.items[0].appearance.config.nodes[0].fontFamily, '"Lira Xiaolai"');
  assert.equal(saved.document.items[0].appearance.config.scrollSpeed, 85);
  assert.equal(saved.document.items[0].appearance.config.backgroundColor, '#24314dcc');
  assert.ok(saved.publishedVersion > 0);
  const source = await desktop.evaluate(() => textBoxCanvas.source());
  const readPublished = async () => {
    const response = await fetch(`${new URL(desktop.url()).origin}/api/scene/output?id=${source.id}&version=0`,
      { headers: { Authorization: `Bearer ${source.token}` } });
    assert.equal(response.status, 200);
    return (await response.json()).data.document;
  };
  const published = await readPublished();
  assert.equal(published.items[0].appearance.config.backgroundColor, '#24314dcc');
  await desktop.evaluate(async () => {
    const { document } = textBoxCanvas.controller.getState().draft;
    document.canvas.width += 100;
    textBoxCanvas.controller.edit({ document });
    await textBoxCanvas.controller.save();
  });
  assert.equal(await desktop.evaluate(() => textBoxCanvas.controller.getState().dirty), false);
  assert.equal((await readPublished()).canvas.width, published.canvas.width, 'saving a scene does not apply the new layout');
  await desktop.locator('[data-text-box="save"]').click({ force: true });
  await desktop.waitForFunction(() => document.querySelector('[data-text-box="status"]').textContent === '已保存');
  assert.equal((await readPublished()).canvas.width, published.canvas.width + 100,
    'text-box publication applies the saved non-text layout too');
  const hasTextBox = () => textBoxCanvas.controller.getState().draft.document.items.some(item => item.type === 'text-box');
  await desktop.locator('[data-text-box="remove"]').click({ force: true });
  assert.equal(await desktop.evaluate(hasTextBox), false);
  await desktop.locator('[data-text-box="discard"]').click({ force: true });
  await desktop.waitForFunction(hasTextBox);
  assert.equal((await desktop.reload({ waitUntil: 'domcontentloaded' })).status(), 200);
  await openTextBoxes();
  assert.equal(await desktop.locator('.text-box-scroll-speed input').inputValue(), '85');
  await desktop.frameLocator('.component-preview-frame').locator('#textBox > span').first().waitFor();
  assert.equal(await desktop.frameLocator('.component-preview-frame').locator('#textBox').evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(36, 49, 77, 0.8)');
  assert.equal(await editor.locator('[data-text-box-node]').count(), 2);
  assert.equal(await desktop.frameLocator('.component-preview-frame').locator('#textBox').evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].some(font => font.family === 'Lira Xiaolai' && font.status === 'loaded');
  }), true, 'the overlay loads the selected font file, rather than silently using a fallback');
  await desktop.evaluate(async () => {
    const { prepareComponentPreviews } = await import('/js/admin/component-preview-registry.js');
    const canvas = (await prepareComponentPreviews()).find(component => component.id === 'canvas');
    await canvas.preset({ action: 'delete', id: canvas.controller.getState().draft.document.id });
  });
  await desktop.locator('[data-text-box="add"]').click({ force: true });
  await desktop.waitForFunction(() => document.querySelectorAll('[data-text-box="list"] [aria-pressed]').length === 1);
  await desktop.locator('[data-text-box="save"]').click({ force: true });
  await desktop.waitForFunction(() => document.querySelector('[data-text-box="status"]').textContent === '已保存');
  assert.equal((await app.evaluate(() => global.canvasTest.scene())).document.items.length, 1);
  await desktop.evaluate(async () => {
    const { prepareComponentPreviews } = await import('/js/admin/component-preview-registry.js');
    const canvas = (await prepareComponentPreviews()).find(component => component.id === 'canvas');
    await canvas.preset({ action: 'create', title: '备用场景', duplicate: true });
  });
  await desktop.locator('[data-text-box="save"]').click({ force: true });
  await desktop.getByRole('dialog', { name: '应用整个场景？' }).waitFor();
  await desktop.locator('.lira-confirm-cancel').click({ force: true });
  await desktop.locator('.lira-confirm-backdrop').waitFor({ state: 'detached' });
  assert.match(await desktop.locator('[data-text-box="scene"]').textContent(), /当前输出：场景 1/);
  await desktop.locator('[data-text-box="save"]').click({ force: true });
  await desktop.locator('.lira-confirm-confirm').click({ force: true });
  await desktop.waitForFunction(() => document.querySelector('[data-text-box="status"]').textContent === '已保存');
  assert.equal(await desktop.evaluate(async () => {
    const { prepareComponentPreviews } = await import('/js/admin/component-preview-registry.js');
    const state = (await prepareComponentPreviews()).find(component => component.id === 'canvas').controller.getState();
    return state.activeSceneId === state.draft.document.id;
  }), true, 'confirming applies the edited scene');
  const originalId = await desktop.locator('.text-box-list-item[aria-pressed="true"]').getAttribute('data-item-id');
  const originalText = await editor.textContent();
  assert.equal(await desktop.locator('[data-text-box="scene-context"]').isVisible(), false);
  await desktop.locator('[data-text-box="duplicate"]').click({ force: true });
  const duplicateId = await desktop.locator('.text-box-list-item[aria-pressed="true"]').getAttribute('data-item-id');
  assert.equal(await desktop.locator('[data-text-box="source-bar"]').getAttribute('data-source-state'), 'pending');
  await editor.fill('副本的独立内容');
  await desktop.locator('[data-text-box="source-publish"]').click({ force: true });
  await desktop.waitForFunction(() => document.querySelector('[data-text-box="status"]').textContent === '已保存');
  assert.equal(await desktop.locator('[data-text-box="source-bar"]').getAttribute('data-source-state'), 'ready');
  await desktop.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { async writeText(value) { window.copiedTextBoxSource = value; } },
  }));
  for (const [id, text] of [[originalId, originalText], [duplicateId, '副本的独立内容']]) {
    await desktop.locator(`.text-box-list-item[data-item-id="${id}"]`).click({ force: true });
    assert.equal(await editor.textContent(), text, 'switching text boxes restores their independent contents');
    const displayedUrl = await desktop.locator('[data-text-box="source-url"]').textContent();
    assert.equal(new URL(displayedUrl).searchParams.get('item'), id);
    await desktop.locator('[data-text-box="copy"]').click({ force: true });
    await desktop.waitForFunction(itemId => window.copiedTextBoxSource
      && new URL(window.copiedTextBoxSource).searchParams.get('item') === itemId, id);
  }
  await editor.fill('修正容量');
  assert.ok(await desktop.locator('[data-text-box="save"]').isEnabled());
  for (const entry of ['copy', 'source-url']) {
    const token = await desktop.evaluate(async () => {
      const { requestScene } = await import('/js/admin/scene-api.js');
      const source = await requestScene('canvas');
      return (await requestScene('rotate', { id: source.outputId })).token;
    });
    await desktop.locator(`[data-text-box="${entry}"]`).click({ force: true });
    await desktop.waitForFunction(token => window.copiedTextBoxSource?.includes(token), token);
  }
  await desktop.evaluate(async () => {
    const { prepareComponentPreviews } = await import('/js/admin/component-preview-registry.js');
    const canvas = (await prepareComponentPreviews()).find(component => component.id === 'canvas');
    const { document } = canvas.controller.getState().draft;
    document.items.push({ ...document.items[0], id: crypto.randomUUID(), name: '网页', type: 'browser',
      appearance: { mode: 'independent', config: { url: 'https://example.test', viewportWidth: 320, viewportHeight: 180 } } });
    canvas.controller.edit({ document }); await canvas.controller.save();
    document.items.unshift(document.items.pop()); canvas.controller.edit({ document });
  });
  await desktop.locator('[data-text-box="save"]').click({ force: true });
  await desktop.getByRole('dialog', { name: '应用整个场景？' }).waitFor();
  await desktop.locator('.lira-confirm-cancel').click({ force: true });
  assert.deepEqual(errors, []);
});

test('desktop and canvas retain rejected text across layer selection until correction or discard', { timeout: 60000 }, async t => {
  const { app, desktop, errors } = await openTextBoxDesktop(t);
  const action = name => desktop.locator(`[data-text-box="${name}"]`);
  const selectedTab = desktop.locator('.text-box-list-item[aria-pressed="true"]');
  const body = page => page.getByRole('textbox', { name: '文本框内容', exact: true });
  const oversized = '字'.repeat(90000);
  await action('add').click();
  const otherId = await selectedTab.getAttribute('data-item-id');
  await body(desktop).fill('OTHER');
  await action('duplicate').click();
  const id = await selectedTab.getAttribute('data-item-id');
  await body(desktop).fill(oversized);
  assert.ok(await action('source-publish').isVisible());
  assert.ok(await action('source-publish').isDisabled());
  await body(desktop).fill('CONTROL');
  await action('source-publish').click();
  await desktop.waitForFunction(() => document.querySelector('[data-text-box="source-bar"]').dataset.sourceState === 'ready'
    && !document.querySelector('[data-text-box="save"]').disabled);
  const source = new URL(await action('source-url').textContent());
  const readOutput = async () => {
    const response = await fetch(`${source.origin}/api/scene/output?id=${source.searchParams.get('id')}`,
      { headers: { Authorization: `Bearer ${new URLSearchParams(source.hash.slice(1)).get('token')}` } });
    assert.equal(response.status, 200);
    const { data } = await response.json();
    const text = id => data.document.items.find(item => item.id === id).appearance.config.nodes.map(node => node.text).join('');
    return { version: data.version, text: text(id), other: text(otherId) };
  };
  const control = await readOutput();
  assert.equal(control.text, 'CONTROL');
  const tab = itemId => desktop.locator(`.text-box-list-item[data-item-id="${itemId}"]`);
  await body(desktop).fill(oversized);
  await selectedTab.click();
  assert.ok(await action('save').isDisabled());
  assert.ok(await action('discard').isEnabled());
  assert.equal((await body(desktop).textContent()).length, oversized.length);
  await tab(otherId).click();
  await body(desktop).fill('KEEP OTHER EDIT');
  assert.ok(await action('save').isDisabled());
  await action('save').dispatchEvent('click');
  assert.deepEqual(await readOutput(), control);
  await tab(id).click();
  assert.ok(await body(desktop).textContent() === oversized);
  await body(desktop).fill('DESKTOP VALID');
  await action('save').click();
  await desktop.waitForFunction(() => !document.querySelector('[data-text-box="save"]').disabled);
  const corrected = { version: control.version + 1, text: 'DESKTOP VALID', other: 'KEEP OTHER EDIT' };
  assert.deepEqual(await readOutput(), corrected);
  await body(desktop).fill(oversized);
  await action('discard').click();
  assert.equal(await body(desktop).textContent(), corrected.text);
  assert.ok(await action('save').isEnabled());

  await action('canvas').click();
  const url = await app.evaluate(async () => {
    for (let i = 0; i < 100 && !global.canvasTest.externalUrls.length; i++) await new Promise(resolve => setTimeout(resolve, 25));
    return global.canvasTest.externalUrls.at(-1);
  });
  assert.equal((await fetch(url)).status, 200);
  const browser = openBrowserSession();
  t.after(() => browser.close());
  const canvas = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  canvas.on('pageerror', error => errors.push(error.message));
  canvas.setDefaultTimeout(5000);
  await canvas.goto(url);
  const apply = canvas.getByRole('button', { name: '保存并应用', exact: true });
  const discard = canvas.getByRole('button', { name: '放弃修改', exact: true });
  const layer = itemId => canvas.locator(`.preview-canvas-layer-select[data-item-id="${itemId}"]`);
  assert.equal(await body(canvas).textContent(), corrected.text);
  await body(canvas).fill(oversized);
  await layer(id).click();
  assert.ok(await apply.isDisabled());
  assert.ok(await body(canvas).textContent() === oversized);
  await apply.dispatchEvent('click');
  await layer(otherId).click();
  assert.ok(await apply.isDisabled());
  assert.deepEqual(await readOutput(), corrected);
  await discard.click();
  await canvas.getByRole('button', { name: '继续编辑', exact: true }).click();
  await layer(id).click();
  assert.ok(await body(canvas).textContent() === oversized);
  await discard.click();
  await canvas.locator('.lira-confirm-confirm').click();
  assert.equal(await body(canvas).textContent(), corrected.text);
  assert.ok(await apply.isEnabled());
  assert.deepEqual(await readOutput(), corrected);
  await body(canvas).fill(oversized);
  await layer(otherId).click();
  await layer(id).click();
  await body(canvas).fill('CANVAS VALID');
  await apply.click();
  await canvas.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  assert.deepEqual(await readOutput(), { ...corrected, version: corrected.version + 1, text: 'CANVAS VALID' });
  assert.deepEqual(errors, []);
});
