'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

async function fixture(preference = null) {
  const { getPlaybackOutput, PLAYBACK_OUTPUT_KEY } = await loadModuleExports(path.resolve('public/js/playback/features/output-device.js'));
  const windowListeners = new Map();
  const deviceListeners = new Map();
  const saved = new Map(preference ? [[PLAYBACK_OUTPUT_KEY, JSON.stringify(preference)]] : []);
  const writes = [];
  const calls = [];
  let devices = ['a', 'b'];
  let changeSink = async () => {};
  let failSave = false;
  let receive;
  let state;
  const audio = {
    sinkId: '', paused: false,
    pause() { this.paused = true; },
    async setSinkId(id) { calls.push(id); await changeSink(id); this.sinkId = id; },
  };
  const storage = {
    getItem: key => saved.get(key),
    setItem(key, value) {
      if (failSave) throw new Error('disk full');
      saved.set(key, value);
      writes.push(JSON.parse(value));
    },
  };
  const options = {
    storage,
    windowRef: {
      addEventListener: (event, listener) => windowListeners.set(event, listener),
      removeEventListener: event => windowListeners.delete(event),
    },
    mediaDevices: {
      async enumerateDevices() {
        return [
          { kind: 'audioinput', deviceId: 'mic', label: 'Microphone' },
          { kind: 'audiooutput', deviceId: 'default', label: 'Default' },
          ...devices.map(id => ({ kind: 'audiooutput', deviceId: id, label: `Channel ${id}` })),
        ];
      },
      addEventListener: (event, listener) => deviceListeners.set(event, listener),
      removeEventListener: event => deviceListeners.delete(event),
    },
    bridge: { onState(callback) { receive = callback; return () => { receive = null; }; } },
  };
  const output = getPlaybackOutput(audio, options);
  output.subscribe(next => { state = next; });
  return {
    audio, output, calls, writes, saved, windowListeners, deviceListeners,
    get state() { return state; },
    savedPreference: () => JSON.parse(saved.get(PLAYBACK_OUTPUT_KEY) || 'null'),
    setDevices: values => { devices = values; },
    setChangeSink: callback => { changeSink = callback; },
    failSave: () => { failSave = true; },
    receive: value => receive(value),
    hasSubscription: () => Boolean(receive),
    storageEvent: preference => {
      const value = JSON.stringify(preference);
      saved.set(PLAYBACK_OUTPUT_KEY, value);
      windowListeners.get('storage')({ key: PLAYBACK_OUTPUT_KEY, newValue: value, storageArea: storage });
    },
    reinitialize: () => getPlaybackOutput(audio, options),
  };
}

test('output selection applies to the media element before saving and restores the saved device', async () => {
  const f = await fixture({ deviceId: 'a', name: 'Channel a' });
  await f.output.prepare();
  assert.deepEqual(f.calls, ['a']);
  assert.equal(f.writes.length, 0);
  assert.equal(f.reinitialize(), f.output, 'one owner per audio element');
  f.setChangeSink(async id => {
    assert.equal(id, 'b');
    assert.equal(f.savedPreference().deviceId, 'a', 'keep the old preference until the switch succeeds');
  });
  assert.equal(await f.output.select('b'), true);
  assert.equal(f.audio.sinkId, 'b');
  assert.equal(f.savedPreference().deviceId, 'b');
  assert.deepEqual(Array.from(f.state.devices, item => item.deviceId), ['a', 'b']);
  assert.match(f.state.message, /已切换并保存/);
  f.output.dispose();
});

test('switch failure preserves the usable channel and save failure is reported without undoing a successful switch', async () => {
  const f = await fixture({ deviceId: 'a', name: 'Channel a' });
  await f.output.prepare();
  f.setChangeSink(async () => { throw Object.assign(new Error('device denied'), { name: 'NotAllowedError' }); });
  assert.equal(await f.output.select('b'), false);
  assert.equal(f.state.deviceId, 'a');
  assert.equal(f.audio.sinkId, 'a');
  assert.equal(f.savedPreference().deviceId, 'a');
  assert.match(f.state.message, /无法访问/);
  await f.output.prepare();
  f.setChangeSink(async () => {});
  f.failSave();
  assert.equal(await f.output.select('b'), true);
  assert.equal(f.audio.sinkId, 'b');
  assert.equal(f.state.deviceId, 'b');
  assert.equal(f.savedPreference().deviceId, 'a');
  assert.match(f.state.message, /未能保存/);
  f.output.dispose();
});

test('a missing saved output blocks playback without falling back and reconnecting restores it without starting music', async () => {
  const f = await fixture({ deviceId: 'missing', name: 'My output' });
  await assert.rejects(f.output.prepare(), /输出通道不可用/);
  assert.equal(f.state.deviceId, 'missing');
  assert.deepEqual(f.calls, []);
  assert.equal(f.audio.paused, true);
  assert.equal(f.savedPreference().deviceId, 'missing');
  f.setDevices(['missing']);
  await f.output.refresh();
  await f.output.prepare();
  assert.equal(f.audio.sinkId, 'missing');
  assert.equal(f.audio.paused, true);
  f.setDevices([]);
  await f.deviceListeners.get('devicechange')();
  await assert.rejects(f.output.prepare(), /输出通道不可用/);
  assert.equal(f.audio.sinkId, 'missing');
  assert.equal(await f.output.select(''), true, 'the user can explicitly return to the default output');
  await f.output.prepare();
  assert.equal(f.audio.sinkId, '');
  f.output.dispose();
});

test('newer output choices supersede pending switches and playback waits for the final selection', async () => {
  const f = await fixture();
  await f.output.prepare();
  let finishFirst;
  let started;
  const firstStarted = new Promise(resolve => { started = resolve; });
  f.setChangeSink(id => id === 'a' ? new Promise(resolve => { finishFirst = resolve; started(); }) : Promise.resolve());
  const first = f.output.select('a');
  await firstStarted;
  const ready = f.output.prepare();
  const second = f.output.select('b');
  finishFirst();
  assert.equal(await first, false);
  await ready;
  assert.equal(await second, true);
  assert.equal(f.audio.sinkId, 'b');
  assert.deepEqual(f.writes.map(value => value.deviceId), ['b']);
  f.output.dispose();
});

test('other windows synchronize without writing back and processing defers a change until the original channel is safe', async () => {
  const f = await fixture();
  await f.output.prepare();
  f.storageEvent({ deviceId: 'a', name: 'Channel a' });
  await f.output.prepare();
  assert.equal(f.audio.sinkId, 'a');
  assert.equal(f.writes.length, 0);
  f.receive({ revision: 2, internalSource: true, running: true });
  assert.equal(await f.output.select('b'), false);
  assert.equal(f.audio.sinkId, 'a');
  assert.match(f.state.message, /先关闭电音助手/);
  f.storageEvent({ deviceId: 'b', name: 'Channel b' });
  await assert.rejects(f.output.prepare(), /输出通道不可用/);
  assert.equal(f.audio.paused, true);
  f.receive({ revision: 1, running: false });
  assert.equal(f.state.processing, true, 'stale idle state cannot unlock an active processor');
  f.receive({ revision: 3, internalSource: true, running: false });
  await f.output.prepare();
  assert.equal(f.audio.sinkId, 'b');
  assert.equal(f.writes.length, 0);
  f.output.dispose();
  assert.equal(f.windowListeners.size, 0);
  assert.equal(f.deviceListeners.size, 0);
  assert.equal(f.hasSubscription(), false);
});

test('actual recovery keeps the internal output locked while safe deferred restoration permits the next playback', async () => {
  const f = await fixture();
  await f.output.prepare();
  f.receive({ internalSource: true, pendingRecovery: true, recoveryDeferred: false });
  assert.equal(await f.output.select('a'), false);
  assert.match(f.state.message, /恢复原声/);
  f.receive({ internalSource: true, pendingRecovery: true, recoveryDeferred: true });
  assert.equal(await f.output.select('a'), true);
  await f.output.prepare();
  assert.equal(f.audio.sinkId, 'a');
  f.output.dispose();
});

test('assistant startup waits for an in-flight output switch and holds synchronized preferences until processing stops', async () => {
  const f = await fixture();
  await f.output.prepare();
  let finishSwitch;
  let started;
  const switching = new Promise(resolve => { started = resolve; });
  f.setChangeSink(id => id === 'a' ? new Promise(resolve => { finishSwitch = resolve; started(); }) : Promise.resolve());
  const selection = f.output.select('a');
  await switching;
  let assistantStarted = false;
  const start = f.output.lockWhile(async () => {
    assert.equal(f.audio.sinkId, 'a');
    assert.equal(f.savedPreference().deviceId, 'b', 'the earlier switch must not overwrite a newer synchronized preference');
    assistantStarted = true;
    f.receive({ starting: true, internalSource: true });
    f.receive({ running: true, internalSource: true });
    return { ok: true };
  });
  assert.equal(await f.output.select('b'), false, 'the startup lock rejects new local selections');
  f.storageEvent({ deviceId: 'b', name: 'Channel b' });
  assert.equal(assistantStarted, false);
  finishSwitch();
  assert.equal(await selection, true);
  assert.equal((await start).ok, true);
  assert.equal(f.audio.sinkId, 'a');
  await assert.rejects(f.output.prepare(), /输出通道不可用/, 'a pending synchronized preference keeps this window paused');
  f.receive({ running: false, internalSource: true });
  await f.output.prepare();
  assert.equal(f.audio.sinkId, 'b');
  f.output.dispose();
});

test('failed assistant startup releases its lock and applies a synchronized preference', async () => {
  const f = await fixture();
  await f.output.prepare();
  await assert.rejects(f.output.lockWhile(async () => {
    f.storageEvent({ deviceId: 'b', name: 'Channel b' });
    throw new Error('startup failed');
  }), /startup failed/);
  await f.output.prepare();
  assert.equal(f.state.processing, false);
  assert.equal(f.audio.sinkId, 'b');
  f.output.dispose();
});

test('startup also waits for a selection queued before device enumeration starts', async () => {
  const f = await fixture();
  await f.output.prepare();
  const selection = f.output.select('a');
  const started = f.output.lockWhile(async () => {
    assert.equal(f.audio.sinkId, 'a');
    return true;
  });
  assert.equal(await selection, true);
  assert.equal(await started, true);
  f.output.dispose();
});
