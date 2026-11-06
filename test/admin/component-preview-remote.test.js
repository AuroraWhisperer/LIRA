'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const entry = path.resolve(__dirname, '../../public/js/admin/component-preview-remote.js');
const state = (label = 'saved') => ({ saved: { label: 'saved' }, draft: { label }, generation: 0, loaded: true });

test('identical preview snapshots do not notify, but authoritative changes arrive immediately', async () => {
  const { createRemotePreviewController } = await loadModuleExports(entry, { structuredClone });
  const controller = createRemotePreviewController(state(), async () => ({ sequence: 1 }));
  const received = [];
  controller.subscribe(value => received.push(value));
  for (let index = 0; index < 20; index++) controller.receive({ state: state(), ack: 0 });
  assert.equal(received.length, 1);
  controller.receive({ state: { ...state('new'), error: '保存失败' }, ack: 0 });
  assert.equal(received.length, 2);
  assert.equal(received[1].draft.label, 'new');
  assert.equal(received[1].error, '保存失败');
  controller.setConnectionError('正在重连');
  controller.receive({ state: { ...state('new'), error: '保存失败' }, ack: 0 });
  controller.setConnectionError('');
  assert.deepEqual(received.slice(2).map(value => value.error), ['正在重连', '保存失败']);
});

test('acknowledging an unchanged edit notifies and completes flush without a state change', async () => {
  const { createRemotePreviewController } = await loadModuleExports(entry, { structuredClone });
  const controller = createRemotePreviewController(state(), async () => ({ sequence: 1 }));
  let notifications = 0;
  controller.subscribe(() => notifications++);
  await controller.edit({ label: 'saved' });
  assert.equal(controller.getState().dirty, true);
  let flushed = false;
  const flushing = controller.flush().then(() => { flushed = true; });
  await new Promise(setImmediate);
  controller.receive({ state: state(), ack: 0 });
  assert.equal(flushed, false);
  assert.equal(notifications, 2);
  controller.receive({ ack: 1 });
  await flushing;
  assert.equal(flushed, true);
  assert.equal(notifications, 3);
  assert.notEqual(controller.getState().dirty, true);
  controller.receive({ state: state(), ack: 1 });
  assert.equal(notifications, 3);
});

test('legacy relays keep prompt pending reads without overlap and return to idle frequency', async () => {
  const timers = new Map();
  let timerId = 0;
  let sequence = 0;
  let ack = 0;
  let readCount = 0;
  let finishRead;
  const { createBrowserPreviewConnection } = await loadModuleExports(entry, {
    structuredClone, AbortController, AbortSignal, crypto: require('node:crypto'),
    window: { setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; },
      clearTimeout(id) { timers.delete(id); } },
    fetch: async (url, options) => {
      const command = JSON.parse(options.body);
      let data;
      if (command.action === 'edit') data = { sequence: ++sequence };
      else {
        if (command.action === 'read' && ++readCount > 2) await new Promise(resolve => { finishRead = resolve; });
        data = { component: 'canvas', state: state(), attachmentId: command.attachmentId,
          ack, sequence, draftKey: 'test' };
      }
      return { ok: true, json: async () => ({ ok: true, data }) };
    },
  });
  const connection = createBrowserPreviewConnection({ id: 'test', token: 'synthetic', component: 'canvas' });
  try {
    await connection.start();
    assert.deepEqual([...timers.values()].map(({ delay }) => delay), [250]);
    await connection.controller.edit({ label: 'first' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(readCount, 2);
    assert.deepEqual([...timers.values()].map(({ delay }) => delay), [40]);
    const [id, timer] = [...timers][0];
    timers.delete(id);
    const reading = timer.fn();
    await connection.controller.edit({ label: 'second' });
    assert.equal(readCount, 3, 'The second edit reuses the in-flight read.');
    ack = sequence;
    finishRead();
    await reading;
    await connection.controller.flush();
    assert.deepEqual([...timers.values()].map(({ delay }) => delay), [250]);
  } finally { connection.detach(); }
  assert.equal(timers.size, 0);
});

test('idle browser reads remain pending and an ACK arriving before the command receipt still completes flush', async t => {
  const { createComponentPreviewSessions } = require('../../src/server/component-preview-sessions');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sessions = createComponentPreviewSessions();
  const session = sessions.open({ component: 'clock', state: state() });
  let reads = 0;
  let receipt;
  let accepted;
  const { createBrowserPreviewConnection } = await loadModuleExports(entry, {
    structuredClone, AbortController, AbortSignal, crypto: require('node:crypto'),
    window: { setTimeout: (...args) => setTimeout(...args), clearTimeout: id => clearTimeout(id) },
    fetch: async (_url, options) => {
      const command = JSON.parse(options.body);
      if (command.action === 'read') reads++;
      const data = await sessions.browser(command, session.token, { signal: options.signal });
      if (command.action === 'edit') {
        accepted = data.sequence;
        await new Promise(resolve => { receipt = resolve; });
      }
      return { ok: true, json: async () => ({ ok: true, data }) };
    },
  });
  const connection = createBrowserPreviewConnection({ ...session, component: 'clock' });
  t.after(() => { connection.detach(); sessions.clear(); });
  await connection.start();
  t.mock.timers.tick(250);
  await new Promise(setImmediate);
  for (let index = 0; index < 10; index++) {
    t.mock.timers.tick(1000);
    await new Promise(setImmediate);
  }
  assert.equal(reads, 2, 'one startup read and one held read cover ten idle seconds');
  const editing = connection.controller.edit({ label: 'changed' });
  await new Promise(setImmediate);
  sessions.exchange({ id: session.id, ack: accepted, incremental: true, state: state('changed') });
  await new Promise(setImmediate);
  receipt();
  await editing;
  await connection.controller.flush();
  assert.equal(connection.controller.getState().draft.label, 'changed');
  assert.notEqual(connection.controller.getState().dirty, true);
});

test('browser edits survive older snapshots and save follows preceding edits', async () => {
  const { createRemotePreviewController } = await loadModuleExports(entry, { structuredClone });
  const commands = [];
  const controller = createRemotePreviewController(state(), async (command) => {
    commands.push(command.action);
    return { sequence: commands.length };
  });
  await controller.edit({ label: 'one' });
  await controller.edit({ label: 'two' });
  await controller.save();
  controller.receive({ state: state('one'), ack: 1 });
  assert.equal(controller.getState().draft.label, 'two');
  assert.equal(controller.getState().saving, true);
  assert.deepEqual(commands, ['edit', 'edit', 'save']);
  controller.receive({ state: { ...state('two'), saved: { label: 'two' }, dirty: false, saving: false }, ack: 3 });
  assert.equal(controller.getState().dirty, false);
  assert.equal(controller.getState().saving, false);
});

test('lost browser connections preserve visible drafts and disable subsequent operations', async () => {
  const { createRemotePreviewController } = await loadModuleExports(entry, { structuredClone });
  let sent = 0;
  const controller = createRemotePreviewController(state(), async () => { sent++; throw new Error('连接已结束'); });
  await controller.edit({ label: 'unsaved' });
  assert.equal(controller.getState().loaded, false);
  assert.equal(controller.getState().draft.label, 'unsaved');
  assert.equal(controller.getState().error, '连接已结束');
  await controller.save();
  controller.receive({ state: state(), ack: 0 });
  assert.equal(controller.getState().draft.label, 'unsaved');
  assert.equal(sent, 1);
});

test('temporary transport errors retain drafts and clear without hiding controller errors', async () => {
  const { createRemotePreviewController } = await loadModuleExports(entry, { structuredClone });
  const controller = createRemotePreviewController(state(), async () => ({ sequence: 1 }));
  await controller.edit({ label: 'unsaved' });
  controller.setConnectionError('正在自动重连');
  controller.receive({ state: state(), ack: 0 });
  assert.equal(controller.getState().draft.label, 'unsaved');
  assert.equal(controller.getState().loaded, true);
  assert.equal(controller.getState().error, '正在自动重连');
  controller.receive({ state: { ...state('unsaved'), error: '保存失败' }, ack: 1 });
  controller.setConnectionError('');
  assert.equal(controller.getState().error, '保存失败');
});

test('flush waits for desktop acknowledgement and rejects a disconnected pending edit', async () => {
  const { createRemotePreviewController } = await loadModuleExports(entry, { structuredClone });
  const controller = createRemotePreviewController(state(), async () => ({ sequence: 1 }));
  await controller.edit({ label: 'pending' });
  let flushed = false;
  const pending = controller.flush().then(() => { flushed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(flushed, false);
  controller.receive({ state: state('pending'), ack: 1 });
  await pending;
  assert.equal(flushed, true);
  await controller.edit({ label: 'later' });
  const disconnected = assert.rejects(controller.flush(), /已结束/);
  controller.disconnect();
  await disconnected;
});
