'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { createAudioAssistant } = require('../../src/electron/audio-assistant');

function worker() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => child.emit('exit', 1);
  child.stdin.on('finish', () => child.emit('exit', 0));
  return child;
}

test('audio helper is lazy, reused for concurrent requests, and drains on shutdown', async () => {
  const child = worker();
  let launches = 0;
  const states = [];
  const assistant = createAudioAssistant({ executable: 'worker.exe', dataDir: 'isolated', exists: () => true,
    onState: (state) => states.push(state),
    spawnProcess: (exe, args, options) => {
      launches++;
      assert.equal(exe, 'worker.exe');
      assert.deepEqual(args, ['--bridge']);
      assert.equal(options.windowsHide, true);
      assert.ok(options.env.LIRA_AUDIO_DATA_DIR.endsWith('audio-assistant'));
      queueMicrotask(() => child.stdout.write(JSON.stringify({ type: 'state', state: {
        ready: true, running: false, pendingRecovery: true, recoveryDeferred: true,
      } }) + '\n'));
      return child;
    },
  });
  child.stdin.on('data', (data) => {
    const request = JSON.parse(data.toString());
    child.stdout.write(JSON.stringify({ id: request.id, ok: true }) + '\n');
  });
  assert.equal(launches, 0);
  assert.equal((await assistant.invoke('stop')).ok, true);
  assert.equal(launches, 0);
  const results = await Promise.all([assistant.invoke('get'), assistant.invoke('configure', { strength: -50 })]);
  assert.equal(launches, 1);
  assert.ok(results.every((item) => item.ok));
  assert.ok(results.every((item) => item.state.pendingRecovery && item.state.recoveryDeferred),
    'The desktop must preserve the native distinction between safe deferral and recovery failure');
  assert.equal(states[0].revision, 1);
  await assistant.dispose();
  assert.equal(assistant.getState().ready, false);
});

test('audio helper exit rejects outstanding work and permits a clean later launch', async () => {
  let child;
  const assistant = createAudioAssistant({ executable: 'worker.exe', dataDir: 'isolated', exists: () => true,
    spawnProcess: () => { child = worker(); queueMicrotask(() => child.stdout.write('{"type":"state","state":{"ready":true}}\n')); return child; },
  });
  const pending = assistant.invoke('start');
  await new Promise((resolve) => setImmediate(resolve));
  child.emit('exit', 1);
  assert.equal((await pending).ok, false);
  assert.equal(assistant.getState().running, false);
  const retry = assistant.invoke('get');
  await new Promise((resolve) => setImmediate(resolve));
  child.stdout.write('{"id":2,"ok":true}\n');
  assert.equal((await retry).ok, true);
  await assistant.dispose();
});

test('missing audio resources report recovery instructions without launching anything', async () => {
  const assistant = createAudioAssistant({ executable: 'missing.exe', dataDir: 'isolated', exists: () => false });
  const result = await assistant.invoke('get');
  assert.equal(result.ok, false);
  assert.match(result.error, /build:audio-assistant/);
  await assistant.dispose();
});

test('internal audio source is derived from this Electron instance process IDs, never the player display name', async () => {
  const child = worker();
  const assistant = createAudioAssistant({ executable: 'worker.exe', dataDir: 'isolated', exists: () => true,
    getProcessIds: () => [11, 22],
    spawnProcess: () => {
      queueMicrotask(() => publish({ ready: true, sourceProcessId: 22 }));
      return child;
    },
  });
  function publish(state) { child.stdout.write(JSON.stringify({ type: 'state', state }) + '\n'); }
  child.stdin.on('data', (data) => child.stdout.write(JSON.stringify({ id: JSON.parse(data).id, ok: true }) + '\n'));
  assert.equal((await assistant.invoke('get')).state.internalSource, true);
  publish({ ready: true, sourceProcessId: 33, song: 'LIRA · Test', internalSource: true });
  assert.equal(assistant.getState().internalSource, false);
  publish({ ready: true, source: 'file', sourceProcessId: null });
  assert.equal(assistant.getState().internalSource, false);
  publish({ ready: true, sourceProcessId: 11 });
  assert.equal(assistant.getState().internalSource, true);
  await assistant.dispose();
  assert.equal(assistant.getState().internalSource, false);
});
