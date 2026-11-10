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
  const inputs = ['auto', 'qq-client', 'netease-client'].map((value) => ({ name: 'desktopLyricSource', value }));
  const groups = ['internal', 'external', 'wesing'].map((value) => ({ name: 'desktopLyricSourceGroup', value }));
  const listeners = new Map();
  const elements = new Map();
  for (const id of ['SourceControls', 'SourceStatus', 'FollowStatus', 'SourceTrack', 'SourceRetry', 'QQStatus', 'NetEaseStatus', 'NetEaseRetry', 'ExternalControls', 'WeSingSettings']) elements.set(`desktopLyric${id}`, {
    querySelectorAll: (selector) => selector === 'input[name="desktopLyricSourceGroup"]' ? groups : inputs,
    addEventListener(type, fn) { listeners.set(`${id}:${type}`, [...(listeners.get(`${id}:${type}`) || []), fn]); },
  });
  const { createLyricSourceControls } = await loadModuleExports(path.resolve('public/js/admin/lyric-source-controls.js'), {
    window, CustomEvent, document: { getElementById: (id) => elements.get(id) },
  });
  const controls = createLyricSourceControls({ api, state: { getAppState: () => ({ lyricSource: initial }) } });
  controls.init(); controls.init();
  return { window, inputs, groups, elements, listeners, controls,
    async change(value) {
      const target = [...inputs, ...groups].find((input) => input.value === value);
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
  f.window.dispatchEvent(new CustomEvent('app:lyric-source', { detail: sourceState('netease-client', 'wesing') }));
  pending.resolve({ data: sourceState('qq-client', 'qq-client') }); await tick();
  assert.equal(f.groups.find((input) => input.checked).value, 'wesing');
});

test('failed selection restores the preference', async () => {
  const f = await controlsFixture(async () => { throw new Error('Request failed'); });
  await f.change('wesing');
  assert.equal(f.inputs.find((input) => input.checked).value, 'auto');
  assert.equal(f.groups.find((input) => input.checked).value, 'external');
  assert.equal(f.elements.get('desktopLyricSourceStatus').hidden, false);
  assert.equal(f.elements.get('desktopLyricFollowStatus').hidden, false);
});

test('categories retain the last external preference', async () => {
  const requests = [];
  const f = await controlsFixture(async (url, { source }) => {
    requests.push([url, source]);
    return { data: sourceState('internal', source) };
  }, sourceState('internal', 'internal'));
  for (const value of ['external', 'qq-client', 'netease-client', 'wesing', 'internal', 'external']) await f.change(value);
  assert.equal(f.inputs.find((input) => input.checked).value, 'netease-client');
  assert.deepEqual(requests, ['auto', 'qq-client', 'netease-client', 'wesing', 'internal', 'netease-client']
    .map((source) => ['/api/playback/lyric-source', source]));
});

test('source controls stay disabled until the source preference is loaded', async () => {
  const f = await controlsFixture(async () => {}, null);
  assert.equal(f.elements.get('desktopLyricSourceControls').disabled, true);
  assert.equal(f.groups.some((input) => input.checked), false);
  assert.equal(f.elements.get('desktopLyricSourceStatus').hidden, false);
  f.window.dispatchEvent(new CustomEvent('app:lyric-source', { detail: sourceState('wesing', 'qq-client') }));
  assert.equal(f.groups.find((input) => input.checked).value, 'external');
  assert.equal(f.elements.get('desktopLyricSourceStatus').hidden, true);
  assert.equal(f.elements.get('desktopLyricFollowStatus').hidden, true);
});

test('nested WeSing preferences bubble to autosave without changing the followed player', async () => {
  const requests = [];
  const f = await controlsFixture(async (...args) => { requests.push(args); }, sourceState('wesing', 'wesing'));
  for (const target of [{ name: 'weSingLyricSource', value: 'qq', checked: true }, { id: 'weSingSmartLyricMatch', checked: false }]) {
    for (const type of ['input', 'change']) {
      let stopped = false;
      for (const listener of f.listeners.get(`SourceControls:${type}`)) {
        listener({ target, stopPropagation() { stopped = true; } });
      }
      assert.equal(stopped, false, 'WeSing preferences must reach the form autosave handler');
    }
  }
  assert.equal(requests.length, 0);
});

test('external retry remains available while another source is preferred', async () => {
  const initial = sourceState('netease-client', 'qq-client');
  const requests = [];
  const f = await controlsFixture(async (...args) => { requests.push(args); return { data: initial }; }, initial);
  assert.equal(f.inputs.find((input) => input.checked).value, 'qq-client');
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
  f.window.dispatchEvent(new CustomEvent('app:lyric-source', { detail: sourceState('netease-client') }));
  requests[1].reject(new Error('Late failure'));
  await tick();
  assert.equal(f.inputs.find((input) => input.checked).value, 'auto');
  assert.notEqual(f.elements.get('desktopLyricSourceStatus').textContent, 'Late failure');
});
