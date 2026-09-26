'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');

for (const phase of ['timeline', 'state-body']) {
  test(`a stalled lyric ${phase} request expires and later updates recover`, async () => {
    const deadlines = [];
    const requests = [];
    const states = [];
    let stalled = false;
    let stalledSignal;
    const { LyricService } = await loadModuleExports(
      path.resolve(__dirname, '../public/js/playback/services/lyric-service.js'),
      {
        AbortSignal: {
          timeout(ms) {
            assert.equal(ms, 10000);
            const controller = new AbortController();
            deadlines.push(controller);
            return controller.signal;
          },
        },
        fetch: async (url, options) => {
          requests.push(url);
          const body = JSON.parse(options.body);
          if (url.endsWith('/lyric-state')) states.push(body);
          const target = phase === 'timeline' ? '/lyric-timeline' : '/lyric-state';
          if (!stalled && url.endsWith(target)) {
            stalled = true;
            stalledSignal = options.signal;
            const pending = new Promise((resolve, reject) => {
              options.signal?.addEventListener('abort', () => reject(options.signal.reason), { once: true });
            });
            return phase === 'state-body' ? { ok: true, json: () => pending } : pending;
          }
          return { ok: true, json: async () => ({ ok: true, data: body }) };
        },
      },
    );
    const service = new LyricService();
    const track = { id: 'synthetic', source: 'qq', title: 'Synthetic' };
    const audio = { currentTime: 1, duration: 120, paused: false };
    const first = service.syncWindow(track, audio, true);
    await new Promise(setImmediate);
    assert.ok(stalledSignal instanceof AbortSignal, 'the complete request needs a deadline');
    const updates = Array.from({ length: phase === 'state-body' ? 500 : 1 }, (_, index) =>
      service.syncWindow(track, { ...audio, currentTime: phase === 'state-body' ? (index + 1) / 25 : 20 }, true),
    );
    assert.ok(service.forcedStateQueue.length <= 64, 'stalled publication must retain bounded pending state snapshots');
    deadlines.find((entry) => entry.signal === stalledSignal).abort(new Error('synthetic request timeout'));
    await first;
    await Promise.all(updates);
    assert.equal(states.at(-1).currentMs, 20000);
    assert.equal(states.at(-1).generation, service.stateGeneration);
    assert.equal(service.lastAcceptedVersion.generation, service.stateGeneration);
    assert.ok(requests.some((url) => url.endsWith('/lyric-state')));
    assert.equal(service.timelinePublishInFlight, null);
    assert.equal(service.statePublishInFlight, null);
    assert.equal(service.forcedStateQueue.length, 0);
  });
}
