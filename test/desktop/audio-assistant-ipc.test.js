'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { registerAudioAssistantIpc, validConfiguration } = require('../../src/electron/ipc/audio-assistant-ipc');

test('audio configuration rejects unknown fields, invalid types and out-of-range values', () => {
  for (const value of [null, [], {}, { strength: 101 }, { volume: '70' }, { volume: -1 }, { volume: 201 }, { semitones: 1.2 },
    { speedPercent: 49 }, { original: 1 }, { source: 'pid:-1' }, { command: 'exec' }, { outputId: '\0' }]) {
    assert.equal(validConfiguration(value), false, JSON.stringify(value));
  }
  assert.equal(validConfiguration({ strength: -100, volume: 0, semitones: 12, speedPercent: 200, original: false, source: 'file', cableId: '', outputId: '' }), true);
  assert.equal(validConfiguration({ volume: 200 }), true);
});

test('audio IPC is restricted to the authorized main frame and selected local audio paths', async () => {
  const handlers = new Map();
  const calls = [];
  const frame = { url: 'http://127.0.0.1:3456/admin?desktop=1' };
  const webContents = { mainFrame: frame };
  const event = { sender: webContents, senderFrame: frame };
  const dispose = registerAudioAssistantIpc({
    ipcMain: { handle: (name, callback) => handlers.set(name, callback), removeHandler: (name) => handlers.delete(name) },
    assistant: { invoke: async (...args) => { calls.push(args); return { ok: true }; } },
    getMainWindow: () => ({ isDestroyed: () => false, webContents }),
    getDesktopBaseUrl: () => 'http://127.0.0.1:3456',
    isPathAllowedForLocalMedia: (value) => value === 'selected.wav',
    shell: { openExternal: async (url) => calls.push(['external', url]) },
  });
  const invoke = handlers.get('audio-assistant:invoke');
  for (const invalid of [{}, { ...event, sender: {} }, { ...event, senderFrame: { ...frame } }])
    assert.equal((await invoke(invalid, { op: 'get' })).error, 'IPC_SOURCE_INVALID');
  for (const url of ['https://example.com/admin', 'http://127.0.0.1:3456/overlay', 'http://localhost:3456/admin']) {
    frame.url = url;
    assert.equal((await invoke(event, { op: 'get' })).error, 'IPC_SOURCE_INVALID');
  }
  frame.url = 'http://127.0.0.1:3456/admin';
  assert.equal((await invoke(event, { op: 'file', value: 'private.txt' })).ok, false);
  for (const request of [{ op: 'start', value: 1 }, { op: 'close' }, { op: 'get', command: 'arbitrary' }, { op: 'configure', value: { volume: 201 } }])
    assert.equal((await invoke(event, request)).ok, false);
  assert.equal(calls.length, 0);
  await invoke(event, { op: 'file', value: 'selected.wav' });
  await invoke(event, { op: 'configure', value: { volume: 200 } });
  await invoke(event, { op: 'mixer' });
  assert.deepEqual(calls, [['file', 'selected.wav'], ['configure', { volume: 200 }], ['external', 'ms-settings:apps-volume']]);
  dispose();
  assert.equal(handlers.size, 0);
});
