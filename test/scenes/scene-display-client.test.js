'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { redactCredentials } = require('../../src/shared/log-redaction');

test('scene fragment secrets are redacted in URL objects, strings and errors while ordinary anchors survive', () => {
  for (const input of ['http://127.0.0.1/scene?id=one#token=private&view=one',
    new URL('http://127.0.0.1/scene?id=one#token=private&view=one'),
    new Error('Failed http://127.0.0.1/scene?id=one#token=private')]) {
    assert.doesNotMatch(JSON.stringify(redactCredentials(input)), /private/);
  }
  assert.match(redactCredentials(new URL('https://example.test/doc#chapter-1')), /#chapter-1$/);
});

test('scene display retains session boundaries and filters gifts/SC without simulating messages', async () => {
  const { createSceneDanmakuDisplay } = await loadModuleExports(path.resolve(__dirname, '../../public/js/overlays/scene-danmaku-display.js'));
  const items = [];
  const display = createSceneDanmakuDisplay({ clear: () => { items.length = 0; }, append: (item) => items.push(item),
    status: () => {}, getStyle: () => 'signal' });
  const state = { status: 'connected', epoch: 'one', state: { liveStatus: 1, liveSessionId: 'live', confirmationMessage: '开播' }, events: [] };
  display.update(state);
  assert.equal(items.length, 1);
  display.update({ ...state, events: [{ type: 'gift', liveSessionId: 'live', giftName: '花', giftCount: 2 },
    { type: 'danmaku', liveSessionId: 'other', message: 'Wrong owner' }] });
  assert.equal(items.length, 2);
  assert.equal(items[1].message, '送出 花 × 2');
  display.update({ ...state, status: 'offline' });
  assert.equal(items.length, 0);
});
