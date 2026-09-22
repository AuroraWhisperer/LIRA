'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');
const { buildMusicRuntime } = require('../src/server/music-runtime');
const { routes } = require('../src/server/routes/playback-routes');

const track = {
  id: 'fixture',
  source: 'local',
  title: 'Fixture',
  artists: [],
  lyrics: {
    lines: [
      { startMs: 0, text: '第一句' },
      { startMs: 40000, text: '跳转后' },
    ],
  },
};
const audioAt = (seconds, paused = false) => ({ currentTime: seconds, duration: 120, paused });

async function fixture(t, intercept = async () => null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-lyric-recovery-'));
  const broadcasts = [];
  const runtime = buildMusicRuntime({
    dataDir: { apiCacheDir: path.join(dir, 'api'), lyricCacheDir: path.join(dir, 'lyrics') },
    runtimeOptions: { weSingPlatform: 'linux' },
    settingsStore: { getSettings: () => ({ weSingCachePath: '', weSingLyricOffsetMs: '0' }) },
    webSocketHub: { broadcast: (message) => broadcasts.push(message) },
  });
  t.after(() => {
    runtime.weSingCapture.stop();
    assert.equal(path.dirname(fs.realpathSync(dir)), fs.realpathSync(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const context = {
    playbackLyrics: { publish: runtime.publishLyricState, publishTimeline: runtime.publishLyricTimeline },
  };
  let now = 10000;
  const requests = [];
  const { LyricService } = await loadModuleExports(
    path.resolve(__dirname, '../public/js/playback/services/lyric-service.js'),
    {
      Date: class extends Date {
        static now() {
          return now;
        }
      },
      fetch: async (url, options) => {
        const body = JSON.parse(options.body);
        if (url.endsWith('/lyric-state')) {
          requests.push(body);
          const override = await intercept(body, runtime, requests.length);
          if (override) return override;
        }
        let status;
        let responseBody;
        await routes[`POST ${url}`](
          context,
          { body: async () => body },
          {
            writeHead(value) {
              status = value;
            },
            end(value) {
              responseBody = value;
            },
          },
        );
        return new Response(responseBody, { status });
      },
    },
  );
  return {
    runtime,
    broadcasts,
    requests,
    create: () => new LyricService(),
    tick: () => {
      now += 1000;
    },
  };
}

test('rebuilt sender recovers the same track immediately and ordinary ticks keep advancing', async (t) => {
  const f = await fixture(t);
  const old = f.create();
  for (let index = 0; index < 3; index += 1) {
    f.tick();
    await old.syncWindow(track, audioAt(0), true);
  }
  const rebuilt = f.create();
  f.tick();
  await rebuilt.syncWindow(track, audioAt(20), true);
  assert.equal(f.runtime.getLyricState().currentMs, 20000);
  f.tick();
  await rebuilt.syncWindow(track, audioAt(30));
  const state = f.runtime.getLyricState();
  assert.equal(state.currentMs, 30000);
  assert.equal(Object.hasOwn(state, 'nextGeneration'), false);
  const count = f.broadcasts.length;
  const rejected = f.runtime.publishLyricState({ generation: 1, sequence: 1, currentMs: 0 });
  assert.equal(f.runtime.getLyricState(), state);
  assert.equal(rejected.nextGeneration, state.generation + 1);
  assert.equal(f.broadcasts.length, count, 'old packets must not be broadcast');
});

test('recovery uses the timeline fence even before that generation has any accepted state', async (t) => {
  const f = await fixture(t);
  for (let index = 0; index < 7; index += 1) {
    f.runtime.publishLyricTimeline({ trackTitle: String(index), lines: [], status: 'empty' });
  }
  assert.equal(f.runtime.getLyricState().generation, 0);
  await f.create().syncWindow(track, audioAt(15), true);
  assert.equal(f.runtime.getLyricState().currentMs, 15000);
  assert.ok(f.runtime.getLyricState().generation > 7);
  assert.equal(f.requests.length, 2);
});

test('recovery preserves forced ordering and never revives older pending progress after seek', async (t) => {
  let release;
  const f = await fixture(t, async (_body, _runtime, count) => {
    if (count === 1)
      await new Promise((resolve) => {
        release = resolve;
      });
  });
  f.runtime.publishLyricState({ generation: 8, sequence: 1 });
  const service = f.create();
  const first = service.syncWindow(track, audioAt(1), true);
  await new Promise((resolve) => setImmediate(resolve));
  const pending = service.syncWindow(track, audioAt(2));
  const forced = service.syncWindow(track, audioAt(42, true), true);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await Promise.all([first, pending, forced]);
  assert.equal(f.runtime.getLyricState().currentMs, 42000);
  assert.equal(f.runtime.getLyricState().playing, false);
  assert.equal(f.runtime.getLyricState().lineText, '跳转后');
  assert.deepEqual(
    f.requests.map((request) => request.currentMs),
    [1000, 1000, 42000],
  );
  assert.ok(f.requests[2].generation > f.requests[1].generation);
});

test('continuous version conflicts retry at most once per publication', async (t) => {
  const f = await fixture(t, async (body, runtime) => {
    runtime.publishLyricState({ generation: body.generation + 5, sequence: 1 });
  });
  const service = f.create();
  await service.syncWindow(track, audioAt(1), true);
  assert.equal(f.requests.length, 2);
  assert.equal(service.lastPublishedState, '');
  assert.equal(service.statePublishInFlight, null);
});

test('same-generation sequence conflict recovers and legacy producers remain supported', async (t) => {
  const f = await fixture(t);
  f.runtime.publishLyricTimeline({
    trackTitle: track.title,
    artists: [],
    status: 'ready',
    lines: track.lyrics.lines,
  });
  f.runtime.publishLyricState({ generation: 1, sequence: 100, currentMs: 0 });
  await f.create().syncWindow(track, audioAt(15), true);
  const state = f.runtime.getLyricState();
  assert.equal(state.currentMs, 15000);
  assert.equal(state.generation, 2);
  assert.equal(f.requests.length, 2);
  const legacy = f.runtime.publishLyricState({ currentMs: 16000 });
  assert.equal(legacy.currentMs, 16000);
  assert.equal(legacy.generation, state.generation);
  assert.equal(legacy.sequence, state.sequence + 1);
  assert.equal(Object.hasOwn(legacy, 'nextGeneration'), false);
});

for (const failure of ['http', 'body', 'json', 'acknowledgement']) {
  test(`${failure} failure is not cached as a successful lyric publication`, async (t) => {
    const f = await fixture(t, async (_body, _runtime, count) => {
      if (count !== 1) return null;
      if (failure === 'json') return new Response('invalid JSON');
      if (failure === 'acknowledgement') return Response.json({ ok: true, data: {} });
      return Response.json({ ok: false }, { status: failure === 'http' ? 503 : 200 });
    });
    const service = f.create();
    await service.syncWindow(track, audioAt(1), true);
    assert.equal(service.lastPublishedState, '');
    f.tick();
    await service.syncWindow(track, audioAt(2), true);
    assert.equal(f.runtime.getLyricState().currentMs, 2000);
    assert.notEqual(service.lastPublishedState, '');
  });
}
