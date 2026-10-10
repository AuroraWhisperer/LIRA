'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');
const { randomUUID } = require('node:crypto');
const { createTextBoxDefaults } = require('../../public/js/shared/text-box-config.js');
const { useSharedBrowser } = require('../helpers/shared-browser');

const openBrowserSession = useSharedBrowser();

test('preview opens independent component connections together before linking the window', { timeout: 15000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = openBrowserSession();
  const desktop = await browser.newPage();
  t.after(async () => { await browser.close(); await fixture.close(); });
  await openCanvasDesktop(desktop, fixture);
  await desktop.evaluate(() => window.previewHandle.close());
  desktop.setDefaultTimeout(3000);
  const expected = Object.keys(fixture.configs).length + 1;
  const opening = new Set();
  let release;
  const allStarted = new Promise(resolve => { release = resolve; });
  await desktop.route('**/api/component-preview', async route => {
    const command = route.request().postDataJSON();
    if (command.action === 'open') {
      opening.add(command.component);
      if (opening.size === expected) release();
      await allStarted;
    } else if (command.action === 'link') {
      assert.equal(opening.size, expected);
      assert.equal(command.links.length, expected);
    }
    await route.fallback();
  });
  t.after(() => release());
  await desktop.evaluate(() => window.reopen());
  await desktop.waitForFunction(() => window.externalPreviewUrl);
  const url = await desktop.evaluate(() => window.externalPreviewUrl);
  assert.equal(opening.size, expected);
  assert.equal(new URL(url).pathname, '/c');
  await desktop.evaluate(() => window.previewHandle.close());
});

test('text box instance previews reuse one canvas address and select the requested item', { timeout: 25000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const created = fixture.service.create({ title: '两个文本框', canvas: { width: 1920, height: 1080 } });
  const items = ['第一个文本框', '第二个文本框'].map((name, index) => ({
    id: randomUUID(), type: 'text-box', name, x: 80, y: index * 200, width: 640, height: 180,
    visible: true, locked: false, appearance: { mode: 'independent', config: createTextBoxDefaults() },
  }));
  fixture.service.save({ id: created.document.id, expectedRevision: created.revision,
    document: { ...created.document, items } });
  const desktop = await browser.newPage();
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await openCanvasDesktop(desktop, fixture);
  await desktop.evaluate(async () => {
    const { openComponentPreview } = await import('/js/admin/component-preview-dialog.js');
    window.openTextItem = selectedItemId => {
      window.externalPreviewUrl = '';
      window.previewHandle = openComponentPreview({ id: 'text-box', selectedItemId });
    };
  });
  const urls = new Map();
  for (const index of [1, 0, 1]) {
    await page.goto('about:blank');
    await desktop.evaluate(id => window.openTextItem(id), items[index].id);
    await desktop.waitForFunction(() => window.externalPreviewUrl);
    const url = await desktop.evaluate(() => window.externalPreviewUrl);
    if (urls.has(index)) assert.equal(url, urls.get(index));
    urls.set(index, url);
    assert.equal((await fixture.post({ action: 'resolve' }, new URL(url).hash.slice(1))).data.selectedItemId, items[index].id);
    assert.equal((await fetch(url)).status, 200);
    await page.goto(url);
    const selected = page.locator('.preview-canvas-layer-select[aria-pressed="true"]');
    await selected.waitFor();
    assert.equal(await selected.getAttribute('data-item-id'), items[index].id);
    assert.equal(await selected.textContent(), items[index].name);
    assert.equal(await page.locator('.preview-canvas-layer-select').count(), 2);
  }
  assert.equal(urls.get(0), urls.get(1));
  await page.reload();
  const selected = page.locator('.preview-canvas-layer-select[aria-pressed="true"]');
  await selected.waitFor();
  assert.equal(await selected.getAttribute('data-item-id'), items[1].id);
  for (const index of [0, 1, 0]) {
    await desktop.evaluate(async id => {
      window.externalPreviewUrl = '';
      await window.previewHandle.focus({ id: 'text-box', selectedItemId: id });
    }, items[index].id);
    assert.equal(await desktop.evaluate(() => window.externalPreviewUrl), '');
    assert.equal(await selected.getAttribute('data-item-id'), items[index].id);
    assert.equal(await page.locator('.preview-canvas-layer-select').count(), 2);
  }
});

for (const delay of ['receipt', 'submission']) test(`instance focus preserves new layers during delayed edit ${delay}`, { timeout: 20000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = openBrowserSession();
  let release;
  const held = new Promise(resolve => { release = resolve; });
  t.after(async () => { release(); await browser.close(); await fixture.close(); });
  const created = fixture.service.create({ title: '延迟确认', canvas: { width: 1920, height: 1080 } });
  const first = { id: randomUUID(), type: 'text-box', name: '第一个文本框', x: 80, y: 80, width: 640, height: 180,
    visible: true, locked: false, appearance: { mode: 'independent', config: createTextBoxDefaults() } };
  fixture.service.save({ id: created.document.id, expectedRevision: created.revision,
    document: { ...created.document, items: [first] } });
  const desktop = await browser.newPage();
  const page = await browser.newPage();
  page.setDefaultTimeout(5000); desktop.setDefaultTimeout(5000);
  const url = await openCanvasDesktop(desktop, fixture);
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.locator(`[data-item-id="${first.id}"].preview-canvas-layer-select`).click();
  let observed;
  const accepted = new Promise(resolve => { observed = resolve; });
  let intercepted = false;
  await page.route('**/api/component-preview', async route => {
    if (route.request().postDataJSON().action !== 'edit' || intercepted) return route.continue();
    intercepted = true;
    if (delay === 'submission') { observed(); await held; }
    const response = await route.fetch();
    if (delay === 'receipt') { observed(); await held; }
    await route.fulfill({ response });
  });
  await page.getByRole('spinbutton', { name: 'X', exact: true }).fill('96');
  await page.getByRole('spinbutton', { name: 'X', exact: true }).press('Tab');
  await accepted;
  if (delay === 'receipt') await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items[0].x === 96);
  const second = { ...first, id: randomUUID(), name: '第二个文本框', y: 320 };
  const focusRead = page.waitForRequest(request => new URL(request.url()).pathname === '/api/component-preview'
    && request.postDataJSON()?.focusId);
  const focusing = desktop.evaluate(async item => {
    const controller = window.controllers.canvas;
    const document = controller.getState().draft.document;
    document.items.push(item); controller.edit({ document });
    await window.previewHandle.focus({ id: 'text-box', selectedItemId: item.id });
  }, second);
  await focusRead;
  release();
  await focusing;
  await page.locator(`[data-item-id="${second.id}"].preview-canvas-layer-select[aria-pressed="true"]`).waitFor();
  assert.equal(await page.locator('.preview-canvas-layer-select').count(), 2);
  assert.deepEqual(await desktop.evaluate(() => window.controllers.canvas.getState().draft.document.items.map(item => item.id)),
    [first.id, second.id]);
  await page.locator(`[data-item-id="${first.id}"].preview-canvas-layer-select`).click();
  await page.getByRole('button', { name: '移除组件', exact: true }).click();
  await desktop.waitForFunction(id => {
    const items = window.controllers.canvas.getState().draft.document.items;
    return items.length === 1 && items[0].id === id;
  }, second.id);
});

test('a delayed preview selection cannot overwrite the latest selection on the shared canvas link', { timeout: 15000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = openBrowserSession();
  const desktop = await browser.newPage();
  let release;
  const held = new Promise(resolve => { release = resolve; });
  t.after(async () => { release(); await browser.close(); await fixture.close(); });
  const url = await openCanvasDesktop(desktop, fixture, 'clock');
  let observed;
  const started = new Promise(resolve => { observed = resolve; });
  await desktop.route('**/api/component-preview', async route => {
    const command = route.request().postDataJSON();
    if (command.action === 'link' && command.selectedId === 'queue') {
      observed();
      await held;
    }
    await route.fallback();
  });
  await desktop.evaluate(() => {
    window.externalPreviewUrl = '';
    window.slowFocus = window.previewHandle.focus({ id: 'queue', controller: window.controllers.queue });
  });
  await started;
  await desktop.evaluate(() => {
    window.latestFocus = window.previewHandle.focus({ id: 'clock', controller: window.controllers.clock });
  });
  release();
  await desktop.evaluate(async () => { await Promise.all([window.slowFocus, window.latestFocus]); });
  assert.equal(await desktop.evaluate(() => window.externalPreviewUrl), url);
  assert.equal((await fixture.post({ action: 'resolve' }, new URL(url).hash.slice(1))).data.selectedId, 'clock');
});

test('reopening and style changes reuse one short link and connected canvas, and old pages refresh into the same drafts', { timeout: 30000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = openBrowserSession();
  const desktop = await browser.newPage();
  const page = await browser.newPage();
  const second = await browser.newPage();
  const commands = [];
  const errors = [];
  t.after(async () => { await browser.close(); await fixture.close(); assert.deepEqual(errors, []); });
  for (const target of [desktop, page, second]) {
    target.setDefaultTimeout(5000);
    target.on('pageerror', error => errors.push(error.message));
  }
  desktop.on('request', request => {
    if (new URL(request.url()).pathname === '/api/component-preview') commands.push(request.postDataJSON());
  });
  const url = await openCanvasDesktop(desktop, fixture, 'clock');
  assert.ok(url.length <= 47, `Expected a compact editor URL, got ${url.length} characters.`);
  assert.equal(new URL(url).pathname, '/c');
  assert.equal(new URL(url).search, '');
  assert.match(new URL(url).hash, /^#[A-Za-z0-9_-]{22}$/);
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  const label = page.locator('[data-preview-field="clockCustomLabel"]');
  await label.fill('保留未保存编辑');
  await desktop.waitForFunction(() => window.controllers.clock.getState().draft.label === '保留未保存编辑');
  const sceneId = await desktop.evaluate(() => window.controllers.canvas.getState().draft.document.id);
  const focused = desktop.waitForResponse(async response => new URL(response.url()).pathname === '/api/component-preview'
    && response.request().postDataJSON().action === 'focus' && (await response.json()).data.focused);
  await desktop.evaluate(() => {
    window.originalHandle = window.previewHandle;
    window.reopen('clock'); window.reopen('clock'); window.reopen('clock');
  });
  await focused;
  assert.equal(await desktop.evaluate(() => window.previewHandle === window.originalHandle), true);
  assert.equal(await desktop.evaluate(() => window.externalPreviewUrl), '');
  assert.equal(commands.filter(({ action }) => action === 'open').length, 5);
  assert.equal(commands.filter(({ action }) => action === 'link').length, 2, 'Rapid clicks update the shared selection once.');
  assert.equal(commands.filter(({ action }) => action === 'revoke').length, 0);
  await second.goto(url);
  await second.locator('[data-preview-field="clockCustomLabel"]').waitFor();
  await page.locator('.preview-canvas-status').filter({ hasText: '编辑已在其他页面继续' }).waitFor();
  await page.reload();
  assert.equal(await label.inputValue(), '保留未保存编辑');
  await label.fill('刷新后继续编辑');
  await desktop.waitForFunction(() => window.controllers.clock.getState().draft.label === '刷新后继续编辑');
  assert.equal(await page.getByRole('button', { name: '保存并应用', exact: true }).isEnabled(), true);
  assert.equal(fixture.service.list()[0].publishedVersion, 0);
  // Changing the style refocuses the same canvas page and keeps its unsaved draft.
  await page.evaluate(() => { window.originalCanvas = document.querySelector('.scene-editor-canvas'); });
  const styleFocus = desktop.waitForResponse(async response => new URL(response.url()).pathname === '/api/component-preview'
    && response.request().postDataJSON().action === 'focus' && (await response.json()).data.focused);
  await desktop.evaluate(() => { window.externalPreviewUrl = ''; window.controllers.clock.edit({ style: 'flip' }); window.reopen('clock'); });
  await styleFocus;
  await page.frameLocator('iframe').locator('#clockCard[data-clock-style="flip"]').waitFor();
  assert.equal(await desktop.evaluate(() => window.externalPreviewUrl), '');
  assert.equal(await label.inputValue(), '刷新后继续编辑');
  assert.equal(await page.evaluate(() => window.originalCanvas === document.querySelector('.scene-editor-canvas')), true);
  assert.equal(await page.locator('.preview-canvas-layer-select').count(), 1);
  // Every component entry updates the selection on the same canvas link.
  const switchedFocus = desktop.waitForResponse(async response => new URL(response.url()).pathname === '/api/component-preview'
    && response.request().postDataJSON().action === 'focus' && (await response.json()).data.focused);
  await desktop.evaluate(() => window.reopen('danmaku'));
  await switchedFocus;
  assert.equal(await desktop.evaluate(() => window.externalPreviewUrl), '');
  await page.locator('.preview-canvas-layer-select[aria-pressed="true"]').filter({ hasText: '弹幕姬' }).waitFor();
  assert.equal(commands.filter(({ action }) => action === 'link').at(-1).selectedId, 'danmaku');
  assert.equal(await desktop.evaluate(() => window.controllers.canvas.getState().draft.document.id), sceneId);
  assert.equal(await page.locator('.preview-canvas-layer-select').count(), 2);
  assert.equal((await fixture.post({ action: 'resolve' }, new URL(url).hash.slice(1))).data.selectedId, 'danmaku');
  assert.equal(commands.filter(({ action }) => action === 'open').length, 5);
  await page.close();
  await second.close();
  await desktop.evaluate(async () => {
    window.externalPreviewUrl = '';
    await window.previewHandle.focus({ id: 'clock', controller: window.controllers.clock });
  });
  assert.equal(await desktop.evaluate(() => window.externalPreviewUrl), url, 'Without an attached page, focusing reopens the same link.');
  await desktop.evaluate(() => {
    window.previewHandle.close();
    window.reopen('clock');
    window.originalHandle = window.previewHandle;
    window.reopen('clock'); window.reopen('clock');
  });
  await desktop.waitForFunction(() => window.externalPreviewUrl);
  assert.equal(await desktop.evaluate(() => window.previewHandle === window.originalHandle), true);
  assert.equal(commands.filter(({ action }) => action === 'open').length, 10,
    'Repeated clicks during initialization must create one set of sessions.');
});

test('short-link startup retries transient errors and old long links remain editable', { timeout: 25000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const desktop = await browser.newPage();
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const url = await openCanvasDesktop(desktop, fixture, 'clock');
  const { data: { links } } = await fixture.post({ action: 'resolve' }, new URL(url).hash.slice(1));
  let resolutions = 0;
  let offline = false;
  await page.route('**/api/component-preview', async route => {
    if (route.request().postDataJSON().action === 'resolve') {
      resolutions++;
      if (offline || resolutions === 1) {
        await route.fulfill({ status: 503, json: { ok: false } });
        return;
      }
    }
    await route.continue();
  });
  await page.goto(url);
  await page.locator('[data-preview-field="clockCustomLabel"]').fill('短地址重连成功');
  await desktop.waitForFunction(() => window.controllers.clock.getState().draft.label === '短地址重连成功');
  const legacy = new URL('/component-preview?component=clock', fixture.origin);
  const primary = links.find(({ component }) => component === 'clock');
  legacy.hash = new URLSearchParams({ id: primary.id, token: primary.token, draftKey: primary.draftKey,
    canvas: JSON.stringify(links.find(({ component }) => component === 'canvas')),
    components: JSON.stringify(links.filter(({ component }) => !['canvas', 'clock'].includes(component))) }).toString();
  await page.goto('about:blank');
  await page.goto(legacy.href);
  assert.equal(await page.locator('[data-preview-field="clockCustomLabel"]').inputValue(), '短地址重连成功');
  await page.locator('[data-preview-field="clockCustomLabel"]').fill('旧地址继续编辑');
  await desktop.waitForFunction(() => window.controllers.clock.getState().draft.label === '旧地址继续编辑');
  await page.goto('about:blank');
  offline = true;
  const retrying = page.waitForResponse(response => response.url().endsWith('/api/component-preview')
    && response.request().postDataJSON()?.action === 'resolve');
  await page.goto(url);
  await retrying;
  await page.goto('about:blank');
  const attempts = resolutions;
  await page.waitForTimeout(1200);
  assert.equal(resolutions, attempts, 'Leaving during short-link startup must cancel retries.');
});
