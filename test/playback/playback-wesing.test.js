'use strict';

const { readAdminFragmentHtml } = require('../helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { readCssBundle } = require('../helpers/css-bundle');

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

test('WeSing browser client activates capture, saves settings and follows live state events', async () => {
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
      requestAnimationFrame: () => 0,
      cancelAnimationFrame() {},
      fetch: async (url, options) => {
        requests.push({ url, authorization: options.headers.Authorization, body: JSON.parse(options.body) });
        return { ok: true, json: async () => ({ ok: true, data: { lyricOffsetMs: 0 } }) };
      },
    },
  );
  const playbackState = { selectedSource: 'qq' };
  const service = new WeSingService({ playbackState });
  service.init();

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

  windowListeners.get('app:lyric-state')({ detail: { lineText: '其他音源' } });
  assert.equal(service.status.lyricState.lineText, '', 'lyrics from another selected source are ignored');
  playbackState.selectedSource = 'wesing';
  windowListeners.get('app:lyric-state')({ detail: { lineText: '全民歌词' } });
  assert.equal(service.status.lyricState.lineText, '全民歌词');
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

test('Electron exposes a directory-only WeSing cache picker', () => {
  const main = [read('src', 'electron', 'main.js'), read('src', 'electron', 'ipc', 'music-ipc.js')].join('\n');
  const preload = read('src', 'electron', 'preload.js');

  assert.match(main, /music:select-wesing-cache/);
  assert.match(main, /properties:\s*\['openDirectory'\]/);
  assert.match(preload, /selectWeSingCacheDirectory:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('music:select-wesing-cache'\)/);
});
