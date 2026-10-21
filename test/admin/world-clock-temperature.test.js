'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');

const flush = () => new Promise(resolve => setImmediate(resolve));
const city = id => ({ id, lat: Number(id), lon: 100 });
const data = (temperature, condition) => ({ temperature, condition, updatedAt: '2026-10-21T12:00:00Z', validAt: '2026-10-21T13:30:00Z' });
const HOUR_MS = 60 * 60 * 1000;
const START = Date.parse('2026-10-21T13:37:45Z');

async function fixture(t, initialIds = ['1', '2', '3'], time = START) {
  let cities = initialIds.map(city);
  let sequence = 0;
  const requests = [];
  const timers = new Map();
  const completions = [];
  const { createTemperatureController } = await loadModuleExports(path.resolve(__dirname, '../../public/js/admin/world-clock/temperature.js'), {
    AbortController,
    Date: class extends Date {
      static now() { return time; }
    },
    window: { __API_TOKEN__: 'synthetic-token' },
    setTimeout(callback, ms) { timers.set(++sequence, { callback, ms, at: time + ms }); return sequence; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, options) {
      const pending = Promise.withResolvers();
      requests.push({ url, options, succeed(temperature, condition = '晴朗') {
        pending.resolve({ ok: true, json: async () => ({ ok: true, data: data(temperature, condition) }) });
      }, fail: () => pending.reject(new Error('offline')) });
      return pending.promise;
    },
  });
  const controller = createTemperatureController({ getCities: () => cities, onChange() {}, onComplete: result => completions.push(result) });
  t.after(() => controller.destroy());
  return { controller, requests, timers, completions, advance: ms => { time += ms; },
    setCities: ids => { cities = ids.map(city); }, async automaticRefresh(lateBy = 0) {
    const [id, timer] = [...timers][0];
    assert.equal(timer.at % HOUR_MS, 0, 'refresh is scheduled at the next whole hour');
    time = timer.at + lateBy;
    timers.delete(id);
    timer.callback();
    await flush();
  } };
}

test('startup refresh runs once and repeats silently at whole hours without completion-time drift', async t => {
  const f = await fixture(t);
  assert.equal(f.requests.length, 0);
  f.controller.start();
  f.controller.start();
  assert.equal(f.requests.length, 2);
  assert.equal([...f.timers.values()][0].ms, 22 * 60000 + 15000);
  assert.equal(f.requests[0].options.headers.Authorization, 'Bearer synthetic-token');
  assert.equal(f.requests[0].options.cache, 'no-store');
  f.requests[0].succeed(0);
  f.advance(10000);
  await flush();
  assert.equal(f.requests.length, 3);
  assert.equal(f.completions.length, 0);
  f.requests[1].succeed(-3);
  f.requests[2].succeed(26);
  await flush();
  assert.equal(f.completions.length, 0);
  assert.equal(f.controller.get('1').data.temperature, 0);
  await f.automaticRefresh();
  assert.equal(f.requests.length, 5);
  f.requests[3].succeed(1);
  f.requests[4].succeed(-2);
  await flush();
  f.requests[5].succeed(27);
  await flush();
  assert.equal(f.completions.length, 0, 'every completion stays silent');
  assert.equal(f.timers.size, 1);
  assert.equal([...f.timers.values()][0].ms, HOUR_MS);
  f.controller.start();
  assert.equal(f.requests.length, 6, 'repeated initialization never refreshes');
});

test('destroy aborts requests, clears scheduling and ignores late responses', async t => {
  const f = await fixture(t, ['1']);
  f.controller.start();
  f.controller.destroy();
  assert.equal(f.requests[0].options.signal.aborted, true);
  f.requests[0].succeed(99);
  await flush();
  assert.equal(f.controller.get('1'), undefined);
  assert.equal(f.completions.length, 0);
  assert.equal(f.timers.size, 0);
  f.controller.start();
  f.controller.refreshCity(city('2'));
  assert.equal(f.requests.length, 1);
});

test('failed updates retain the previous value and partial failures stay silent', async t => {
  const f = await fixture(t, ['1', '2']);
  f.controller.start();
  f.requests[0].succeed(12, '小雨');
  f.requests[1].succeed(15);
  await flush();
  await f.automaticRefresh();
  f.requests[2].fail();
  f.requests[3].succeed(16);
  await flush();
  assert.equal(f.controller.get('1').data.temperature, 12);
  assert.equal(f.controller.get('1').data.condition, '小雨');
  assert.equal(f.controller.get('1').failed, true);
  assert.equal(f.controller.get('1').loading, false);
  assert.equal(f.controller.get('2').failed, false);
  assert.equal(f.completions.length, 0);
});

test('total failure stays silent and waits until the next whole hour', async t => {
  const f = await fixture(t, ['1']);
  f.controller.start();
  f.requests[0].fail();
  await flush();
  assert.equal(f.controller.get('1').data, undefined);
  assert.equal(f.controller.get('1').failed, true);
  assert.equal(f.completions.length, 0);
  assert.equal(f.requests.length, 1);
  await f.automaticRefresh();
  f.requests[1].succeed(18);
  await flush();
  assert.equal(f.controller.get('1').failed, false);
  assert.equal(f.completions.length, 0);
});

test('a batch crossing an hour never overlaps another batch or duplicates queued cities', async t => {
  const f = await fixture(t, ['1', '2', '3'], START + 22 * 60000 + 14000);
  f.controller.start();
  assert.equal([...f.timers.values()][0].ms, 1000);
  await f.automaticRefresh();
  assert.equal(f.requests.length, 2);
  f.requests[0].succeed(1);
  f.requests[1].succeed(2);
  await flush();
  assert.equal(f.requests.length, 3, 'the queued city is requested only once');
  f.requests[2].succeed(3);
  await flush();
  await f.automaticRefresh();
  assert.equal(f.requests.length, 5);
});

test('a delayed timer refreshes once and realigns to the next whole hour', async t => {
  const f = await fixture(t, ['1']);
  f.controller.start();
  f.requests[0].succeed(1);
  await flush();
  await f.automaticRefresh(2 * HOUR_MS + 5 * 60000);
  assert.equal(f.requests.length, 2);
  assert.equal([...f.timers.values()][0].ms, 55 * 60000);
});

test('starting exactly on the hour refreshes only once before the next hour', async t => {
  const f = await fixture(t, ['1'], START - START % HOUR_MS);
  f.controller.start();
  assert.equal(f.requests.length, 1);
  assert.equal([...f.timers.values()][0].ms, HOUR_MS);
});

test('added cities refresh independently and removed queued cities are not requested', async t => {
  const f = await fixture(t);
  f.controller.start();
  f.setCities(['1', '2', '4']);
  f.controller.refreshCity(city('4'));
  f.controller.refreshCity(city('4'));
  assert.equal(f.requests.length, 3, 'concurrent requests for the same added city share work');
  f.requests.forEach(request => request.succeed(18));
  await flush();
  assert.equal(f.requests.length, 3, 'removed queued city was skipped');
  assert.equal(f.completions.length, 0);
  assert.equal(f.controller.get('4').data.temperature, 18);
});
