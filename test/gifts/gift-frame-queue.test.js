'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const event = (id) => ({ type: 'gift:frame', eventId: `gift-frame:${id}`, userName: '观众', giftName: '礼物', num: 1, totalPriceCents: 2000, themeId: 'woodland-bloom' });
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function fixture() {
  const { createGiftFrameQueue } = await loadModuleExports(path.resolve('public/js/overlays/gift-frame-queue.js'));
  const plays = [];
  const errors = [];
  let visible = true;
  let disposed = false;
  const queue = createGiftFrameQueue({
    player: {
      play(payload) { return new Promise((resolve, reject) => plays.push({ payload, resolve, reject })); },
      dispose() { disposed = true; plays.at(-1)?.resolve(); },
    },
    onError: (error) => errors.push(error.message),
    canPlay: () => visible,
  });
  return { queue, plays, errors, setVisible: (value) => { visible = value; }, isDisposed: () => disposed };
}

test('one active plus 50 waiting play FIFO, without interruption, price priority or expiry', async () => {
  const { queue, plays } = await fixture();
  assert.equal(queue.enqueue(event(0)), true);
  for (let i = 1; i <= 50; i += 1) assert.equal(queue.enqueue(event(i)), true);
  assert.equal(queue.enqueue({ ...event(51), totalPriceCents: 99999999 }), false);
  assert.equal(plays.length, 1);
  // Even a flood beyond the dedupe history cannot duplicate active or queued items.
  for (let i = 52; i < 300; i += 1) queue.enqueue(event(i));
  assert.equal(queue.enqueue(event(0)), false);
  assert.equal(queue.enqueue(event(25)), false);
  for (let i = 0; i <= 50; i += 1) {
    assert.equal(plays.length, i + 1);
    assert.equal(plays[i].payload.eventId, event(i).eventId);
    plays[i].resolve();
    await flush();
  }
  assert.equal(plays.length, 51);
  assert.equal(queue.enqueue(event(301)), true);
  assert.equal(plays.length, 52);
  queue.dispose();
});

test('failed playback advances; duplicate live and preview ids never replay', async () => {
  const { queue, plays, errors } = await fixture();
  queue.enqueue(event(1));
  queue.enqueue({ ...event(2), preview: true });
  assert.equal(queue.enqueue({ ...event(2), preview: true }), false);
  plays[0].reject(new Error('media failure'));
  await flush();
  assert.deepEqual(errors, ['media failure']);
  assert.equal(plays[1].payload.eventId, event(2).eventId);
  plays[1].resolve();
  await flush();
  assert.equal(queue.enqueue(event(1)), false);
  assert.equal(queue.enqueue({ ...event(2), preview: true }), false);
  queue.dispose();
});

test('hidden preview waits, resumes FIFO, and disposal clears pending work', async () => {
  const { queue, plays, setVisible, isDisposed } = await fixture();
  setVisible(false);
  queue.enqueue(event(1));
  queue.enqueue(event(2));
  assert.equal(plays.length, 0);
  setVisible(true);
  queue.resume();
  assert.equal(plays.length, 1);
  queue.dispose();
  await flush();
  assert.equal(isDisposed(), true);
  assert.equal(plays.length, 1);
  assert.equal(queue.enqueue(event(3)), false);
});

test('unknown effects and malformed gifts cannot occupy a queue slot', async () => {
  const { queue, plays } = await fixture();
  for (const patch of [{ eventId: '' }, { themeId: 'unknown' }, { num: 0 }, { totalPriceCents: 0 }, { giftName: null }]) {
    assert.equal(queue.enqueue({ ...event(1), ...patch }), false);
  }
  assert.equal(plays.length, 0);
  queue.dispose();
});

test('the removed ribbon theme is rejected and missing themes still default to effect 1', async () => {
  const { queue, plays } = await fixture();
  assert.equal(queue.enqueue({ ...event(1), themeId: 'satin-ribbon' }), false);
  assert.equal(queue.enqueue({ ...event(2), themeId: undefined }), true);
  assert.equal(plays.length, 1);
  assert.equal(plays[0].payload.themeId, undefined);
  plays[0].resolve();
  await flush();
  assert.equal(plays.length, 1);
  queue.dispose();
});
