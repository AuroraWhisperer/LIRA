'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

async function harness() {
  const listeners = new Map();
  const plays = [];
  const video = {
    hidden: true, src: '', paused: true, currentTime: 0, loads: 0,
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: name => listeners.delete(name),
    getAttribute: name => video[name],
    removeAttribute: name => { video[name] = ''; },
    load: () => { video.loads++; },
    pause: () => { video.paused = true; },
    play: () => {
      video.paused = false;
      return new Promise((resolve, reject) => plays.push({ resolve, reject }));
    },
  };
  const { createMoonlitBackground } = await loadModuleExports(
    path.resolve(__dirname, '../../public/js/overlays/background-moonlit.js'));
  return { video, plays, listeners, runtime: createMoonlitBackground(video),
    emit: name => listeners.get(name)?.() };
}

test('static and reduced-motion backgrounds never request the movie; animation waits for playback before revealing it', async () => {
  const h = await harness();
  h.runtime.update({ animated: false });
  h.runtime.update({ animated: true, reducedMotion: true });
  h.runtime.update({ animated: true, visible: false });
  assert.equal(h.video.src, '');
  assert.equal(h.plays.length, 0);
  h.runtime.update({ animated: true });
  h.runtime.update({ animated: true });
  assert.match(h.video.src, /moonlit-loop-hq-60\.webm$/);
  assert.equal(h.plays.length, 1);
  assert.equal(h.video.hidden, true);
  h.emit('playing');
  assert.equal(h.video.hidden, false);
});

test('hiding pauses playback without losing position; static and reduced motion reveal the original image', async () => {
  const h = await harness();
  h.runtime.update({ animated: true });
  h.emit('playing');
  h.video.currentTime = 7;
  h.runtime.update({ animated: true, visible: false });
  assert.equal(h.video.paused, true);
  h.runtime.update({ animated: true });
  assert.equal(h.video.currentTime, 7);
  assert.equal(h.video.paused, false);
  h.runtime.update({ animated: false });
  assert.equal(h.video.hidden, true);
  h.emit('playing');
  assert.equal(h.video.hidden, true);
  h.runtime.update({ animated: true });
  h.emit('playing');
  h.runtime.update({ animated: true, reducedMotion: true });
  assert.equal(h.video.paused, true);
  assert.equal(h.video.hidden, true);
});

test('old play rejections cannot hide newer playback; decode failure keeps the static fallback', async () => {
  const h = await harness();
  h.runtime.update({ animated: true });
  h.runtime.update({ animated: false });
  h.runtime.update({ animated: true });
  h.emit('playing');
  h.plays[0].reject(new Error('Interrupted'));
  await Promise.resolve();
  assert.equal(h.video.hidden, false);
  h.emit('error');
  assert.equal(h.video.hidden, true);
  assert.equal(h.video.paused, true);
  h.runtime.update({ animated: true });
  h.plays.at(-1).reject(new Error('Unsupported media'));
  await Promise.resolve();
  assert.equal(h.video.hidden, true);
});

test('disposal releases decoder and listeners and ignores pending playback', async () => {
  const h = await harness();
  h.runtime.update({ animated: true });
  h.runtime.dispose();
  h.runtime.dispose();
  h.plays[0].reject(new Error('Disposed'));
  await Promise.resolve();
  h.runtime.update({ animated: true });
  assert.equal(h.video.src, '');
  assert.equal(h.video.loads, 1);
  assert.equal(h.video.hidden, true);
  assert.equal(h.video.paused, true);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.plays.length, 1);
});
