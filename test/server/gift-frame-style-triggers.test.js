'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createScratchDirectory } = require('../helpers/scratch-directory');
const { migrateGiftFrameStyleTriggers, listGiftFrameTriggerStyleIds } = require('../../src/server/gift-frame-style-triggers');
const { createComponentStyleStore } = require('../../src/storage/component-style-store');

const id = (digit) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;

function writeLibrary(directory, index) {
  const root = path.join(directory, 'component-library');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'index.json'), typeof index === 'string' ? index : JSON.stringify({ version: 1, packages: index }));
}

function settingsStore(values) {
  const settings = { giftFrameStyleTriggers: '', ...values };
  return { settings, getSettings: () => ({ ...settings }), setSetting: (key, value) => { settings[key] = value; } };
}

test('upgrade copies the shared 林间花信 trigger to existing imported media styles once', (t) => {
  const directory = createScratchDirectory('gift-frame-triggers-', t);
  writeLibrary(directory, [
    // A removed library card can still be used by saved scenes.
    { id: id('1'), removed: true, styles: [{ id: id('2'), type: 'gift-frame', config: { mediaStyle: { id: id('2') } } }] },
    { id: id('3'), styles: [{ id: id('4'), type: 'gift-frame', config: { resourceStyle: { id: id('4'), preset: 'woodland-gift-frame' } } }] },
    { id: id('5'), styles: [{ id: id('6'), type: 'browser', category: 'gift-frame', config: { url: '/component-web/x/index.html' } }] },
  ]);
  const store = settingsStore({ giftFrameEnabled: 'true', giftFrameThresholdRmb: '25.5' });
  assert.equal(migrateGiftFrameStyleTriggers(store, directory), true);
  assert.deepEqual(JSON.parse(store.settings.giftFrameStyleTriggers), { [id('2')]: { enabled: 'true', thresholdRmb: '25.50' } });
  store.setSetting('giftFrameStyleTriggers', '{}');
  assert.equal(migrateGiftFrameStyleTriggers(store, directory), false, 'later starts keep saved choices');
  assert.equal(store.settings.giftFrameStyleTriggers, '{}');
});

test('an unreadable style library leaves the upgrade for the next start', (t) => {
  const directory = createScratchDirectory('gift-frame-triggers-', t);
  writeLibrary(directory, '{ damaged');
  const store = settingsStore({ giftFrameEnabled: 'true' });
  assert.equal(migrateGiftFrameStyleTriggers(store, directory), false);
  assert.equal(store.settings.giftFrameStyleTriggers, '');
});

test('gift ingress reads only media style ids and observes committed, external and recovered indexes', t => {
  const directory = createScratchDirectory('gift-frame-ids-', t);
  const packs = [{ id: id('1'), removed: true, styles: [
    { id: id('2'), type: 'gift-frame', removed: true, config: { mediaStyle: { id: id('2') } } },
    { id: id('3'), type: 'gift-frame', config: { cssStyle: { id: id('3') } } },
  ] }];
  writeLibrary(directory, packs);
  assert.deepEqual(listGiftFrameTriggerStyleIds(directory), [id('2')]);
  const clone = global.structuredClone;
  let wholeIndexes = 0;
  t.mock.method(global, 'structuredClone', value => {
    if (value?.packages) wholeIndexes++;
    return clone(value);
  });
  listGiftFrameTriggerStyleIds(directory).push('caller-mutation');
  assert.deepEqual(listGiftFrameTriggerStyleIds(directory), [id('2')]);
  assert.equal(wholeIndexes, 0, 'each gift must not clone unrelated style configurations');
  packs.push({ id: id('4'), styles: [{ id: id('5'), type: 'gift-frame', config: { mediaStyle: { id: id('5') } } }] });
  writeLibrary(directory, packs);
  assert.deepEqual(listGiftFrameTriggerStyleIds(directory), [id('2'), id('5')]);
  createComponentStyleStore(directory).updateConfig(id('5'), () => ({ cssStyle: { id: id('5') } }));
  assert.deepEqual(listGiftFrameTriggerStyleIds(directory), [id('2')]);
  writeLibrary(directory, '{ damaged');
  assert.deepEqual(listGiftFrameTriggerStyleIds(directory), [id('2')], 'damaged primary recovers the last committed index');
  writeLibrary(directory, JSON.stringify({ version: 2, packages: packs }));
  assert.throws(() => listGiftFrameTriggerStyleIds(directory), { code: 'STYLE_LIBRARY_INDEX_VERSION' });
});
