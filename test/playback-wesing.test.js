'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { readCssBundle } = require('./helpers/css-bundle');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(...parts) {
  return fs.readFileSync(path.join(ROOT_DIR, ...parts), 'utf8');
}

test('playback page offers a dedicated WeSing source and cache capture workspace', () => {
  const html = readAdminHtml();
  const headerStyles = read('public', 'css', 'playback', 'header.css');
  const panelStyles = readCssBundle('public', 'css', 'playback', 'panels.css');

  assert.match(html, /data-source="wesing"[\s\S]*全民 K歌/);
  assert.match(html, /data-source="wesing"[\s\S]*src="\/img\/playback\/wesing-icon\.jpg"/);
  assert.match(html, /id="playbackWeSingView"/);
  assert.match(html, /id="weSingCachePath"/);
  assert.match(html, /id="weSingSelectCacheBtn"/);
  assert.match(html, /id="weSingSaveCacheBtn"/);
  assert.match(html, /id="weSingLyricOffsetMs"[^>]*min="-3000"[^>]*max="3000"[^>]*step="50"/);
  assert.match(html, /id="weSingLyricOffsetMsNumber"[^>]*min="-3000"[^>]*max="3000"[^>]*step="50"/);
  assert.match(html, /id="weSingResetLyricOffsetBtn"[^>]*>重置<\/button>/);
  assert.doesNotMatch(html, /捕捉来源|仅读取本地日志和歌词缓存|负值延后歌词/);
  assert.match(html, /id="weSingRefreshBtn"/);
  assert.match(html, /id="weSingLyricLine"/);
  assert.match(html, /data-online-source-view/);
  assert.doesNotMatch(html, /SOURCE \/ LIVE|NOW SINGING|CONTROL DESK|从全民 K 歌客户端读取实时歌词|配置本地歌词缓存/);
  assert.match(html, />缓存目录<\/label>/);
  assert.match(html, />时间偏移<\/span>/);
  assert.match(html, />状态<\/div>/);
  assert.match(headerStyles, /source-tab\[data-source="wesing"\]/);
  assert.match(panelStyles, /\.playback-wesing-panel/);
  assert.match(panelStyles, /--wesing-word-progress/);
});

test('WeSing browser client activates capture and renders WebSocket lyrics safely', () => {
  const source = read('public', 'js', 'playback', 'services', 'wesing-service.js');
  const renderer = read('public', 'js', 'shared', 'lyric-word-renderer.js');
  const state = read('public', 'js', 'playback', 'state', 'manager.js');
  const providerOps = read('public', 'js', 'playback', 'operations', 'provider-operations.js');
  const adminState = read('public', 'js', 'admin', 'state.js');

  assert.match(state, /\['qq', 'netease', 'wesing'\]/);
  assert.match(source, /\/api\/music\/wesing\/active/);
  assert.match(source, /\/api\/music\/wesing\/configure/);
  assert.match(source, /\/api\/music\/wesing\/offset/);
  assert.match(source, /saveLyricOffset/);
  assert.match(source, /pendingLyricOffsetMs/);
  assert.match(source, /pendingLyricOffsetMs \?\? numberValue\(this\.status\.lyricOffsetMs, 0\)/);
  assert.match(source, /weSingResetLyricOffsetBtn/);
  assert.match(source, /selectWeSingCacheDirectory/);
  assert.match(renderer, /requestAnimationFrame/);
  assert.match(source, /new LyricWordRenderer/);
  assert.match(source, /textContent\s*=/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
  assert.match(source, /status\.trackTitle \|\| '等待播放'/);
  assert.match(source, /\? '同步中'/);
  assert.match(providerOps, /platform === 'wesing'/);
  assert.match(adminState, /payload\.type === 'wesing-state'/);
  assert.match(adminState, /app:lyric-state/);
});

test('WeSing lyric-offset preview survives older live status while saving', async () => {
  const range = { value: '-1500', min: '-3000', max: '3000', style: { setProperty() {} } };
  const number = { value: '-1500' };
  const document = {
    activeElement: null,
    getElementById(id) {
      return { weSingLyricOffsetMs: range, weSingLyricOffsetMsNumber: number }[id] || null;
    }
  };
  const { WeSingService } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'services', 'wesing-service.js'),
    { document, window: {}, performance: { now: () => 0 } }
  );
  const service = new WeSingService();

  service.pendingLyricOffsetMs = 700;
  service.applyStatus({ lyricOffsetMs: -1500 });

  assert.equal(range.value, '700');
  assert.equal(number.value, '700');
});

test('Electron exposes a directory-only WeSing cache picker', () => {
  const main = [
    read('src', 'electron', 'main.js'),
    read('src', 'electron', 'ipc', 'music-ipc.js')
  ].join('\n');
  const preload = read('src', 'electron', 'preload.js');

  assert.match(main, /music:select-wesing-cache/);
  assert.match(main, /title:\s*'选择全民 K 歌 WeSingCache 目录'/);
  assert.match(main, /properties:\s*\['openDirectory'\]/);
  assert.match(preload, /selectWeSingCacheDirectory:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('music:select-wesing-cache'\)/);
});

async function loadModuleExports(entryPath, globals = {}) {
  const context = vm.createContext({ console, window: {}, ...globals });
  const modules = new Map();

  async function load(filePath) {
    const identifier = pathToFileURL(filePath).href;
    if (modules.has(identifier)) return modules.get(identifier);
    const module = new vm.SourceTextModule(fs.readFileSync(filePath, 'utf8'), {
      context,
      identifier
    });
    modules.set(identifier, module);
    await module.link((specifier, referencingModule) => {
      return load(fileURLToPath(new URL(specifier, referencingModule.identifier)));
    });
    return module;
  }

  const module = await load(entryPath);
  await module.evaluate();
  return module.namespace;
}
