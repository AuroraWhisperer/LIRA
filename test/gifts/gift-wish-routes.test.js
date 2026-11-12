'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { routes } = require('../../src/server/routes/gift-wish-routes');
const { isOverlayRequestAllowed } = require('../../src/server/access-policy');
const { projectOverlayResponse } = require('../../src/server/overlay-projection');

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
    await routes['GET /api/gifts/wishes']({}, { query: new URLSearchParams(`${key}=1`) }, res);
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
  assert.equal(isOverlayRequestAllowed('gift-wishes', 'GET', '/api/gifts/wishes'), true);
  for (const path of ['/api/gifts/wishes/save', '/api/gifts/wishes/delete']) {
    assert.equal(isOverlayRequestAllowed('gift-wishes', 'POST', path), false);
  }
  assert.equal(isOverlayRequestAllowed('gift-feed', 'GET', '/api/gifts/wishes'), false);
  assert.equal(isOverlayRequestAllowed('gift-wishes', 'GET', '/api/gifts/history'), false);
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
        displayStyle: 'text',
        textTemplate: '许愿{礼物}（{已收}/{目标}）',
        textRuns: [{ text: '许愿{礼物}（{已收}/{目标}）', fontFamily: '"Lira Xiaolai"',
          fontSize: 40, underline: true, privateState: 'private' }],
        textImagePosition: 'inline',
        textImageFormat: 'static',
        textPendingColor: '#123456',
        textReceivedColor: '#654321',
        todayCount: 1,
        createdAt: 'private',
        sender: 'private',
      },
    ],
  });
  assert.doesNotMatch(JSON.stringify(result), /private/);
  assert.equal(result.items[0].count, 3);
  assert.equal(result.items[0].displayStyle, 'text');
  assert.equal(result.items[0].textTemplate, '许愿{礼物}（{已收}/{目标}）');
  assert.deepEqual(result.items[0].textRuns, [{ text: '许愿{礼物}（{已收}/{目标}）',
    fontFamily: '"Lira Xiaolai"', fontSize: 40, underline: true }]);
  assert.equal(result.items[0].textImagePosition, 'inline');
  assert.equal(result.items[0].textImageFormat, 'static');
  assert.equal(result.items[0].textPendingColor, '#123456');
  assert.equal(result.items[0].textReceivedColor, '#654321');
  assert.equal(result.items[0].todayCount, 1);
});

test('heart-box overlay reads only public progress and cannot adjust it', async () => {
  const path = '/api/gifts/heart-box-collection';
  const handler = routes[`GET ${path}`];
  const rejected = response();
  await handler({}, { query: new URLSearchParams('sourceId=9') }, rejected);
  assert.equal(rejected.status, 400);
  const res = response();
  await handler({ heartBoxCollection: { getSnapshot: () => ({ count: 37 }) } }, { query: new URLSearchParams() }, res);
  assert.equal(res.payload.data.count, 37);
  const unavailable = response();
  await handler({ heartBoxCollection: { getSnapshot() {
    throw Object.assign(new Error('unavailable'), { code: 'GIFT_SOURCE_UNAVAILABLE' });
  } } }, { query: new URLSearchParams() }, unavailable);
  assert.equal(unavailable.status, 409);
  assert.equal(isOverlayRequestAllowed('heart-box-collection', 'GET', path), true);
  assert.equal(isOverlayRequestAllowed('heart-box-collection', 'POST', path), false);
  assert.equal(isOverlayRequestAllowed('heart-box-collection', 'POST', `${path}/adjust`), false);
  assert.equal(isOverlayRequestAllowed('heart-box-collection', 'GET', '/api/gifts/history'), false);
  assert.equal(isOverlayRequestAllowed('gift-wishes', 'GET', path), false);
  const projected = projectOverlayResponse('heart-box-collection', path, {
    count: 37, status: 'collecting', sourceId: 'private', sender: 'private',
    stages: [{ target: 20, multiplier: 4, castles: 1, unlocked: true, internal: 'private' }],
  });
  assert.equal(projected.count, 37);
  assert.equal(projected.stages[0].unlocked, true);
  assert.doesNotMatch(JSON.stringify(projected), /private/);
});

test('heart-box adjustment rejects source selection and reports write conflicts without broadcasting', async () => {
  const handler = routes['POST /api/gifts/heart-box-collection/adjust'];
  const reasons = [];
  let writes = 0;
  const context = {
    heartBoxCollection: { adjust: () => { writes++; return { count: 12 }; } },
    broadcastSnapshot: (reason) => reasons.push(reason),
  };
  const rejected = response();
  await handler(context, { body: async () => ({ sourceId: 9, count: 12 }) }, rejected);
  assert.equal(rejected.status, 400);
  assert.equal(writes, 0);
  const saved = response();
  await handler(context, { body: async () => ({ count: 12 }) }, saved);
  assert.equal(saved.status, 200);
  assert.equal(writes, 1);
  assert.deepEqual(reasons, ['gift:heart-box-collection']);
  for (const [code, status] of [['INVALID_HEART_BOX_PROGRESS', 400], ['GIFT_VIEW_STALE', 409]]) {
    context.heartBoxCollection.adjust = () => { throw Object.assign(new Error('rejected'), { code }); };
    const result = response();
    await handler(context, { body: async () => ({ count: 12 }) }, result);
    assert.equal(result.status, status);
  }
  assert.equal(reasons.length, 1);
});
