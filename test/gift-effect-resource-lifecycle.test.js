'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('./helpers/frontend-modules');

async function fixture(failure) {
  const timers = new Set();
  const frames = new Set();
  const gpu = new Set();
  const children = new Set();
  const videos = [];
  const errors = [];
  let contextsLost = 0;
  let lost = false;
  const create = () => { const resource = {}; gpu.add(resource); return resource; };
  const remove = (resource) => gpu.delete(resource);
  const gl = {
    createShader: create, createProgram: create, createBuffer: create, createTexture: create,
    deleteShader: remove, deleteProgram: remove, deleteBuffer: remove, deleteTexture: remove,
    getShaderParameter: () => failure !== 'compile', getProgramParameter: () => failure !== 'link',
    getExtension: () => ({ loseContext: () => contextsLost++ }), isContextLost: () => lost,
    getAttribLocation: () => 0, getUniformLocation: () => 0,
  };
  for (const method of ['shaderSource', 'compileShader', 'attachShader', 'linkProgram', 'useProgram', 'bindBuffer', 'bufferData', 'enableVertexAttribArray', 'vertexAttribPointer', 'uniform4f', 'bindTexture', 'texParameteri', 'viewport', 'texImage2D', 'drawArrays']) gl[method] = () => {};
  const document = {
    createElement(tag) {
      if (tag === 'canvas') {
        const canvas = { getContext: () => failure === 'no-context' ? null : gl, remove: () => children.delete(canvas) };
        return canvas;
      }
      const listeners = new Map();
      const video = {
        listeners, src: '', videoWidth: failure === 'dimensions' ? 8 : 4, videoHeight: 2,
        addEventListener: (event, fn) => listeners.set(event, fn),
        removeEventListener: (event) => listeners.delete(event),
        play: () => failure === 'play' ? Promise.reject(new Error('decode failed')) : Promise.resolve(),
        pause() { this.paused = true; },
        removeAttribute() { this.src = ''; },
        load() { this.unloaded = true; },
        requestVideoFrameCallback(fn) { frames.add(fn); return fn; },
        cancelVideoFrameCallback: (fn) => frames.delete(fn),
        emit: (event) => listeners.get(event)?.(),
      };
      videos.push(video);
      return video;
    },
  };
  const { createGiftEffectPlayer } = await loadModuleExports(path.join(__dirname, '../public/js/overlays/gift-effect-player.js'), {
    URL, document,
    setTimeout: (fn) => { timers.add(fn); return fn; }, clearTimeout: (fn) => timers.delete(fn),
  });
  const player = createGiftEffectPlayer({ stage: { append: (canvas) => children.add(canvas) }, onError: (error) => errors.push(error) });
  player.setEnabled(true);
  return { player, timers, frames, gpu, children, videos, errors, loseContext: () => { lost = true; }, contextsLost: () => contextsLost };
}

function payload(id) {
  return { type: 'gift:effect', source: 'danmaku', eventId: String(id), effect: {
    mp4Url: 'https://i0.hdslb.com/synthetic.mp4',
    layout: { videoWidth: 4, videoHeight: 2, rgbFrame: [0, 0, 2, 2], alphaFrame: [2, 0, 2, 2] },
  } };
}
const settle = () => new Promise(setImmediate);
function assertReleased(f) {
  assert.equal(f.timers.size, 0, 'watchdog released');
  assert.equal(f.frames.size, 0, 'video frame callback released');
  assert.equal(f.gpu.size, 0, 'all GPU objects released');
  assert.equal(f.children.size, 0, 'canvas detached');
  for (const video of f.videos) {
    assert.equal(video.listeners.size, 0, 'media listeners removed');
    assert.equal(video.src, '');
    assert.equal(video.paused, true);
    assert.equal(video.unloaded, true);
  }
}

test('repeated official effects release media, frame callbacks, GPU objects and DOM after each end', async () => {
  const f = await fixture();
  for (let i = 0; i < 25; i++) {
    assert.equal(f.player.enqueue(payload(i)), true);
    f.videos.at(-1).emit('loadeddata');
    assert.equal(f.gpu.size, 5);
    assert.equal(f.frames.size, 1);
    f.videos.at(-1).emit('ended');
    await settle();
    assertReleased(f);
  }
  assert.equal(f.contextsLost(), 25);
  f.player.dispose();
  f.player.dispose();
  assertReleased(f);
});

for (const failure of ['play', 'dimensions', 'no-context', 'compile', 'link', 'network', 'context-loss', 'watchdog', 'dispose']) {
  test(`official effect releases partial resources on ${failure}`, async () => {
    const f = await fixture(failure);
    f.player.enqueue(payload('first'));
    if (failure !== 'play') f.videos[0].emit('loadeddata');
    if (failure === 'network') f.videos[0].emit('error');
    if (failure === 'context-loss') {
      f.loseContext();
      const frame = [...f.frames][0]; f.frames.delete(frame); frame();
    }
    if (failure === 'watchdog') [...f.timers][0]();
    if (failure === 'dispose') { f.player.enqueue(payload('pending')); f.player.dispose(); }
    await settle();
    assertReleased(f);
    assert.equal(f.errors.length, failure === 'dispose' ? 0 : 1);
    f.player.dispose();
    assert.equal(f.videos.length, 1, 'disposed queue does not start another video');
  });
}
