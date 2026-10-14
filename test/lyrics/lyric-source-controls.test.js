'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const tick = () => new Promise(setImmediate);
const sourceState = (source, selection = 'auto') => ({
  source, selection,
  qqClient: { supported: true, message: 'QQ 等待播放', artists: [] },
  neteaseClient: { supported: true, message: '网易云等待播放', artists: [] },
});

async function controlsFixture(api, initial = sourceState('internal')) {
  const window = new EventTarget();
  const inputs = ['auto', 'internal', 'qq-client', 'netease-client', 'wesing'].map((value) => ({ name: 'desktopLyricSource', value }));
  const listeners = new Map();
  const elements = new Map();
  for (const id of ['SourceControls', 'SourceStatus', 'SourceTrack', 'SourceRetry', 'QQStatus', 'NetEaseStatus', 'NetEaseRetry']) elements.set(`desktopLyric${id}`, {
    querySelectorAll: () => inputs,
    addEventListener(type, fn) { listeners.set(`${id}:${type}`, [...(listeners.get(`${id}:${type}`) || []), fn]); },
  });
  const { createLyricSourceControls } = await loadModuleExports(path.resolve('public/js/admin/lyric-source-controls.js'), {
    window, CustomEvent, document: { getElementById: (id) => elements.get(id) },
  });
  const controls = createLyricSourceControls({ api, state: { getAppState: () => ({ lyricSource: initial }) } });
  controls.init(); controls.init();
  return { window, inputs, elements, listeners, controls,
    async change(value) {
      const target = inputs.find((input) => input.value === value);
      target.checked = true;
      let stopped = false;
      for (const listener of listeners.get('SourceControls:change')) listener({ target, stopPropagation() { stopped = true; } });
      assert.equal(stopped, true, 'source selection must not trigger the style autosave handler');
      await tick();
    },
  };
}

test('source controls bind once and preserve newer WS state over a delayed HTTP reply', async () => {
  const pending = Promise.withResolvers();
  const requests = [];
  const f = await controlsFixture((...args) => { requests.push(args); return pending.promise; });
  await f.change('qq-client');
  assert.equal(requests.length, 1);
  assert.equal(f.elements.get('desktopLyricSourceControls').disabled, true);
  f.window.dispatchEvent(new CustomEvent('app:lyric-source', { detail: sourceState('netease-client', 'wesing') }));
  pending.resolve({ data: sourceState('qq-client', 'qq-client') }); await tick();
  assert.equal(f.inputs.find((input) => input.checked).value, 'wesing');
  assert.equal(f.elements.get('desktopLyricSourceStatus').textContent, '当前跟随：外部网易云音乐');
  assert.equal(f.elements.get('desktopLyricSourceControls').disabled, false);
});

test('failed selection restores the preference and unsupported clients stay disabled', async () => {
  const initial = sourceState('internal');
  initial.qqClient.supported = false;
  initial.neteaseClient.supported = false;
  const f = await controlsFixture(async () => { throw new Error('Request failed'); }, initial);
  assert.equal(f.inputs.find((input) => input.value === 'qq-client').disabled, true);
  assert.equal(f.inputs.find((input) => input.value === 'netease-client').disabled, true);
  assert.equal(f.elements.get('desktopLyricSourceRetry').disabled, true);
  assert.equal(f.elements.get('desktopLyricNetEaseRetry').disabled, true);
  await f.change('wesing');
  assert.equal(f.inputs.find((input) => input.checked).value, 'auto');
  assert.equal(f.elements.get('desktopLyricSourceStatus').textContent, 'Request failed');
});

test('external status and retry remain available while another source is preferred', async () => {
  const initial = sourceState('netease-client', 'qq-client');
  initial.neteaseClient = { ...initial.neteaseClient, trackTitle: '<歌曲>', artists: ['歌手'], lyricSource: 'netease' };
  const requests = [];
  const f = await controlsFixture(async (...args) => { requests.push(args); return { data: initial }; }, initial);
  assert.equal(f.inputs.find((input) => input.checked).value, 'qq-client');
  assert.equal(f.elements.get('desktopLyricSourceTrack').textContent, '<歌曲> · 歌手 · 歌词：网易云音乐');
  assert.equal(f.elements.get('desktopLyricQQStatus').textContent, 'QQ 音乐：QQ 等待播放');
  assert.equal(f.elements.get('desktopLyricNetEaseStatus').textContent, '网易云音乐：网易云等待播放');
  for (const id of ['SourceRetry', 'NetEaseRetry']) {
    assert.equal(f.listeners.get(`${id}:click`).length, 1);
    f.listeners.get(`${id}:click`)[0]();
    await tick();
  }
  assert.deepEqual(requests.map(([url, body]) => [url, { ...body }]), [
    ['/api/playback/lyric-source/refresh', { source: 'qq-client' }],
    ['/api/playback/lyric-source/refresh', { source: 'netease-client' }],
  ]);
});

test('preference changes preserve newer requests and realtime status over delayed errors', async () => {
  const requests = [];
  const f = await controlsFixture(() => { const request = Promise.withResolvers(); requests.push(request); return request.promise; });
  await f.change('qq-client');
  await f.change('auto');
  requests[0].resolve({ data: sourceState('qq-client', 'qq-client') });
  await tick();
  assert.equal(f.elements.get('desktopLyricSourceControls').disabled, true);
  f.window.dispatchEvent(new CustomEvent('app:lyric-source', { detail: sourceState('netease-client') }));
  requests[1].reject(new Error('Late failure'));
  await tick();
  assert.equal(f.inputs.find((input) => input.checked).value, 'auto');
  assert.equal(f.elements.get('desktopLyricSourceStatus').textContent, '当前跟随：外部网易云音乐');
  assert.equal(f.elements.get('desktopLyricSourceControls').disabled, false);
});
