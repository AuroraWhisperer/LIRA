'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('./helpers/frontend-modules');

function event(eventId, preview = false) {
  return {
    type: 'gift:effect', source: 'danmaku', eventId, preview,
    effect: {
      mp4Url: 'https://i0.hdslb.com/test.mp4',
      layout: { videoWidth: 4, videoHeight: 2, rgbFrame: [0, 0, 2, 2], alphaFrame: [2, 0, 2, 2] },
    },
  };
}

async function fixture() {
  const { createGiftEffectPlayer } = await loadModuleExports(path.join(__dirname, '../public/js/overlays/gift-effect-player.js'), { URL });
  const played = [];
  const errors = [];
  let time = 0;
  const player = createGiftEffectPlayer({
    now: () => time,
    onError: error => errors.push(error),
    play(payload) {
      let resolve, reject;
      const done = new Promise((ok, fail) => { resolve = ok; reject = fail; });
      const playback = { payload, done, finish: resolve, fail: reject, stopped: false, stop() { this.stopped = true; resolve(); } };
      played.push(playback);
      return playback;
    },
  });
  return { player, played, errors, advance: value => { time += value; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('only one effect plays; duplicates are ignored and pending capacity is bounded', async () => {
  const { player, played } = await fixture();
  assert.equal(player.enqueue(event('off')), false);
  player.setEnabled(true);
  for (const id of ['1', '2', '3', '4']) assert.equal(player.enqueue(event(id)), true);
  assert.equal(player.enqueue(event('1')), false);
  assert.equal(player.enqueue(event('5')), false);
  assert.equal(played.length, 1);
  played[0].finish();
  await settle();
  assert.equal(played.length, 2);
  assert.equal(played[1].payload.eventId, '2');
  player.dispose();
});

test('disable stops command effects and clears their queue, while manual previews remain usable', async () => {
  const { player, played } = await fixture();
  player.setEnabled(true);
  player.enqueue(event('1'));
  player.enqueue(event('2'));
  player.setEnabled(false);
  await settle();
  assert.equal(played[0].stopped, true);
  assert.equal(played.length, 1);
  assert.equal(player.enqueue(event('preview', true)), true);
  assert.equal(played.length, 2);
  player.dispose();
  assert.equal(played[1].stopped, true);
});

test('expired effects are skipped, playback failures release the queue, and invalid media is rejected', async () => {
  const { player, played, errors, advance } = await fixture();
  player.setEnabled(true);
  player.enqueue(event('1'));
  player.enqueue(event('expired'));
  advance(12001);
  player.enqueue(event('next'));
  played[0].fail(new Error('decode'));
  await settle();
  assert.equal(errors.length, 1);
  assert.equal(played[1].payload.eventId, 'next');
  const bad = event('bad');
  bad.effect.mp4Url = 'https://untrusted.test/video.mp4';
  assert.equal(player.enqueue(bad), false);
  player.dispose();
});
