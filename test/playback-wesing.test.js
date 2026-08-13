'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(...parts) {
  return fs.readFileSync(path.join(ROOT_DIR, ...parts), 'utf8');
}

test('playback page offers a dedicated WeSing source and cache capture workspace', () => {
  const html = read('public', 'pages', 'admin.html');
  const headerStyles = read('public', 'css', 'playback', 'header.css');
  const panelStyles = read('public', 'css', 'playback', 'panels.css');

  assert.match(html, /data-source="wesing"[\s\S]*全民 K歌/);
  assert.match(html, /id="playbackWeSingView"/);
  assert.match(html, /id="weSingCachePath"/);
  assert.match(html, /id="weSingSelectCacheBtn"/);
  assert.match(html, /id="weSingSaveCacheBtn"/);
  assert.match(html, /id="weSingLyricOffsetMs"[^>]*min="-1500"[^>]*max="1500"[^>]*step="50"/);
  assert.match(html, /id="weSingLyricOffsetMsNumber"[^>]*min="-1500"[^>]*max="1500"[^>]*step="50"/);
  assert.match(html, /id="weSingRefreshBtn"/);
  assert.match(html, /id="weSingLyricLine"/);
  assert.match(html, /data-online-source-view/);
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
  assert.match(source, /selectWeSingCacheDirectory/);
  assert.match(renderer, /requestAnimationFrame/);
  assert.match(source, /new LyricWordRenderer/);
  assert.match(source, /textContent\s*=/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
  assert.match(providerOps, /platform === 'wesing'/);
  assert.match(adminState, /payload\.type === 'wesing-state'/);
  assert.match(adminState, /app:lyric-state/);
});

test('Electron exposes a directory-only WeSing cache picker', () => {
  const main = read('src', 'electron', 'main.js');
  const preload = read('src', 'electron', 'preload.js');

  assert.match(main, /music:select-wesing-cache/);
  assert.match(main, /title:\s*'选择全民 K 歌 WeSingCache 目录'/);
  assert.match(main, /properties:\s*\['openDirectory'\]/);
  assert.match(preload, /selectWeSingCacheDirectory:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('music:select-wesing-cache'\)/);
});
