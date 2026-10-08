'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

async function fixture() {
  const errors = [];
  const { EventBus } = await loadModuleExports(path.resolve(__dirname, '../../public/js/shared/event-bus.js'), {
    window: {},
    console: { error: (...args) => errors.push(args) },
  });
  return { bus: new EventBus(), errors };
}

test('a throwing once callback detaches without interrupting other subscribers', async () => {
  const { bus, errors } = await fixture();
  let calls = 0;
  const seen = [];
  bus.once('ready', () => {
    calls += 1;
    throw new Error('synthetic callback failure');
  });
  bus.on('ready', (value) => seen.push(value));
  bus.emit('ready', 1);
  bus.emit('ready', 2);
  assert.equal(calls, 1);
  assert.equal(errors.length, 1);
  assert.deepEqual(seen, [1, 2]);
  assert.equal(bus.listenerCount('ready'), 1);
});

test('a once callback cannot invoke itself by emitting the same event', async () => {
  const { bus } = await fixture();
  let calls = 0;
  bus.once('ready', () => {
    calls += 1;
    if (calls === 1) bus.emit('ready');
  });
  bus.emit('ready');
  assert.equal(calls, 1);
  assert.equal(bus.listenerCount('ready'), 0);
});

test('nested emission cannot replay a once callback from the outer listener snapshot', async () => {
  const { bus } = await fixture();
  const seen = [];
  bus.on('ready', (value) => {
    if (value === 'outer') bus.emit('ready', 'inner');
  });
  bus.once('ready', (value) => seen.push(value));
  bus.emit('ready', 'outer');
  assert.deepEqual(seen, ['inner']);
  assert.equal(bus.listenerCount('ready'), 1);
});
