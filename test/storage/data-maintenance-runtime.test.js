'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { runClearAll } = require('../../src/server/data-maintenance-runtime');

function fixture(result) {
  const calls = [];
  return {
    calls,
    ports: {
      pauseGifts() { calls.push('gifts:pause'); },
      pauseOvertime() { calls.push('overtime:pause'); },
      clearAll() { calls.push('data:clear'); return result; },
      clearMusicCache() { calls.push('music:clear-cache'); },
      resumeOvertime() { calls.push('overtime:resume'); },
      resumeGifts() { calls.push('gifts:resume'); },
      rebuildGiftProjection() { calls.push('gift-sync:rebuild'); return Promise.resolve(true); },
    },
  };
}

test('rolled-back exceptions resume acquired writers in consumer-first order', () => {
  const failure = new Error('Clear-all pre-commit failed: giftDb delete');
  const { ports, calls } = fixture();
  ports.clearAll = () => { throw failure; };
  assert.throws(() => runClearAll(ports), error => error === failure);
  assert.deepEqual(calls, ['gifts:pause', 'overtime:pause', 'overtime:resume', 'gifts:resume']);
});

for (const [name, giftProjectionReset, committed, rebuild] of [
  ['without a projection reset', undefined, ['songDb'], false],
  ['with a committed projection reset', { sourceId: 7, projectionGeneration: 2 }, ['songDb', 'giftDb'], true],
  ['with an uncommitted projection reset', { sourceId: 7, projectionGeneration: 2 }, ['songDb'], false],
]) {
  test(`partial commit keeps writers paused ${name}`, () => {
    const result = { partial: true, committed, failed: ['musicDb'], error: 'Commit failed',
      ...(giftProjectionReset ? { giftProjectionReset } : {}) };
    const { ports, calls } = fixture(result);
    assert.equal(runClearAll(ports), result);
    assert.deepEqual(calls, ['gifts:pause', 'overtime:pause', 'data:clear', 'music:clear-cache',
      ...(rebuild ? ['gift-sync:rebuild'] : [])]);
  });
}

for (const giftProjectionReset of [undefined, { sourceId: 7, projectionGeneration: 2 }]) {
  test(`successful clear resumes writers before optional rebuild (${Boolean(giftProjectionReset)})`, () => {
    const result = { cleared: true, scope: 'all', ...(giftProjectionReset ? { giftProjectionReset } : {}) };
    const { ports, calls } = fixture(result);
    assert.equal(runClearAll(ports), result, 'the complete operation returns synchronously');
    assert.deepEqual(calls, ['gifts:pause', 'overtime:pause', 'data:clear', 'music:clear-cache',
      'overtime:resume', 'gifts:resume', ...(giftProjectionReset ? ['gift-sync:rebuild'] : [])]);
  });
}

test('failed retries do not resume writers paused by a previous request', () => {
  const { ports, calls } = fixture();
  ports.pauseGifts = () => { calls.push('gifts:pause'); return false; };
  ports.pauseOvertime = () => { calls.push('overtime:pause'); return false; };
  ports.clearAll = () => { throw new Error('retry failed'); };
  assert.throws(() => runClearAll(ports), /retry failed/);
  assert.deepEqual(calls, ['gifts:pause', 'overtime:pause']);
});

test('failure while acquiring the second writer only resumes the first', () => {
  const { ports, calls } = fixture();
  ports.pauseOvertime = () => { calls.push('overtime:pause'); throw new Error('pause failed'); };
  assert.throws(() => runClearAll(ports), /pause failed/);
  assert.deepEqual(calls, ['gifts:pause', 'overtime:pause', 'gifts:resume']);
});

test('recovery failure re-pauses both writers and retains the original exception', () => {
  const { ports, calls } = fixture();
  const failure = new Error('clear failed');
  const resumeFailure = new Error('resume failed');
  ports.clearAll = () => { throw failure; };
  ports.resumeOvertime = () => { calls.push('overtime:resume'); throw resumeFailure; };
  assert.throws(() => runClearAll(ports), error => error === failure && error.cause === resumeFailure);
  assert.deepEqual(calls, ['gifts:pause', 'overtime:pause', 'overtime:resume', 'gifts:pause', 'overtime:pause']);
});

test('post-commit resume failure returns partial metadata and rebuilds the committed projection', () => {
  const original = { cleared: true, committed: ['songDb', 'giftDb'],
    giftProjectionReset: { sourceId: 7, projectionGeneration: 2 } };
  const { ports, calls } = fixture(original);
  ports.resumeGifts = () => { calls.push('gifts:resume'); throw new Error('resume failed'); };
  assert.deepEqual(runClearAll(ports), { ...original, ok: false, cleared: false, partial: true,
    phase: 'resume', failed: [], error: '数据已清空，但写入恢复失败：resume failed' });
  assert.deepEqual(calls, ['gifts:pause', 'overtime:pause', 'data:clear', 'music:clear-cache',
    'overtime:resume', 'gifts:resume', 'gifts:pause', 'overtime:pause', 'gift-sync:rebuild']);
});

test('cache and projection recovery failures do not replace the completed database result', async () => {
  for (const rebuild of [() => { throw new Error('sync rebuild failed'); },
    () => Promise.reject(new Error('async rebuild failed')), () => new Promise(() => {})]) {
    const result = { cleared: true, giftProjectionReset: { sourceId: 7, projectionGeneration: 2 } };
    const { ports } = fixture(result);
    ports.clearMusicCache = () => { throw new Error('cache failed'); };
    ports.rebuildGiftProjection = rebuild;
    assert.equal(runClearAll(ports), result);
  }
  await new Promise(resolve => setImmediate(resolve));
});
