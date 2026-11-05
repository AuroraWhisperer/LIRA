'use strict';

const assert = require('node:assert/strict');

const path = require('node:path');
const test = require('node:test');

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
  return { node, requests, render, edit };
}

test('settings pushes preserve unsaved gift-frame fields and update untouched fields', async () => {
  const { node, render, edit } = await createFixture();
  render({ giftFrameThresholdRmb: '20', giftFrameEnabled: 'false' });
  edit('giftFrameThresholdRmb', '99');
  render({ giftFrameThresholdRmb: '20', giftFrameEnabled: 'true' });
  assert.equal(node('giftFrameThresholdRmb').value, '99');
  assert.equal(node('giftFrameEnabled').checked, true);
});

test('save uses the submitted draft and preserves edits made while awaiting its response', async () => {
  const { node, requests, render, edit } = await createFixture();
  render({ giftFrameThresholdRmb: '20', giftFrameEnabled: 'false' });
  edit('giftFrameThresholdRmb', '99');
  const save = node('giftFrameSaveBtn').handlers.get('click')();
  assert.equal(requests[0].url, '/api/settings');
  assert.deepEqual(requests[0].body, { giftFrameEnabled: 'false', giftFrameThresholdRmb: '99.00' });
  edit('giftFrameThresholdRmb', '120');
  render({ giftFrameThresholdRmb: '99.00' });
  requests[0].resolve();
  await save;
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

test('a pending gift-frame save blocks a second submission and preserves the next draft', async () => {
  const { node, requests, render, edit } = await createFixture();
  render({ giftFrameThresholdRmb: '20.00', giftFrameEnabled: 'true' });
  edit('giftFrameThresholdRmb', '25');
  const first = node('giftFrameSaveBtn').handlers.get('click')();
  edit('giftFrameThresholdRmb', '30');
  const duplicate = node('giftFrameSaveBtn').handlers.get('click')();
  assert.equal(requests.length, 1);
  await duplicate;
  assert.equal(node('giftFrameSaveBtn').disabled, true);
  render({ giftFrameThresholdRmb: '25.00', giftFrameEnabled: 'true' });
  requests[0].resolve();
  await first;
  assert.equal(node('giftFrameThresholdRmb').value, '30');
  assert.equal(node('giftFrameThresholdRmb').dataset.dirty, 'true');
  const second = node('giftFrameSaveBtn').handlers.get('click')();
  render({ giftFrameThresholdRmb: '30.00', giftFrameEnabled: 'true' });
  requests[1].resolve();
  await second;
  assert.equal(node('giftFrameThresholdRmb').dataset.dirty, 'false');
  assert.equal(node('giftFrameSaveBtn').disabled, false);
});

test('reverting to the saved setting clears dirty state, except while that value is being replaced', async () => {
  const { node, requests, render, edit } = await createFixture();
  render({ giftFrameThresholdRmb: '20.00', giftFrameEnabled: 'false' });
  edit('giftFrameEnabled', true);
  edit('giftFrameEnabled', false);
  assert.equal(node('giftFrameSaveState').textContent, '');
  edit('giftFrameThresholdRmb', '99');
  edit('giftFrameThresholdRmb', '20');
  assert.equal(node('giftFrameThresholdRmb').dataset.dirty, 'false');
  edit('giftFrameThresholdRmb', '99');
  const save = node('giftFrameSaveBtn').handlers.get('click')();
  edit('giftFrameThresholdRmb', '20');
  render({ giftFrameThresholdRmb: '99.00', giftFrameEnabled: 'false' });
  requests[0].resolve(); await save;
  assert.equal(node('giftFrameThresholdRmb').value, '20');
  assert.equal(node('giftFrameThresholdRmb').dataset.dirty, 'true');
});
