'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createRuntimeTransport } = require('../src/server/runtime-transport');

test('runtime publication preserves gift snapshot/frame order, danmaku topic and overtime payload', (t) => {
  t.mock.method(console, 'log', () => {});
  const sent = [];
  const item = Object.freeze({ id: 4, text: 'hello' });
  let settings = { giftFrameEnabled: 'true', giftFrameThresholdRmb: '20' };
  const transport = createRuntimeTransport({
    defaultPort: 3000,
    getHost: () => '127.0.0.1',
    getStartedPort: () => 3010,
    getSessionToken: () => 'test-session',
    getState: () => ({}),
    getSettings: () => settings,
    getDanmakuFeedBuffer: () => ({
      push: (message) => (message ? item : null),
    }),
    getWebSocketHub: () => ({
      broadcastSnapshot: (context, reason) =>
        sent.push(['snapshot', context.allowedOrigins, reason]),
      broadcast: (payload, options) => sent.push(['event', payload, options]),
    }),
  });
  transport.publishGiftFlushed({
    id: 5,
    gift_id: 7,
    total_price: 25,
    detection_status: 'final',
  });
  assert.deepEqual(sent[0], [
    'snapshot',
    ['http://127.0.0.1:3010'],
    'bilibili:gift',
  ]);
  assert.equal(sent[1][1].type, 'gift:frame');
  assert.equal(sent[1][1].giftEventId, 5);
  assert.equal(sent[1][1].totalPriceCents, 2500);
  settings = { giftFrameEnabled: 'false' };
  transport.publishGiftFlushed({ id: 6, total_price: 25 });
  assert.equal(sent.length, 3);
  transport.publishDanmaku({ text: 'hello' });
  assert.deepEqual(sent[3], [
    'event',
    { type: 'danmaku:message', item },
    { topic: 'danmaku' },
  ]);
  transport.publishDanmaku(null);
  assert.equal(sent.length, 4);
  const state = { remainingMs: 1000 };
  const adjustment = { seconds: 2 };
  transport.publishOvertimeUpdate({ reason: 'tick', state });
  transport.publishOvertimeUpdate({ reason: 'gift', state, adjustment });
  assert.deepEqual(sent.slice(4), [
    ['event', { type: 'overtime:update', reason: 'tick', state }, undefined],
    [
      'event',
      { type: 'overtime:update', reason: 'gift', state, adjustment },
      undefined,
    ],
  ]);
});
