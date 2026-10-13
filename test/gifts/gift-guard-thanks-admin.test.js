'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readAdminFragmentHtml } = require('../helpers/admin-html');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { createDom, createClock } = require('../helpers/toast-dom');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');
const { useSharedBrowser } = require('../helpers/shared-browser');

const openBrowserSession = useSharedBrowser();

async function createFixture() {
  const { documentRef, windowRef } = createDom();
  const toasts = documentRef.createElement('div');
  documentRef.body.append(toasts);
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { id, value: '', checked: false, disabled: false, dataset: {},
      handlers: new Map(), addEventListener(name, fn) { this.handlers.set(name, fn); } });
    return nodes.get(id);
  }
  const handlers = new Map();
  const requests = [];
  const module = await loadModuleExports(path.resolve('public/js/admin/gift-guard-thanks.js'), {
    document: Object.assign(documentRef, { getElementById: id => id === 'toast' ? toasts : node(id) }),
    window: Object.assign(windowRef, { addEventListener: (name, fn) => handlers.set(name, fn) }),
    ...createClock(), location: { protocol: 'http:', port: '3000' },
    fetch: (url, options) => new Promise((resolve, reject) => requests.push({ url, body: JSON.parse(options.body), reject,
      resolve: () => resolve({ ok: true, text: async () => JSON.stringify({ ok: true }) }) })),
  });
  module.initGuardThanks();
  const render = settings => handlers.get('app:settings-state')({ detail: settings });
  const edit = (id, value) => {
    node(id)[id.endsWith('Enabled') ? 'checked' : 'value'] = value;
    node('guardThanksPanel').handlers.get('input')({ target: node(id) });
  };
  const click = id => node(id).handlers.get('click')();
  return { node, requests, render, edit, click };
}

test('each style saves only its own fields and leaves the other draft intact', async () => {
  const { node, requests, render, edit, click } = await createFixture();
  render({ guardThanksEnabled: 'true', guardThanksStyle: 'classic', guardThanksTextMode: 'en' });
  assert.equal(node('guardThanksAuroraEnabled').checked, false);
  assert.equal(node('guardThanksClassicEnabled').checked, true);
  edit('guardThanksAuroraEnabled', true);
  edit('guardThanksAuroraTextMode', 'zh');
  edit('guardThanksClassicTextMode', 'bilingual');
  assert.match(node('guardThanksClassicSaveState').textContent, /有未保存修改/);
  const save = click('guardThanksAuroraSaveBtn');
  assert.equal(requests[0].url, '/api/settings');
  assert.deepEqual(requests[0].body, { guardThanksAuroraEnabled: 'true', guardThanksAuroraTextMode: 'zh' });
  assert.equal(node('guardThanksAuroraSaveBtn').disabled, true);
  assert.equal(node('guardThanksClassicSaveBtn').disabled, false);
  requests[0].resolve();
  await save;
  assert.equal(node('guardThanksClassicTextMode').value, 'bilingual');
  assert.equal(node('guardThanksClassicTextMode').dataset.dirty, 'true');
  assert.equal(node('guardThanksAuroraTextMode').dataset.dirty, 'false');
  const classic = click('guardThanksClassicSaveBtn');
  assert.deepEqual(requests[1].body, { guardThanksClassicEnabled: 'true', guardThanksClassicTextMode: 'bilingual' });
  requests[1].resolve(); await classic;
});

test('settings pushes and a pending save preserve later edits and prevent duplicate submission', async () => {
  const { node, requests, render, edit, click } = await createFixture();
  edit('guardThanksAuroraTextMode', 'zh');
  const save = click('guardThanksAuroraSaveBtn');
  await click('guardThanksAuroraSaveBtn');
  assert.equal(requests.length, 1);
  edit('guardThanksAuroraTextMode', 'en');
  render({ guardThanksAuroraTextMode: 'zh', guardThanksClassicEnabled: 'true' });
  requests[0].resolve(); await save;
  assert.equal(node('guardThanksAuroraTextMode').value, 'en');
  assert.equal(node('guardThanksClassicEnabled').checked, true);
  assert.match(node('guardThanksAuroraSaveState').textContent, /新修改还没保存/);
  assert.equal(node('guardThanksAuroraSaveBtn').disabled, false);
});

test('a failed save keeps the style draft and reports the error in that style only', async () => {
  const { node, requests, edit, click } = await createFixture();
  edit('guardThanksClassicTextMode', 'en');
  const save = click('guardThanksClassicSaveBtn');
  requests[0].reject(new Error('Synthetic offline failure'));
  await save;
  assert.equal(node('guardThanksClassicTextMode').dataset.dirty, 'true');
  assert.match(node('guardThanksClassicSaveState').textContent, /经典设置没保存成功/);
  assert.equal(node('guardThanksAuroraSaveState').textContent, undefined);
  assert.equal(node('guardThanksClassicSaveBtn').disabled, false);
});

test('invalid preview months are reported independently without opening or saving', async () => {
  const { node, requests, click } = await createFixture();
  for (const prefix of ['guardThanksAurora', 'guardThanksClassic']) {
    for (const value of ['0', '1.5', '1000']) {
      node(`${prefix}PreviewMonths`).value = value;
      click(`${prefix}PlayBtn`);
      assert.match(node(`${prefix}SaveState`).textContent, /1–999/);
    }
  }
  assert.equal(requests.length, 0);
});

test('successful previews and preview errors preserve unsaved reminders until the values are restored', { timeout: 20000 }, async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: '<!doctype html><html><body></body></html>' });
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  let installed = true;
  let settingsWrites = 0;
  await page.route('**/api/component-styles/list', route => route.fulfill({ json: { ok: true, data: installed
    ? [{ packageId: 'lira.woodland-gift-frame', styles: [{ config: { resourceStyle: { preset: 'woodland-gift-frame' } } }] }] : [] } }));
  await page.route('**/api/settings', route => { settingsWrites += 1; return route.fulfill({ json: { ok: true } }); });
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.evaluate(async markup => {
    const html = new DOMParser().parseFromString(markup, 'text/html');
    for (const id of ['guardThanksPanel', 'otherGiftFeature']) {
      const node = html.getElementById(id); node.hidden = false; document.body.append(node);
    }
    const { setComponentPreviewPreparation } = await import('/js/admin/component-preview-registry.js');
    const { setActiveComponentPreview } = await import('/js/admin/component-preview-session.js');
    const draft = { document: { canvas: { width: 1920, height: 1080 }, items: [] } };
    setComponentPreviewPreparation(() => ({ id: 'canvas', controller: { getState: () => ({ loaded: true, draft }),
      edit(next) { Object.assign(draft, next); } } }));
    window.previewRequests = [];
    setActiveComponentPreview({ id: 'browser-preview', canReuse: () => true,
      focus: request => window.previewRequests.push(request), syncCanvas: async () => {} });
    const guard = await import('/js/admin/gift-guard-thanks.js');
    const frame = await import('/js/admin/gift-frame.js');
    guard.initGuardThanks(); frame.initGiftFrame();
    guard.renderGuardThanks({ guardThanksClassicEnabled: 'false', guardThanksClassicTextMode: 'bilingual' });
    frame.renderGiftFrame({ giftFrameEnabled: 'false', giftFrameThresholdRmb: '20' });
  }, readAdminFragmentHtml('pages/admin/toolbox/gift.html'));
  for (const [prefix, button, quantity] of [
    ['guardThanksClassic', 'PlayBtn', 'PreviewMonths'], ['giftFrame', 'PreviewBtn', 'PreviewNum'],
  ]) {
    await page.locator(`#${prefix}Enabled`).check();
    await page.locator(`#${prefix}${quantity}`).fill('1');
    await page.locator(`#${prefix}${button}`).click();
    await page.waitForFunction(expected => previewRequests.some(request => request.id === expected),
      prefix === 'giftFrame' ? 'gift-frame' : 'guard-thanks');
    assert.match(await page.locator(`#${prefix}SaveState`).textContent(), /有未保存修改/);
    await page.locator(`#${prefix}${quantity}`).fill('0');
    await page.locator(`#${prefix}${button}`).click();
    const error = await page.locator(`#${prefix}SaveState`).textContent();
    assert.match(error, /预览/); assert.match(error, /有未保存修改/);
    await page.locator(`#${prefix}Enabled`).uncheck();
    assert.equal(await page.locator(`#${prefix}SaveState`).textContent(), '');
    assert.equal(await page.locator(`#${prefix}Enabled`).getAttribute('data-dirty'), 'false');
  }
  installed = false;
  await page.locator('#giftFrameEnabled').check();
  await page.locator('#giftFramePreviewNum').fill('1');
  await page.locator('#giftFramePreviewBtn').click();
  await page.locator('#giftFrameSaveState').filter({ hasText: '请先从' }).waitFor();
  assert.match(await page.locator('#giftFrameSaveState').textContent(), /有未保存修改/);
  assert.equal(settingsWrites, 0, 'preview never saves the settings draft');
});

test('the real gift page exposes every style control and the module previews through the canvas', () => {
  const html = readAdminFragmentHtml('pages/admin/live-components/page.html');
  const shell = readAdminFragmentHtml('pages/admin/shell-start.html');
  const moduleSource = fs.readFileSync(path.resolve('public/js/admin/gift-guard-thanks.js'), 'utf8');
  assert.match(html, /<button\b(?=[^>]*\sid="giftAssistantGuardTab")(?=[^>]*\saria-controls="guardThanksFeature")(?=[^>]*\sdata-gift-tab="guard")[^>]*>/);
  for (const prefix of ['guardThanksAurora', 'guardThanksClassic']) {
    for (const suffix of ['Enabled', 'TextMode', 'PreviewTier', 'PreviewMonths', 'PlayBtn', 'SaveBtn', 'SaveState']) {
      assert.ok(html.includes(`id="${prefix}${suffix}"`), prefix + suffix);
    }
  }
  assert.ok(html.includes('id="guardThanksClassicPreviewUser"'));
  assert.doesNotMatch(html, /id="guardThanks(?:Style|Enabled|AuroraPreviewUser)"/);
  assert.equal(html.split('id="guardThanksStyleLibrary"').length - 1, 1);
  assert.doesNotMatch(html, /id="guardThanks(?:PreviewStage|OverlayUrl|SendBtn|OpenBtn|CopyBtn)"/);
  assert.match(shell, /href="\/css\/admin\/gift-guard-thanks\.css"/);
  assert.match(fs.readFileSync(path.resolve('public/js/admin/app.js'), 'utf8'), /initGuardThanks\(\);/);
  assert.match(moduleSource, /openComponentPreview\(\{ id: 'guard-thanks', previewData, selectedItemId: item.id \}\)/);
  assert.doesNotMatch(moduleSource, /\/gift-effects/);
});
