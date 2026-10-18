'use strict';

const { readAdminFragmentHtml } = require('../helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { readCssBundle } = require('../helpers/css-bundle');
const { createPlaybackApp, flushAsyncWork, track } = require('../helpers/playback-app');

const ROOT_DIR = path.resolve(__dirname, '../..');

function read(...parts) {
  return fs.readFileSync(path.join(ROOT_DIR, ...parts), 'utf8');
}

test('playback page offers a dedicated WeSing source and cache capture workspace', () => {
  const html = readAdminFragmentHtml('pages/admin/playback/page.html');
  const headerStyles = read('public', 'css', 'playback', 'header.css');
  const panelStyles = readCssBundle('public', 'css', 'playback', 'panels.css');

  assert.match(html, /data-source="wesing"[\s\S]*全民 K歌/);
  assert.match(html, /data-source="wesing"[\s\S]*src="\/img\/playback\/wesing-icon\.png"/);
  assert.match(html, /id="playbackWeSingView"/);
  assert.match(html, /id="weSingCachePath"/);
  assert.match(html, /id="weSingSelectCacheBtn"/);
  assert.match(html, /id="weSingSaveCacheBtn"/);
  assert.match(html, /id="weSingLyricOffsetMs"[^>]*min="-3000"[^>]*max="3000"[^>]*step="50"/);
  assert.match(html, /id="weSingLyricOffsetMsNumber"[^>]*min="-3000"[^>]*max="3000"[^>]*step="50"/);
  assert.match(html, /id="weSingResetLyricOffsetBtn"/);
  assert.match(html, /id="weSingRefreshBtn"/);
  assert.match(html, /id="weSingLyricLine"/);
  assert.match(html, /data-online-source-view/);
  assert.match(headerStyles, /source-tab\[data-source=['"]wesing['"]\]/);
  assert.match(panelStyles, /\.playback-wesing-panel/);
  assert.match(panelStyles, /--wesing-word-progress/);
});

test('WeSing browser client renders lyrics through the shared text renderer', () => {
  const source = read('public', 'js', 'playback', 'services', 'wesing-service.js');

  assert.match(source, /new LyricWordRenderer/);
  assert.match(source, /textContent\s*=/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
});

test('WeSing browser client selects its preference, saves settings and follows only its own live state', async () => {
  const listeners = new Map();
  const windowListeners = new Map();
  let observedSurface;
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
        observe(element) { observedSurface = element; }
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
  assert.equal(observedSurface, elements.get('playbackWeSingView'),
    'visibility covers the progress bar and current time as well as the lyric line');
  assert.equal(service.getProviderHealth().ok, true, 'late initialization uses the current app snapshot');
  assert.equal(elements.get('weSingTrackTitle').textContent, '缓存歌曲');

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

test('WeSing pushes only refresh the active provider when its health changes', async () => {
  const app = await createPlaybackApp({
    current: track('song', '歌曲'), selectedSource: 'qq', mode: 'sequence', volume: 0.75,
  }, { sourceTabs: ['qq', 'wesing'] });
  await app.init();
  await flushAsyncWork();
  const title = app.element('playbackTrackTitle');
  let titleText = title.textContent;
  let playerRenders = 0;
  Object.defineProperty(title, 'textContent', {
    get: () => titleText,
    set(value) { playerRenders++; titleText = value; },
  });
  await app.emitWindow('app:wesing-state', { detail: {
    platformDetected: true, cacheReady: true, status: 'ready', message: '已就绪',
  } });
  assert.equal(playerRenders, 0, 'an inactive provider must not redraw the online player');

  await app.emit('source-tab-wesing', 'click');
  await flushAsyncWork();
  assert.equal(app.element('playbackSourceStatus').textContent, '已检测到全民 K歌');
  playerRenders = 0;
  for (let index = 0; index < 20; index++) {
    await app.emitWindow('app:wesing-state', { detail: {
      playing: true, currentMs: index * 100, lyricState: { lineText: `歌词 ${index}`, currentMs: index * 100 },
    } });
  }
  assert.equal(playerRenders, 0, 'progress and lyrics update the WeSing view without redrawing the player');
  await app.emitWindow('app:wesing-state', { detail: {
    platformDetected: false, status: 'inactive', message: '等待检测',
  } });
  assert.equal(playerRenders, 1);
  assert.equal(app.element('playbackSourceStatus').textContent, '全民 K歌等待检测');
  assert.equal(app.element('playbackProviderHealth').textContent, '等待检测');
  assert.equal(app.resolveStreamRequestCount(), 0, 'status pushes do not request song quality or stream URLs');
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

test('WeSing cache path preserves unsaved edits and explains how to recover missing detection', async () => {
  const listeners = new Map();
  const input = { value: '', addEventListener: (type, callback) => listeners.set(type, callback) };
  const hint = { hidden: false };
  const cacheStatus = { textContent: '' };
  const document = {
    activeElement: null,
    getElementById: (id) => ({ weSingCachePath: input, weSingCacheHint: hint, weSingCacheStatus: cacheStatus }[id] || null),
  };
  const { WeSingService } = await loadModuleExports(
    path.join(ROOT_DIR, 'public/js/playback/services/wesing-service.js'),
    { document, window: { addEventListener() {} }, performance: { now: () => 0 } },
  );
  const service = new WeSingService();
  service.init({ cachePath: 'C:\\WeSingCache', cacheReady: false });
  assert.equal(hint.hidden, false);
  assert.equal(cacheStatus.textContent, '未找到');
  input.value = 'E:\\WeSingCache';
  listeners.get('input')();
  service.applyStatus({ cachePath: 'D:\\WeSingCache', cacheReady: true });
  assert.equal(input.value, 'E:\\WeSingCache', 'live detection must not replace an unsaved edit after blur');
  assert.equal(hint.hidden, true);

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

test('Electron exposes a directory-only WeSing cache picker', () => {
  const main = [read('src', 'electron', 'main.js'), read('src', 'electron', 'ipc', 'music-ipc.js')].join('\n');
  const preload = read('src', 'electron', 'preload.js');

  assert.match(main, /music:select-wesing-cache/);
  assert.match(main, /properties:\s*\['openDirectory'\]/);
  assert.match(preload, /selectWeSingCacheDirectory:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('music:select-wesing-cache'\)/);
});
