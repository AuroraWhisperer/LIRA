'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

async function createFixture() {
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
    document: { getElementById: node },
    window: { addEventListener: (name, fn) => handlers.set(name, fn) },
    location: { protocol: 'http:', port: '3000' },
    fetch: (url, options) =>
      new Promise((resolve) =>
        requests.push({
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
    node(id).value = value;
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
  assert.deepEqual(requests[0].body, { giftFrameEnabled: 'false', giftFrameThresholdRmb: '99.00' });
  edit('giftFrameThresholdRmb', '120');
  render({ giftFrameThresholdRmb: '99.00' });
  requests[0].resolve();
  await save;
  assert.equal(node('giftFrameThresholdRmb').value, '120');
  render({ giftFrameThresholdRmb: '99.00' });
  assert.equal(node('giftFrameThresholdRmb').value, '120');
});

test('effect 1 preview sends only its identity and editable caption fields', async () => {
  const { node, requests } = await createFixture();
  node('giftFramePreviewUser').value = '林间听风';
  node('giftFramePreviewGift').value = '小花花';
  node('giftFramePreviewNum').value = '8';
  const preview = node('giftFramePreviewBtn').handlers.get('click')();
  assert.deepEqual(requests[0].body, { userName: '林间听风', giftName: '小花花', num: 8, themeId: 'woodland-bloom' });
  requests[0].resolve();
  await preview;
  assert.match(node('giftFrameSaveState').textContent, /特效 1/);
});
