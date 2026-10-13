'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

async function fixture(fetch) {
  const timers = new Map();
  const sizes = [];
  let sequence = 0;
  const properties = new Map();
  const style = { setProperty: (key, value) => properties.set(key, value), removeProperty: (key) => properties.delete(key) };
  const { watchComponentOutputSize } = await loadModuleExports(
    path.join(__dirname, '../../public/js/overlays/component-output-size.js'), {
      window: { __API_TOKEN__: 'synthetic-token' },
      document: { documentElement: { style } },
      AbortController,
      AbortSignal: {},
      fetch,
      setTimeout: (callback, delay) => { timers.set(++sequence, { callback, delay }); return sequence; },
      clearTimeout: (id) => timers.delete(id),
    },
  );
  return { timers, sizes, style, start: () => watchComponentOutputSize('clock', (size) => sizes.push(size)) };
}

test('component sizing works without AbortSignal static APIs and removes its timeout after success', async () => {
  let calls = 0;
  const f = await fixture(async () => {
    calls++;
    return { ok: true, json: async () => ({ ok: true, data: { width: 640, height: 360 } }) };
  });
  const dispose = f.start();
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  assert.equal(f.style.width, '640px');
  assert.equal(f.sizes.length, 1);
  assert.deepEqual([...f.timers.values()].map((timer) => timer.delay), [750]);
  dispose();
  assert.equal(f.timers.size, 0);
});

for (const action of ['timeout', 'dispose']) {
  test(`component sizing aborts an in-flight request on ${action}`, async () => {
    let signal;
    const f = await fixture((_url, options) => new Promise((_resolve, reject) => {
      signal = options.signal;
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const dispose = f.start();
    if (action === 'timeout') [...f.timers.values()][0].callback();
    else {
      dispose();
      assert.equal(f.timers.size, 0, 'dispose synchronously clears every owned timer');
    }
    await new Promise(setImmediate);
    assert.equal(signal.aborted, true);
    assert.equal(f.sizes.length, 0);
    assert.deepEqual([...f.timers.values()].map((timer) => timer.delay), action === 'timeout' ? [750] : []);
    dispose();
    assert.equal(f.timers.size, 0);
  });
}
