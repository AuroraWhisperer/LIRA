'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const entry = path.resolve('public/js/admin/audio-assistant-controls.js');

async function createControlsFixture({ enabled = false, selected = false, visible = false, outputSwitch = null } = {}) {
  const nodes = new Map();
  function getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, Object.assign(new EventTarget(), {
      dataset: {}, hidden: false, querySelectorAll: () => [], replaceChildren(...children) { this.children = children; },
    }));
    return nodes.get(id);
  }
  const page = getElementById('otherAudioAssistantFeature');
  const mainPage = getElementById('otherAssistantPage');
  const panel = getElementById('audioAssistantPanel');
  if (outputSwitch) nodes.set('music-player', {
    sinkId: '', pause() {}, async setSinkId() { await outputSwitch(); },
  });
  page.hidden = !selected;
  mainPage.classList = { contains: (name) => name === 'active' && visible };
  page.closest = (selector) => selector === '.main-page' ? mainPage : null;
  page.querySelector = () => ({ setAttribute() {}, firstElementChild: { style: {} } });
  panel.matches = () => false;
  const observed = new Map();
  let notify;
  let subscriptions = 0;
  let receiveState;
  const calls = [];
  const { initAudioAssistantControls } = await loadModuleExports(entry, {
    document: { getElementById },
    ...(outputSwitch ? { navigator: { mediaDevices: { async enumerateDevices() { return []; } } } } : {}),
    Option: function (name, id) { this.textContent = name; this.value = id; },
    clearTimeout,
    MutationObserver: class {
      constructor(callback) { notify = callback; }
      observe(target, options) { observed.set(target, options.attributeFilter); }
      disconnect() { observed.clear(); }
    },
  });
  const controls = initAudioAssistantControls({ enabled: () => enabled, signal: new AbortController().signal,
    bridge: {
      onState(listener) { receiveState = listener; subscriptions++; return () => subscriptions--; },
      async invoke({ op }) {
        calls.push(op);
        return { ok: true, state: { ready: true, status: '音乐来源和设备已刷新。' } };
      },
    },
  });
  function mutate(target, attribute) {
    if (observed.get(target)?.includes(attribute)) notify();
  }
  return {
    controls, calls,
    node: getElementById,
    receive(state) { receiveState(state); },
    get subscriptions() { return subscriptions; },
    select(value) { page.hidden = !value; mutate(page, 'hidden'); },
    show(value) { visible = value; mutate(mainPage, 'class'); },
    enable(value) { enabled = value; controls.setEnabled(value); },
    setActive(checked) {
      const event = new Event('change');
      Object.defineProperty(event, 'target', { value: { checked, matches: selector => selector === '[data-audio-active]' } });
      page.dispatchEvent(event);
    },
  };
}

test('stopping while the player output is switching cancels the waiting assistant start', async (t) => {
  for (const cancel of ['toggle', 'disable', 'dispose']) {
    const switching = Promise.withResolvers();
    const release = Promise.withResolvers();
    const fixture = await createControlsFixture({ enabled: true, outputSwitch: async () => {
      switching.resolve();
      await release.promise;
    } });
    t.after(() => fixture.controls.dispose());
    await new Promise(resolve => setImmediate(resolve));
    fixture.setActive(true);
    await switching.promise;
    assert.deepEqual(fixture.calls, ['get']);
    if (cancel === 'toggle') fixture.setActive(false);
    else if (cancel === 'disable') fixture.enable(false);
    else fixture.controls.dispose();
    await new Promise(resolve => setImmediate(resolve));
    release.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(fixture.calls, cancel === 'dispose' ? ['get'] : ['get', 'stop'], cancel);
  }
});

test('device source rendering selects the matching inventory and hides player isolation without losing missing selections', async (t) => {
  const fixture = await createControlsFixture();
  t.after(() => fixture.controls.dispose());
  const state = {
    ready: true, source: 'input', status: '设置已保存。',
    inputs: [{ id: 'mic', name: 'USB Microphone' }], outputs: [{ id: 'speakers', name: 'Studio Out 1/2' }],
    settings: { inputId: 'mic', inputChannels: 'mono:2', inputMusic: false },
    inputDevice: { channels: 4, sampleRate: 48000 },
  };
  fixture.receive(state);
  assert.equal(fixture.node('audioAssistantDeviceInput').hidden, false);
  assert.equal(fixture.node('audioAssistantIsolation').hidden, true);
  assert.equal(fixture.node('audioAssistantInput').dataset.audioSetting, 'inputId');
  assert.equal(fixture.node('audioAssistantInput').value, 'mic');
  assert.deepEqual(fixture.node('audioAssistantInput').children.map(option => option.value), ['', 'mic']);
  assert.equal(fixture.node('audioAssistantInputChannels').value, 'mono:2');
  fixture.receive({ ...state, source: 'loopback', inputDevice: null, inputError: '输入设备不可用',
    settings: { loopbackId: 'unplugged', inputChannels: 'auto' } });
  assert.equal(fixture.node('audioAssistantInput').dataset.audioSetting, 'loopbackId');
  assert.equal(fixture.node('audioAssistantInput').value, 'unplugged');
  assert.equal(fixture.node('audioAssistantInput').children.at(-1).disabled, true);
  assert.match(fixture.node('audioAssistantInputFormat').textContent, /不可用/);
  fixture.receive({ ...state, source: 'auto' });
  assert.equal(fixture.node('audioAssistantDeviceInput').hidden, true);
  assert.equal(fixture.node('audioAssistantIsolation').hidden, false);
});

test('disabled audio assistant stays idle when login restores its selection inside the hidden toolbox', async (t) => {
  const fixture = await createControlsFixture();
  t.after(() => fixture.controls.dispose());
  fixture.select(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(fixture.calls, [], 'Restoring a selected panel is not opening the toolbox');
  fixture.show(true);
  fixture.select(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(fixture.calls, ['get'], 'Opening the selected settings must initialize only once');
  fixture.show(false);
  fixture.show(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(fixture.calls, ['get']);
});

test('audio settings initialize only when both the toolbox and their selected panel are visible', async (t) => {
  for (const state of [
    { selected: false, visible: true },
    { selected: true, visible: false },
    { selected: true, visible: true },
  ]) {
    const fixture = await createControlsFixture(state);
    t.after(() => fixture.controls.dispose());
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(fixture.calls, state.selected && state.visible ? ['get'] : []);
    fixture.show(true);
    fixture.select(true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(fixture.calls, ['get']);
  }
});

test('enabling the audio assistant loads it outside the toolbox and disposal releases its observers', async () => {
  for (const enabled of [false, true]) {
    const fixture = await createControlsFixture({ enabled });
    try {
      if (!enabled) fixture.enable(true);
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(fixture.calls, ['get']);
      assert.equal(fixture.subscriptions, 1);
    } finally { fixture.controls.dispose(); }
    fixture.show(true);
    fixture.select(true);
    assert.equal(fixture.subscriptions, 0);
    assert.deepEqual(fixture.calls, ['get']);
  }
});

test('audio device labels explain virtual channels and translate speakers without hiding the device identity', async () => {
  const { formatAudioDeviceName } = await loadModuleExports(entry);
  assert.equal(formatAudioDeviceName('Speaker (Realtek(R) Audio)'), '扬声器 (Realtek(R) Audio)');
  assert.equal(formatAudioDeviceName('扬声器 (OMEN Cam & Voice)'), 'OMEN Cam & Voice · 虚拟音频通道');
  assert.equal(formatAudioDeviceName('CABLE Input (VB-Audio Virtual Cable)'), 'CABLE Input (VB-Audio Virtual Cable) · 虚拟音频通道');
  assert.equal(formatAudioDeviceName('Headphones (WH-1000XM6)'), '耳机 (WH-1000XM6)');
  assert.equal(formatAudioDeviceName('USB DAC'), 'USB DAC');
});

test('music sources use readable names and hide unrecognized background apps without changing source IDs', async () => {
  const { getAudioSourceOptions } = await loadModuleExports(entry);
  const options = getAudioSourceOptions([
    { id: 'pid:1', name: 'msedge · PID 1' },
    { id: 'pid:2', name: 'HP.OMEN.VadRedirectHelper · PID 2' },
    { id: 'pid:3', name: 'QQMusic · 晴天 · 周杰伦' },
    { id: 'pid:4', name: 'WeSing · PID 4' },
  ]);
  assert.deepEqual(Array.from(options, ({ id, name }) => ({ id, name })), [
    { id: 'auto', name: '自动识别正在播放的音乐（推荐）' },
    { id: 'file', name: '本地文件' },
    { id: 'input', name: '麦克风、线路或声卡回送' },
    { id: 'loopback', name: '播放设备里的声音' },
    { id: 'pid:1', name: '微软 Edge 浏览器' },
    { id: 'pid:3', name: 'QQ 音乐 · 晴天 · 周杰伦' },
    { id: 'pid:4', name: '全民 K 歌' },
  ]);
  assert.ok(options.filter((option) => option.id.startsWith('pid:')).every((option) => option.group === '手动指定播放音乐的应用'));
  assert.equal(getAudioSourceOptions().length, 4);
});

test('duplicate browser audio sources remain distinguishable and a previously selected unknown app stays selected', async () => {
  const { getAudioSourceOptions } = await loadModuleExports(entry);
  const apps = [
    { id: 'pid:12', name: 'msedge · PID 12' },
    { id: 'pid:34', name: 'msedge · PID 34' },
    { id: 'pid:56', name: 'unknown · PID 56' },
  ];
  const options = getAudioSourceOptions(apps, 'pid:56');
  assert.equal(options.find((option) => option.id === 'pid:12').name, '微软 Edge 浏览器（音频 1）');
  assert.equal(options.find((option) => option.id === 'pid:34').name, '微软 Edge 浏览器（音频 2）');
  assert.equal(options.find((option) => option.id === 'pid:56').name, '其他应用（建议使用自动识别）');
  assert.ok(options.every((option) => !/PID|进程/.test(option.name)));
});

test('input channel choices expose actual mono channels and stereo pairs without inventing extra devices', async () => {
  const { getAudioInputChannels } = await loadModuleExports(entry);
  assert.deepEqual(Array.from(getAudioInputChannels(1), option => option.id), ['auto', 'mono:0']);
  assert.deepEqual(Array.from(getAudioInputChannels(4), option => option.id),
    ['auto', 'stereo:0', 'mono:0', 'mono:1', 'stereo:2', 'mono:2', 'mono:3']);
  assert.deepEqual(Array.from(getAudioInputChannels(), option => option.id), ['auto']);
});

test('audio parameter writes retain a newer same-value edit while earlier requests complete', async () => {
  const { createAudioParameterQueue } = await loadModuleExports(entry);
  const sends = [];
  const completions = [];
  const queue = createAudioParameterQueue((value) => {
    sends.push(JSON.parse(JSON.stringify(value)));
    return new Promise((resolve) => completions.push(resolve));
  }, () => {});
  queue.change('semitones', 1);
  const first = queue.flush();
  await new Promise((resolve) => setImmediate(resolve));
  queue.change('semitones', 2);
  const second = queue.flush();
  queue.change('semitones', 1);
  completions[0](true);
  await first;
  assert.equal(queue.pending.semitones, 1, 'The newer edit must not be cleared just because its value matches an older request');
  const third = queue.flush();
  await new Promise((resolve) => setImmediate(resolve));
  completions[1](true);
  await second;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queue.pending.semitones, 1);
  completions[2](true);
  assert.equal(await third, true);
  assert.deepEqual(sends, [{ semitones: 1 }, { semitones: 2 }, { semitones: 1 }]);
  assert.equal(Object.keys(queue.pending).length, 0);
});

test('audio parameter queue reports failed changes before a caller starts playback and can retry', async () => {
  const { createAudioParameterQueue, formatAudioParameter } = await loadModuleExports(entry);
  let success = false;
  const queue = createAudioParameterQueue(async () => success, () => {});
  queue.change('volume', 0);
  assert.equal(await queue.flush(), false);
  assert.equal(await queue.flush(), true, 'A handled failure must not block later device refresh or file selection');
  success = true;
  queue.change('volume', 0);
  assert.equal(await queue.flush(), true);
  assert.equal(formatAudioParameter('strength', 0), '原唱');
  assert.equal(formatAudioParameter('speedPercent', 150), '1.50×');
  assert.equal(formatAudioParameter('semitones', -12), '-12 Key');
});
