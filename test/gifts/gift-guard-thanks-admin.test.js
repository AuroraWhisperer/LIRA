'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readAdminHtml } = require('../helpers/admin-html');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { createDom, createClock } = require('../helpers/toast-dom');

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

test('the real gift page exposes every style control and the module previews through the canvas', () => {
  const html = readAdminHtml();
  const moduleSource = fs.readFileSync(path.resolve('public/js/admin/gift-guard-thanks.js'), 'utf8');
  assert.match(html, /<button\b(?=[^>]*\sid="giftAssistantGuardTab")(?=[^>]*\saria-controls="guardThanksPanel")(?=[^>]*\sdata-gift-tab="guard")[^>]*>/);
  for (const prefix of ['guardThanksAurora', 'guardThanksClassic']) {
    for (const suffix of ['Enabled', 'TextMode', 'PreviewTier', 'PreviewMonths', 'PlayBtn', 'SaveBtn', 'SaveState']) {
      assert.ok(html.includes(`id="${prefix}${suffix}"`), prefix + suffix);
    }
  }
  assert.ok(html.includes('id="guardThanksClassicPreviewUser"'));
  assert.doesNotMatch(html, /id="guardThanks(?:Style|Enabled|AuroraPreviewUser)"/);
  assert.equal(html.split('id="guardThanksStyleLibrary"').length - 1, 1);
  assert.doesNotMatch(html, /id="guardThanks(?:PreviewStage|OverlayUrl|SendBtn|OpenBtn|CopyBtn)"/);
  assert.match(html, /href="\/css\/admin\/gift-guard-thanks\.css"/);
  assert.match(fs.readFileSync(path.resolve('public/js/admin/app.js'), 'utf8'), /initGuardThanks\(\);/);
  assert.match(moduleSource, /openComponentPreview\(\{ id: 'guard-thanks', previewData, selectedItemId: item.id \}\)/);
  assert.doesNotMatch(moduleSource, /\/gift-effects/);
});
