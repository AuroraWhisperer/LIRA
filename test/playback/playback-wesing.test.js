'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { createPlaybackApp, flushAsyncWork, track } = require('../helpers/playback-app');

const ROOT_DIR = path.resolve(__dirname, '../..');

function read(...parts) {
  return fs.readFileSync(path.join(ROOT_DIR, ...parts), 'utf8');
}

test('WeSing browser client never writes lyric text as HTML', () => {
  assert.doesNotMatch(read('public', 'js', 'playback', 'services', 'wesing-service.js'), /innerHTML\s*=/);
});

test('WeSing browser client selects its preference, saves settings and follows only its own live state', async () => {
  const listeners = new Map();
  const windowListeners = new Map();
  const requests = [];
  const element = (id) => ({
    id,
    value: '',
    textContent: '',
    className: '',
    style: { setProperty() {} },
    classList: { toggle() {} },
    addEventListener: (type, handler) => listeners.set(`${id}:${type}`, handler),
    replaceChildren() {},
    appendChild() {},
  });
  const elements = new Map();
  const document = {
    activeElement: null,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element(id));
      return elements.get(id);
    },
    createElement: () => element('created'),
  };
  const window = {
    __API_TOKEN__: 'test-token',
    addEventListener: (type, handler) => windowListeners.set(type, handler),
    musicAPI: { selectWeSingCacheDirectory: async () => ({ canceled: false, path: 'D:\\Synthetic\\WeSingCache' }) },
  };
  const { WeSingService } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'services', 'wesing-service.js'),
    {
      document,
      window,
      performance: { now: () => 0 },
      IntersectionObserver: class {
        observe() {}
        disconnect() {}
      },
      requestAnimationFrame: () => 0,
      cancelAnimationFrame() {},
      fetch: async (url, options) => {
        requests.push({ url, authorization: options.headers.Authorization, body: JSON.parse(options.body) });
        return { ok: true, json: async () => ({ ok: true, data: { lyricOffsetMs: 0 } }) };
      },
    },
  );
  const service = new WeSingService();
  service.init({ cacheReady: true, platformDetected: true, trackTitle: '缓存歌曲' });
  assert.equal(service.getProviderHealth().ok, true, 'late initialization uses the current app snapshot');

  await service.setSelected(true);
  await listeners.get('weSingResetLyricOffsetBtn:click')();
  await listeners.get('weSingSelectCacheBtn:click')();
  await new Promise(setImmediate);
  assert.deepEqual(
    requests.map(({ url, body }) => [url, body]),
    [
      ['/api/music/wesing/active', { active: true }],
      ['/api/music/wesing/offset', { offsetMs: 0 }],
      ['/api/music/wesing/configure', { cachePath: 'D:\\Synthetic\\WeSingCache' }],
    ],
  );
  assert.ok(requests.every((request) => request.authorization === 'Bearer test-token'));

  windowListeners.get('app:wesing-state')({ detail: { supported: true, cacheReady: true, platformDetected: true } });
  assert.equal(service.getProviderHealth().ok, true);
  assert.equal(service.getAuthState().loggedIn, true);

  assert.equal(windowListeners.has('app:lyric-state'), false, 'global lyric output can belong to another player');
  windowListeners.get('app:wesing-state')({ detail: { lyricState: { lineText: '全民歌词' } } });
  assert.equal(service.status.lyricState.lineText, '全民歌词');
});

test('WeSing status pushes do not request online streams', async () => {
  let fullscreenClosed = 0;
  const app = await createPlaybackApp({
    current: track('song', '歌曲'), selectedSource: 'qq', mode: 'sequence', volume: 0.75,
  }, { sourceTabs: ['qq', 'wesing'] });
  await app.init({ closeFullscreenPlayer: () => { fullscreenClosed++; } });
  await flushAsyncWork();
  await app.emitWindow('app:wesing-state', { detail: {
    platformDetected: true, cacheReady: true, status: 'ready', message: '已就绪',
  } });
  await app.emit('source-tab-wesing', 'click');
  await flushAsyncWork();
  await app.emitWindow('app:wesing-state', { detail: {
    playing: true, currentMs: 100, lyricState: { lineText: '歌词', currentMs: 100 },
  } });
  await app.emitWindow('app:wesing-state', { detail: {
    platformDetected: false, status: 'inactive', message: '等待检测',
  } });
  assert.equal(app.resolveStreamRequestCount(), 0, 'status pushes do not request song quality or stream URLs');
  assert.equal(fullscreenClosed, 1, 'switching to the external playback source closes the app fullscreen view');
});

test('fullscreen lyrics seek internal audio but cannot resume it after selecting WeSing', async () => {
  const current = { ...track('song', '歌曲'), lyrics: { lines: [{ startMs: 1000, text: '已有歌词' }] } };
  const app = await createPlaybackApp({ current, selectedSource: 'qq', mode: 'sequence', volume: 0.75 },
    { sourceTabs: ['qq', 'wesing'] });
  let fullscreenOpen = true;
  app.element('playerFullscreen').classList.contains = name => name === 'open' && fullscreenOpen;
  await app.init({ closeFullscreenPlayer: () => { fullscreenOpen = false; } });
  await flushAsyncWork();
  await app.emit('playbackPlayPause', 'click');
  await flushAsyncWork();
  const audio = app.element('music-player');
  const lyrics = app.element('playerFsLyrics');
  const clickLyric = () => {
    const lyricStartMs = /data-lyric-start-ms="([^"]+)"/.exec(lyrics.innerHTML)?.[1];
    assert.equal(lyricStartMs, '1000');
    return app.emit('playerFsLyrics', 'click', { target: { closest: () => ({ dataset: { lyricStartMs } }) } });
  };
  audio.pause();
  await clickLyric();
  await flushAsyncWork();
  assert.equal(audio.currentTime, 1);
  assert.equal(audio.paused, false, 'internal lyrics still seek and resume playback');

  audio.pause();
  const playCallsBeforeSwitch = app.audioPlayCalls();
  const pendingSeek = clickLyric();
  await app.emit('source-tab-wesing', 'click');
  await pendingSeek;
  await flushAsyncWork();
  assert.equal(app.audioPlayCalls(), playCallsBeforeSwitch, 'source changes cancel a resume awaiting output preparation');
  assert.equal(fullscreenOpen, false);
  fullscreenOpen = true;
  audio.currentTime = 7;
  await app.emit('music-player', 'timeupdate');
  const playCalls = app.audioPlayCalls();
  await clickLyric();
  await flushAsyncWork();
  assert.equal(audio.currentTime, 7, 'retained internal lyrics cannot seek external playback');
  assert.equal(app.audioPlayCalls(), playCalls);
  assert.equal(audio.paused, true);
});

test('playback state accepts WeSing as a persisted source', async () => {
  const { createInitialState, validateState } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'state', 'manager.js'),
  );
  assert.equal(validateState({ ...createInitialState(), selectedSource: 'wesing' }), true);
  assert.equal(validateState({ ...createInitialState(), selectedSource: 'unknown' }), false);
});

test('WeSing lyric-offset preview survives older live status while saving', async () => {
  const range = {
    value: '-1500',
    min: '-3000',
    max: '3000',
    style: { setProperty() {} },
  };
  const number = { value: '-1500' };
  const document = {
    activeElement: null,
    getElementById(id) {
      return { weSingLyricOffsetMs: range, weSingLyricOffsetMsNumber: number }[id] || null;
    },
  };
  const { WeSingService } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'services', 'wesing-service.js'),
    { document, window: {}, performance: { now: () => 0 } },
  );
  const service = new WeSingService();

  service.pendingLyricOffsetMs = 700;
  service.applyStatus({ lyricOffsetMs: -1500 });

  assert.equal(range.value, '700');
  assert.equal(number.value, '700');
});

for (const outcome of ['success', 'failure']) {
  test(`WeSing offset ${outcome} from an older save preserves the newer input`, async () => {
    const nodes = new Map();
    for (const id of ['weSingLyricOffsetMs', 'weSingLyricOffsetMsNumber']) {
      nodes.set(id, { value: '0', min: '-3000', max: '3000', style: { setProperty() {} },
        listeners: {}, addEventListener(type, handler) { this.listeners[type] = handler; } });
    }
    const { WeSingService } = await loadModuleExports(
      path.join(ROOT_DIR, 'public/js/playback/services/wesing-service.js'),
      { document: { activeElement: null, getElementById: id => nodes.get(id) || null },
        window: { addEventListener() {} }, performance: { now: () => 0 } },
    );
    const errors = [];
    const service = new WeSingService({ showError: error => errors.push(error) });
    const requests = [];
    service.request = (_url, { body }) => new Promise((resolve, reject) => requests.push({ ...body, resolve, reject }));
    service.init({ lyricOffsetMs: 0 });
    const number = nodes.get('weSingLyricOffsetMsNumber');
    number.value = '100';
    number.listeners.input();
    number.listeners.change();
    number.value = '700';
    number.listeners.input();
    if (outcome === 'success') requests[0].resolve({ lyricOffsetMs: 100 });
    else requests[0].reject(new Error('old save failed'));
    await new Promise(setImmediate);
    assert.equal(number.value, '700');
    assert.equal(service.pendingLyricOffsetMs, 700);
    assert.equal(errors.length, 0);
    number.listeners.change();
    assert.deepEqual(requests.map(request => request.offsetMs), [100, 700]);
    requests[1].resolve({ lyricOffsetMs: 700 });
    await new Promise(setImmediate);
    assert.equal(number.value, '700');
    assert.equal(service.pendingLyricOffsetMs, null);
    assert.equal(service.status.lyricOffsetMs, 700);
  });
}

test('WeSing cache path preserves unsaved edits', async () => {
  const listeners = new Map();
  const input = { value: '', addEventListener: (type, callback) => listeners.set(type, callback) };
  const document = {
    activeElement: null,
    getElementById: (id) => ({ weSingCachePath: input, weSingCacheHint: { hidden: false }, weSingCacheStatus: { textContent: '' } }[id] || null),
  };
  const { WeSingService } = await loadModuleExports(
    path.join(ROOT_DIR, 'public/js/playback/services/wesing-service.js'),
    { document, window: { addEventListener() {} }, performance: { now: () => 0 } },
  );
  const service = new WeSingService();
  service.init({ cachePath: 'C:\\WeSingCache', cacheReady: false });
  input.value = 'E:\\WeSingCache';
  listeners.get('input')();
  service.applyStatus({ cachePath: 'D:\\WeSingCache', cacheReady: true });
  assert.equal(input.value, 'E:\\WeSingCache', 'live detection must not replace an unsaved edit after blur');

  let finish;
  service.request = () => new Promise((resolve) => { finish = resolve; });
  const saving = service.saveCachePath();
  input.value = 'F:\\WeSingCache';
  listeners.get('input')();
  finish({ cachePath: 'E:\\WeSingCache', cacheReady: true });
  await saving;
  assert.equal(input.value, 'F:\\WeSingCache', 'a late save response preserves a newer edit');

  service.request = async () => ({ cachePath: 'F:\\WeSingCache', cacheReady: true });
  await service.saveCachePath();
  assert.equal(service.cachePathDraft, null);
  assert.equal(input.value, 'F:\\WeSingCache');
  service.applyStatus({ cachePath: 'G:\\WeSingCache' });
  assert.equal(input.value, 'G:\\WeSingCache', 'live status fills the input once the draft has been saved');
});
