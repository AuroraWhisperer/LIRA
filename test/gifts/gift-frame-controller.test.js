'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

async function fixture() {
  const listeners = new Map();
  const timers = new Map();
  const frames = new Map();
  const classes = new Set();
  const playRequests = [];
  let serial = 0;
  let pauses = 0;
  const video = {
    currentTime: 2,
    play: () => new Promise((resolve, reject) => playRequests.push({ resolve, reject })),
    pause: () => { pauses += 1; },
    load() {}, removeAttribute() {},
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
    requestVideoFrameCallback: (fn) => { frames.set(++serial, fn); return serial; },
    cancelVideoFrameCallback: (id) => frames.delete(id),
  };
  const caption = { style: {} };
  const text = () => ({ textContent: '', scrollWidth: 100, clientWidth: 100, parentElement: { style: {} } });
  const user = text(); const gift = text(); const num = text();
  const nodes = { video, '.gift-info': caption, '#giftInfoUser': user, '#giftInfoName': gift, '#giftInfoNum': num };
  const frameRoot = { querySelector: (selector) => nodes[selector], style: { setProperty(key, value) { this[key] = value; } }, classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) } };
  const windowHandlers = new Map();
  const window = { innerWidth: 960, innerHeight: 540, addEventListener: (name, fn) => windowHandlers.set(name, fn), removeEventListener: (name) => windowHandlers.delete(name) };
  const { createFrameController } = await loadModuleExports(path.resolve('public/js/overlays/gift-effects-frame.js'), {
    window,
    setTimeout: (fn, delay) => { timers.set(++serial, { fn, delay }); return serial; },
    clearTimeout: (id) => timers.delete(id),
  });
  const player = createFrameController({ frameRoot });
  const emit = (name, time) => { if (time !== undefined) video.currentTime = time; listeners.get(name)?.(); };
  return { player, emit, video, user, gift, num, caption, classes, timers, frames, listeners, frameRoot, window, windowHandlers, playRequests, pauses: () => pauses };
}
const payload = { userName: '<img src=x>', giftName: '林间花信', num: 2 };

test('caption follows media time, stays fixed during hold, and fully clears on end', async () => {
  const f = await fixture();
  const done = f.player.play(payload);
  assert.equal(f.video.currentTime, 0);
  assert.equal(f.user.textContent, payload.userName);
  assert.equal(f.num.textContent, '×2');
  assert.equal(f.caption.style.opacity, '0');
  assert.equal(f.frameRoot.style['--frame-scale'], 0.5);
  f.emit('playing', 0);
  f.emit('timeupdate', 0.6);
  assert.equal(f.caption.style.opacity, '1');
  assert.equal(f.caption.style.transform, 'translateY(0px)');
  f.emit('timeupdate', 3.6);
  assert.equal(f.caption.style.opacity, '1');
  assert.equal(f.caption.style.transform, 'translateY(0px)');
  f.emit('timeupdate', 3.9);
  assert.equal(f.caption.style.opacity, '0');
  f.emit('ended', 4);
  await done;
  assert.equal(f.user.textContent, '');
  assert.equal(f.classes.size + f.timers.size + f.frames.size + f.listeners.size, 0);
  const replay = f.player.play(payload);
  assert.equal(f.video.currentTime, 0);
  f.emit('playing', 0);
  f.emit('ended', 4);
  await replay;
  f.player.dispose();
  assert.equal(f.windowHandlers.size, 0);
});

test('loading timeout, stalled media and decoder errors release the player for the next gift', async () => {
  const f = await fixture();
  for (const failure of ['load', 'stall', 'error', 'reject']) {
    const done = f.player.play(payload);
    const rejected = assert.rejects(done);
    if (failure === 'load') {
      f.emit('timeupdate', 0);
      const timer = [...f.timers.values()][0];
      assert.equal(timer.delay, 10000);
      timer.fn();
    } else if (failure === 'stall') {
      f.emit('playing', 0.8);
      const timer = [...f.timers.values()][0];
      assert.equal(timer.delay, 5000);
      timer.fn();
    } else if (failure === 'error') f.emit('error');
    else f.playRequests.at(-1).reject(new Error('play rejected'));
    await rejected;
    assert.equal(f.classes.size + f.timers.size + f.frames.size + f.listeners.size, 0);
    assert.equal(f.gift.textContent, '');
  }
  f.player.dispose();
});

test('dispose cancels pending playback and late play rejection cannot clear a newer gift', async () => {
  const f = await fixture();
  const first = f.player.play(payload);
  const second = f.player.play({ ...payload, userName: '第二位' });
  await first;
  f.playRequests[0].reject(new Error('old play interrupted'));
  await Promise.resolve();
  assert.equal(f.user.textContent, '第二位');
  f.window.innerWidth = 1000; f.window.innerHeight = 1000;
  f.windowHandlers.get('resize')();
  assert.equal(f.frameRoot.style['--frame-scale'], 1000 / 1920);
  f.player.dispose();
  await second;
  await f.player.play(payload);
  assert.equal(f.playRequests.length, 2);
  assert.equal(f.classes.size + f.timers.size + f.frames.size + f.listeners.size, 0);
});
