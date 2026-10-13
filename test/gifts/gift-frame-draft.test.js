'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readAdminFragmentHtml } = require('../helpers/admin-html');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { createDom, createClock } = require('../helpers/toast-dom');

async function createFixture() {
  const { documentRef, windowRef } = createDom();
  const toasts = documentRef.createElement('div');
  documentRef.body.append(toasts);
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id))
      nodes.set(id, {
        id,
        value: '',
        checked: false,
        dataset: {},
        handlers: new Map(),
        addEventListener(name, fn) {
          this.handlers.set(name, fn);
        },
      });
    return nodes.get(id);
  }
  const handlers = new Map();
  const requests = [];
  const module = await loadModuleExports(path.resolve('public/js/admin/gift-frame.js'), {
    document: Object.assign(documentRef, { getElementById: (id) => id === 'toast' ? toasts : node(id) }),
    window: Object.assign(windowRef, { addEventListener: (name, fn) => handlers.set(name, fn) }),
    ...createClock(),
    location: { protocol: 'http:', port: '3000' },
    fetch: (url, options) =>
      new Promise((resolve) =>
        requests.push({
          url,
          body: JSON.parse(options.body),
          resolve: () =>
            resolve({
              ok: true,
              text: async () => JSON.stringify({ ok: true }),
            }),
        }),
      ),
  });
  module.initGiftFrame();
  const render = (settings) => handlers.get('app:settings-state')({ detail: settings });
  const edit = (id, value) => {
    node(id)[id.endsWith('Enabled') ? 'checked' : 'value'] = value;
    node('otherGiftFeature').handlers.get('input')?.({ target: node(id) });
    node(id).handlers.get('input')?.({ target: node(id) });
  };
  return { node, requests, render, edit, toasts, renderStyles: module.renderGiftFrameStyleState };
}

test('settings pushes preserve unsaved gift-frame fields and update untouched fields', async () => {
  const { node, render, edit } = await createFixture();
  render({ giftFrameThresholdRmb: '20', giftFrameEnabled: 'false' });
  edit('giftFrameThresholdRmb', '99');
  assert.match(node('giftFrameSaveState').textContent, /有未保存修改/);
  render({ giftFrameThresholdRmb: '20', giftFrameEnabled: 'true' });
  assert.equal(node('giftFrameThresholdRmb').value, '99');
  assert.equal(node('giftFrameEnabled').checked, true);
});

test('missing woodland package is visible before attempting a preview', async () => {
  const { node, renderStyles } = await createFixture();
  renderStyles([]);
  assert.equal(node('giftFrameStyleState').hidden, false);
  assert.match(node('giftFrameStyleState').textContent, /尚未导入林间花信/);
  renderStyles([{ packageId: 'lira.woodland-gift-frame', styles: [{ config: { resourceStyle: { preset: 'woodland-gift-frame' } } }] }]);
  assert.equal(node('giftFrameStyleState').hidden, true);
});

test('save uses the submitted draft and preserves edits made while awaiting its response', async () => {
  const { node, requests, render, edit, toasts } = await createFixture();
  render({ giftFrameThresholdRmb: '20', giftFrameEnabled: 'false' });
  edit('giftFrameThresholdRmb', '99');
  const save = node('giftFrameSaveBtn').handlers.get('click')();
  assert.equal(requests[0].url, '/api/settings');
  assert.deepEqual(requests[0].body, { giftFrameEnabled: 'false', giftFrameThresholdRmb: '99.00' });
  edit('giftFrameThresholdRmb', '120');
  render({ giftFrameThresholdRmb: '99.00' });
  requests[0].resolve();
  await save;
  assert.equal(toasts.children.length, 1);
  assert.match(toasts.textContent, /新修改还没保存/);
  assert.equal(node('giftFrameThresholdRmb').value, '120');
  render({ giftFrameThresholdRmb: '99.00' });
  assert.equal(node('giftFrameThresholdRmb').value, '120');
});

test('saving woodland does not resubmit retired ribbon settings', async () => {
  const { node, requests, render, edit } = await createFixture();
  render({ giftFrameThresholdRmb: '20', giftFrameEnabled: 'true', giftFrameRibbonThresholdRmb: '100', giftFrameRibbonEnabled: 'true' });
  edit('giftFrameThresholdRmb', '99');
  const save = node('giftFrameSaveBtn').handlers.get('click')();
  assert.deepEqual(requests[0].body, { giftFrameEnabled: 'true', giftFrameThresholdRmb: '99.00' });
  requests[0].resolve();
  await save;
});

test('reverting to the saved setting clears dirty state, except while that value is being replaced', async () => {
  const { node, requests, render, edit } = await createFixture();
  render({ giftFrameThresholdRmb: '20.00', giftFrameEnabled: 'false' });
  edit('giftFrameEnabled', true);
  edit('giftFrameEnabled', false);
  assert.equal(node('giftFrameSaveState').textContent, '');
  edit('giftFrameThresholdRmb', '99');
  edit('giftFrameThresholdRmb', '20');
  assert.equal(node('giftFrameSaveState').textContent, '');
  assert.equal(node('giftFrameThresholdRmb').dataset.dirty, 'false');
  edit('giftFrameThresholdRmb', '99');
  const save = node('giftFrameSaveBtn').handlers.get('click')();
  edit('giftFrameThresholdRmb', '20');
  render({ giftFrameThresholdRmb: '99.00', giftFrameEnabled: 'false' });
  requests[0].resolve(); await save;
  assert.equal(node('giftFrameThresholdRmb').value, '20');
  assert.equal(node('giftFrameThresholdRmb').dataset.dirty, 'true');
  assert.match(node('giftFrameSaveState').textContent, /新修改还没保存/);
});

test('invalid simulated quantity stays in the settings page without sending requests', async () => {
  const { node, requests } = await createFixture();
  for (const quantity of ['0', '-1', '1.5']) {
    node('giftFramePreviewNum').value = quantity;
    node('giftFramePreviewBtn').handlers.get('click')();
    assert.match(node('giftFrameSaveState').textContent, /预览数量必须是正整数/);
  }
  assert.equal(requests.length, 0);
});

test('the real gift page exposes only the woodland frame controls and the module previews through the canvas', () => {
  const html = readAdminFragmentHtml('pages/admin/toolbox/gift.html');
  const moduleSource = fs.readFileSync(path.resolve('public/js/admin/gift-frame.js'), 'utf8');
  assert.match(html, /id="otherGiftFeature"[^>]+data-other-feature-panel[\s\S]*?id="giftFrameEnabled"/);
  assert.match(html, /<input\b(?=[^>]*\sid="giftFrameThresholdRmb")(?=[^>]*\stype="number")[^>]*>/);
  for (const field of ['PreviewBtn', 'PreviewUser', 'PreviewGift', 'PreviewNum']) {
    assert.match(html, new RegExp(`id="giftFrame${field}"`));
  }
  assert.deepEqual([...html.matchAll(/data-gift-frame-effect="([^"]+)"/g)].map((match) => match[1]), ['woodland-bloom']);
  assert.doesNotMatch(html, /id="giftFrame(?:Theme|MotionMode|PreviewAmount|OverlayUrl|OpenBtn|CopyBtn)"|giftFrameRibbon/);
  assert.match(moduleSource, /openComponentPreview\(\{ id: 'gift-frame', previewData \}\)/);
  assert.doesNotMatch(moduleSource, /\/api\/gifts\/frame\/preview/);
});
