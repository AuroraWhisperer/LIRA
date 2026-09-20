'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { routes } = require('../src/server/routes/gift-wish-routes');
const { isOverlayRequestAllowed } = require('../src/server/access-policy');
const { projectOverlayResponse } = require('../src/server/overlay-projection');

function response() {
  return {
    setHeader() {},
    writeHead(status) {
      this.status = status;
    },
    end(body) {
      this.payload = JSON.parse(body);
    },
  };
}

test('wishes API rejects client source selection and maps stale and invalid writes', async () => {
  for (const key of ['sourceId', 'source_id']) {
    const res = response();
    await routes['GET /api/gifts/wishes'](
      {},
      { query: new URLSearchParams(`${key}=1`) },
      res,
    );
    assert.equal(res.status, 400);
  }
  for (const [code, status] of [
    ['INVALID_GIFT_WISH', 400],
    ['GIFT_VIEW_STALE', 409],
    ['GIFT_SOURCE_UNAVAILABLE', 409],
  ]) {
    const res = response();
    await routes['POST /api/gifts/wishes/save'](
      {
        giftWishes: {
          save() {
            throw Object.assign(new Error('bad'), { code });
          },
        },
      },
      { body: async () => ({ target: 1 }) },
      res,
    );
    assert.equal(res.status, status);
  }
  const res = response();
  const calls = [];
  await routes['POST /api/gifts/wishes/save'](
    {
      giftWishes: {
        save: (value) => {
          calls.push(value);
          return { id: 'one' };
        },
      },
      broadcastSnapshot: (reason) => calls.push(reason),
    },
    { body: async () => ({ target: 3 }) },
    res,
  );
  assert.equal(res.status, 200);
  assert.deepEqual(calls, [{ target: 3 }, 'gift:wishes']);
});

test('wish overlay can read only its progress and never mutate or expose source and sender data', () => {
  assert.equal(
    isOverlayRequestAllowed('gift-wishes', 'GET', '/api/gifts/wishes'),
    true,
  );
  for (const path of ['/api/gifts/wishes/save', '/api/gifts/wishes/delete']) {
    assert.equal(isOverlayRequestAllowed('gift-wishes', 'POST', path), false);
  }
  assert.equal(
    isOverlayRequestAllowed('gift-feed', 'GET', '/api/gifts/wishes'),
    false,
  );
  assert.equal(
    isOverlayRequestAllowed('gift-wishes', 'GET', '/api/gifts/history'),
    false,
  );
  const result = projectOverlayResponse('gift-wishes', '/api/gifts/wishes', {
    sourceId: 'private',
    guards: ['private'],
    session: { state: 'live', room_id: 'private' },
    items: [
      {
        id: 'one',
        giftName: '花',
        count: 3,
        target: 10,
        createdAt: 'private',
        sender: 'private',
      },
    ],
  });
  assert.doesNotMatch(JSON.stringify(result), /private/);
  assert.equal(result.items[0].count, 3);
});
