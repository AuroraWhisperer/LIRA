'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const vm = require('node:vm');
const { createAudioAssistant } = require('../../src/electron/audio-assistant');
const { createAudioStateSender, registerAudioAssistantIpc } = require('../../src/electron/ipc/audio-assistant-ipc');

const listKeys = ['apps', 'outputs', 'outputChoices', 'inputs'];
const seed = {
  ready: true, running: true, starting: false, sourceProcessId: 17, status: 'playing', level: 0,
  settings: { speedPercent: 125 }, apps: [{ id: 'pid:17', name: 'Test · Track' }],
  outputs: [{ id: 'out', name: 'Output' }], outputChoices: [{ id: 'asio:Studio', name: 'ASIO：Studio' }],
  inputs: [{ id: 'in', name: 'Input' }],
};
const preload = fs.readFileSync(path.join(__dirname, '../../src/electron/preload.js'), 'utf8');
const turn = () => new Promise(resolve => setImmediate(resolve));
const full = state => ({ type: 'state', state });
const levels = state => ({ type: 'levels', state });
const listContent = state => listKeys.map(key => state[key]);
const tickBody = frame => frame.changes ?? frame;

// Replace only the byte pipe, BrowserWindow transport and isolated world's electron binding.
function fixture(t, first = [full(seed)]) {
  const handlers = new Map(), frames = [], workers = [], syncs = [];
  let opening = first, document, visible = true;
  const contents = {
    send: (channel, frame) => {
      const payload = structuredClone(frame);
      frames.push(payload);
      document.ipc.emit(channel, {}, payload);
    },
  };
  const getMainWindow = () => visible ? { isDestroyed: () => false, webContents: contents } : null;
  const sender = createAudioStateSender(getMainWindow);
  const assistant = createAudioAssistant({ dataDir: 'synthetic', exists: () => true, getProcessIds: () => [17], onState: sender,
    spawnProcess: (_exe, _args, options) => {
      assert.equal(options.env.LIRA_AUDIO_METER_FRAMES, '1');
      const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
      child.send = message => child.stdout.write((typeof message === 'string' ? message : JSON.stringify(message)) + '\n');
      child.stdin.on('data', bytes => child.send({ id: JSON.parse(bytes).id, ok: true }));
      child.stdin.on('finish', () => child.emit('exit', 0));
      workers.push(child);
      queueMicrotask(() => opening.forEach(child.send));
      return child;
    },
  });
  const base = 'http://127.0.0.1:3456';
  const dispose = registerAudioAssistantIpc({ assistant, getMainWindow, getDesktopBaseUrl: () => base,
    ipcMain: { handle: (key, fn) => handlers.set(key, fn), removeHandler: key => handlers.delete(key) } });
  t.after(async () => { dispose(); await assistant.dispose(); });

  function openDocument() {
    const ipc = new EventEmitter();
    const frame = { url: base + '/admin', send: (channel, value) => {
      const payload = structuredClone(value);
      frames.push(payload);
      ipc.emit(channel, {}, payload);
    } };
    contents.mainFrame = frame;
    ipc.invoke = async (channel, ...args) => {
      if (channel === 'audio-assistant:sync') { syncs.push(frame); await turn(); }
      const result = await handlers.get(channel)({ senderFrame: frame, sender: contents }, ...args);
      return structuredClone(result);
    };
    const bridges = {};
    vm.runInNewContext(preload, { require: () => ({ ipcRenderer: ipc, contextBridge: {
      exposeInMainWorld: (name, bridge) => { bridges[name] = bridge; },
    } }), console });
    document = { ipc, api: bridges.audioAssistant };
    return document.api;
  }
  return {
    api: openDocument(), frames, workers, syncs, assistant, openDocument,
    show: value => { visible = value; }, nextWorker: messages => { opening = messages; },
  };
}

// The same test accepts raw lines from the native synthetic check. It also runs independently of the .NET build.
function stableTrace(mode) {
  const file = process.env.LIRA_TEST_AUDIO_STATE_TRACE;
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'))[mode];
  return [full(seed), ...Array.from({ length: 11 }, (_, i) => {
    const sample = { level: i < 10 ? .75 : 0, inputLevel: i < 10 ? .75 : 0, status: i < 10 ? 'sound' : 'quiet' };
    return mode === 'modern' ? levels(sample) : full({ ...seed, ...sample });
  })].map(message => JSON.stringify(message));
}

for (const mode of ['modern', 'legacy']) {
  test(`${mode} native frames keep stable inventories off renderer IPC while preserving all public snapshots`, async t => {
    const trace = stableTrace(mode);
    const f = fixture(t, [trace[0]]);
    const received = [];
    const off = f.api.onState(state => received.push(state));
    t.after(off);
    await turn();
    assert.equal(f.workers.length, 0, 'Subscribing must not launch the worker');
    const initial = (await f.api.invoke({ op: 'get' })).state;
    assert.deepEqual(listContent(initial), listContent(JSON.parse(trace[0]).state));
    f.frames.length = received.length = 0;
    for (const line of trace.slice(1)) f.workers[0].send(line);
    assert.equal(f.frames.length, 11);
    assert.equal(f.frames.filter(frame => listKeys.some(key => Object.hasOwn(tickBody(frame), key))).length, 0);
    assert.equal(received.length, 11);
    for (let i = 0; i < received.length; i++) {
      const sample = JSON.parse(trace[i + 1]).state;
      assert.deepEqual(listContent(received[i]), listContent(initial));
      assert.equal(received[i].level, sample.level);
      assert.equal(received[i].status, sample.status);
      assert.equal(received[i].revision, initial.revision + i + 1);
    }
    const bytes = f.frames.reduce((total, frame) => total + Buffer.byteLength(JSON.stringify(frame)), 0);
    const fullBytes = received.reduce((total, state) => total + Buffer.byteLength(JSON.stringify(state)), 0);
    t.diagnostic(`ticks=11 listFrames=0 completeCallbacks=11 renderer JSON bytes=${bytes}, full snapshots=${fullBytes}`);
  });
}

test('device changes, emptied lists and legacy full frames replace state without hiding control changes', async t => {
  const f = fixture(t);
  const states = [];
  const off = f.api.onState(state => states.push(state));
  t.after(off);
  await turn();
  await f.api.invoke({ op: 'get' });
  const changed = { ...seed, outputs: [{ id: 'out', name: 'Renamed' }], inputs: [], outputChoices: [],
    settings: { speedPercent: 150 }, sourceProcessId: null };
  f.workers[0].send(full(changed));
  const notification = states.at(-1);
  assert.deepEqual(listContent(notification), listContent(changed));
  assert.equal(notification.internalSource, false);
  assert.equal(notification.settings.speedPercent, 150);
  assert.equal(Object.hasOwn(tickBody(f.frames.at(-1)), 'apps'), false);
  assert.deepEqual(listContent((await f.api.invoke({ op: 'get' })).state), listContent(changed));
  // Earlier component versions that provide outputs only still use those choices in the UI.
  const { outputChoices, ...old } = changed;
  f.workers[0].send(full(old));
  assert.deepEqual(states.at(-1).outputChoices, old.outputs);
});

test('late subscription, reload and revision gaps seed the active document from current state', async t => {
  const f = fixture(t);
  const first = [];
  const off = f.api.onState(state => first.push(state));
  await turn();
  await f.api.invoke({ op: 'get' });
  f.workers[0].send(levels({ level: .25 }));
  const late = [];
  const stopLate = f.api.onState(state => late.push(state));
  assert.deepEqual(listContent(late[0]), listContent(seed));
  assert.equal(late[0].level, .25);
  assert.equal(f.syncs.length, 1);
  off(); stopLate(); stopLate();
  const oldCount = first.length;
  f.show(false);
  f.workers[0].send(full({ ...seed, inputs: [], level: .5 }));
  f.show(true);
  const doc = f.openDocument();
  const reloaded = [];
  const remove = doc.onState(state => reloaded.push(state));
  t.after(remove);
  f.workers[0].send(levels({ level: .6 })); // Crosses IPC before the requested seed.
  assert.equal(reloaded.length, 0);
  await turn();
  assert.equal(reloaded.length, 1);
  assert.deepEqual(reloaded[0].inputs, []);
  assert.equal(reloaded[0].level, .6);
  f.show(false);
  f.workers[0].send(full({ ...seed, apps: [], level: .7 }));
  f.show(true);
  f.workers[0].send(levels({ level: .8 }));
  assert.equal(reloaded.length, 1, 'Never merge onto a missing revision');
  await turn();
  assert.equal(reloaded.at(-1).level, .8);
  assert.deepEqual(reloaded.at(-1).apps, []);
  assert.equal(f.syncs.length, 3);
  assert.equal(first.length, oldCount);
});

test('a new worker needs its own seed and cannot restore choices from its predecessor', async t => {
  const f = fixture(t);
  const states = [];
  const off = f.api.onState(state => states.push(state));
  t.after(off);
  await turn();
  await f.api.invoke({ op: 'get' });
  const old = f.workers[0];
  old.emit('exit', 1);
  assert.equal(states.at(-1).ready, false);
  assert.deepEqual(listContent(states.at(-1)), [[], [], [], []]);
  const stoppedRevision = states.at(-1).revision;
  const fresh = { ...seed, apps: [], inputs: [{ id: 'new', name: 'New input' }] };
  f.nextWorker([levels({ level: 99 }), full(fresh)]);
  const result = await f.api.invoke({ op: 'get' });
  old.send(full(seed));
  assert.equal(states.at(-1).revision, stoppedRevision + 1);
  assert.deepEqual(listContent(result.state), listContent(fresh));
  f.workers[1].send(levels({ level: .3 }));
  assert.equal(states.at(-1).level, .3);
  assert.deepEqual(listContent(states.at(-1)), listContent(fresh));
});
