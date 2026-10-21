'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { createPlaybackOutput } = require('../../src/electron/playback-output');
const { registerPlaybackOutputIpc, validPlaybackRequest } = require('../../src/electron/ipc/playback-output-ipc');

test('playback IPC accepts only bounded PCM and enumerated output families from the authorized main frame', async () => {
  for (const request of [{ op: 'list' }, { op: 'open', value: { deviceId: 'wasapi:default' } },
    { op: 'write', value: { stream: 1, pcm: new ArrayBuffer(8192) } }]) assert.equal(validPlaybackRequest(request), true);
  for (const request of [{ op: 'file', value: 'private.wav' }, { op: 'list', value: {} },
    { op: 'open', value: { deviceId: 'wasapi:default\n' } }, { op: 'open', value: { deviceId: 'file:///private' } },
    { op: 'write', value: { stream: 1, pcm: new ArrayBuffer(16392) } },
    { op: 'write', value: { stream: 0, pcm: new ArrayBuffer(8) } },
    { op: 'write', value: { stream: 1, pcm: new Uint8Array(8) } },
    { op: 'write', value: { stream: 1, pcm: new ArrayBuffer(9) } }]) assert.equal(validPlaybackRequest(request), false);
  const handlers = new Map();
  const contents = new EventEmitter();
  contents.mainFrame = { url: 'http://127.0.0.1:3456/admin' };
  const calls = [];
  const dispose = registerPlaybackOutputIpc({
    ipcMain: { handle: (key, fn) => handlers.set(key, fn), removeHandler: key => handlers.delete(key) },
    output: { invoke: async (...args) => { calls.push(args); return { ok: true }; } },
    getMainWindow: () => ({ webContents: contents, isDestroyed: () => false }),
    getDesktopBaseUrl: () => 'http://127.0.0.1:3456',
  });
  const invoke = handlers.get('playback-output:invoke');
  const event = { sender: contents, senderFrame: contents.mainFrame };
  assert.equal((await invoke({ ...event, senderFrame: { ...contents.mainFrame } }, { op: 'list' })).error, 'IPC_SOURCE_INVALID');
  contents.mainFrame.url = 'http://127.0.0.1:3456/overlay';
  assert.equal((await invoke(event, { op: 'list' })).error, 'IPC_SOURCE_INVALID');
  contents.mainFrame.url = 'http://127.0.0.1:3456/admin';
  await invoke(event, { op: 'list' });
  await invoke(event, { op: 'list' });
  assert.equal(contents.listenerCount('did-start-navigation'), 1);
  contents.emit('did-start-navigation', {}, '/admin', false, true);
  assert.equal(calls.at(-1)[0], 'stop');
  dispose();
  assert.equal(contents.eventNames().length, 0);
  assert.equal(handlers.size, 0);
});

test('native playback serializes writes, rejects stale streams, bounds backlog and closes its own worker', async () => {
  let launches = 0;
  const child = new EventEmitter();
  Object.assign(child, { pid: 1234, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
  child.kill = () => child.emit('exit', 1);
  child.stdin.on('finish', () => child.emit('exit', 0));
  const commands = [];
  let hold = false;
  let held;
  function respond(command) {
    child.stdout.write(JSON.stringify({ id: command.id, ok: true, data: command.op === 'open'
      ? { stream: command.value.stream, backend: command.value.deviceId.split(':')[0] } : [] }) + '\n');
  }
  child.stdin.on('data', bytes => {
    const command = JSON.parse(bytes);
    commands.push(command);
    if (hold) held = command;
    else respond(command);
  });
  const output = createPlaybackOutput({ executable: 'test.exe', dataDir: 'isolated', exists: () => true,
    spawnProcess: (_exe, args, options) => {
      launches++;
      assert.deepEqual(args, ['--playback-output']);
      assert.equal(options.windowsHide, true);
      queueMicrotask(() => child.stdout.write('{"type":"ready"}\n'));
      return child;
    },
  });
  assert.equal(launches, 0);
  assert.equal((await output.invoke('stop')).ok, true);
  const opened = await output.invoke('open', { deviceId: 'waveout:default' });
  const stream = opened.data.stream;
  assert.equal(output.getCaptureProcessId(), 1234);
  await output.invoke('write', { stream, pcm: new ArrayBuffer(8) });
  assert.equal(commands.at(-1).value.sequence, 1);
  hold = true;
  const pending = output.invoke('write', { stream, pcm: new ArrayBuffer(8) });
  await new Promise(resolve => setImmediate(resolve));
  const stop = output.invoke('stop');
  const stale = output.invoke('write', { stream, pcm: new ArrayBuffer(8) });
  const list = output.invoke('list');
  assert.equal((await output.invoke('list')).ok, false, 'queue must remain bounded');
  hold = false;
  respond(held);
  await Promise.all([pending, stop, list]);
  assert.equal((await stale).stale, true);
  assert.equal(commands.filter(command => command.op === 'write').length, 2);
  assert.equal(launches, 1);
  await output.invoke('open', { deviceId: 'asio:driver' });
  assert.equal(output.getCaptureProcessId(), null, 'ASIO cannot be advertised as a Windows process-loopback source');
  await output.dispose();
  assert.equal(output.getProcessId(), null);
  assert.equal((await output.invoke('list')).ok, false, 'closed owners cannot restart after app exit');
});
