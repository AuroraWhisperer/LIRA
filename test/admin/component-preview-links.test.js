'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { chromium } = require('playwright');
const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');
const { randomUUID } = require('node:crypto');
const { createTextBoxDefaults } = require('../../public/js/shared/text-box-config.js');

test('text box instance links select the requested item and keep separate reusable entries', { timeout: 25000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = await chromium.launch({ headless: true });
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
    await desktop.evaluate(id => window.openTextItem(id), items[index].id);
    await desktop.waitForFunction(() => window.externalPreviewUrl);
    const url = await desktop.evaluate(() => window.externalPreviewUrl);
    if (urls.has(index)) assert.equal(url, urls.get(index));
    urls.set(index, url);
    assert.equal((await fixture.post({ action: 'resolve' }, new URL(url).hash.slice(1))).data.selectedItemId, items[index].id);
    assert.equal((await fetch(url)).status, 200);
    await page.goto('about:blank');
    await page.goto(url);
    const selected = page.locator('.preview-canvas-layer-select[aria-pressed="true"]');
    await selected.waitFor();
    assert.equal(await selected.getAttribute('data-item-id'), items[index].id);
    assert.equal(await selected.textContent(), items[index].name);
    assert.equal(await page.locator('.preview-canvas-layer-select').count(), 2);
  }
  assert.notEqual(urls.get(0), urls.get(1));
  await page.reload();
  const selected = page.locator('.preview-canvas-layer-select[aria-pressed="true"]');
  await selected.waitFor();
  assert.equal(await selected.getAttribute('data-item-id'), items[1].id);
});

test('reopening uses one short link and old pages can refresh into the same editable drafts', { timeout: 30000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = await chromium.launch({ headless: true });
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
  await desktop.evaluate(() => {
    window.originalHandle = window.previewHandle;
    window.reopen('clock'); window.reopen('clock'); window.reopen('clock');
  });
  await desktop.waitForFunction(() => window.externalPreviewUrl);
  assert.equal(await desktop.evaluate(() => window.previewHandle === window.originalHandle), true);
  assert.equal(await desktop.evaluate(() => window.externalPreviewUrl), url);
  assert.equal(commands.filter(({ action }) => action === 'open').length, 5);
  assert.equal(commands.filter(({ action }) => action === 'link').length, 1);
  assert.equal(commands.filter(({ action }) => action === 'revoke').length, 0);
  await second.goto(url);
  await second.locator('[data-preview-field="clockCustomLabel"]').waitFor();
  await page.getByRole('status').filter({ hasText: '编辑已在其他页面继续' }).waitFor();
  await page.reload();
  assert.equal(await label.inputValue(), '保留未保存编辑');
  await label.fill('刷新后继续编辑');
  await desktop.waitForFunction(() => window.controllers.clock.getState().draft.label === '刷新后继续编辑');
  assert.equal(await page.getByRole('button', { name: '保存并应用', exact: true }).isEnabled(), true);
  assert.equal(fixture.service.list()[0].publishedVersion, 0);
  // Each component entry keeps its selection while sharing the same relay.
  await desktop.evaluate(() => window.reopen('danmaku'));
  await desktop.waitForFunction(() => window.externalPreviewUrl);
  const switched = new URL(await desktop.evaluate(() => window.externalPreviewUrl));
  assert.equal(switched.search, '');
  assert.notEqual(switched.hash, new URL(url).hash);
  assert.equal((await fixture.post({ action: 'resolve' }, switched.hash.slice(1))).data.selectedId, 'danmaku');
  assert.equal((await fixture.post({ action: 'resolve' }, new URL(url).hash.slice(1))).data.selectedId, 'clock');
  assert.equal(commands.filter(({ action }) => action === 'open').length, 5);
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
  const browser = await chromium.launch({ headless: true });
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
