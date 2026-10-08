'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const entry = path.resolve(__dirname, '../../public/js/admin/component-preview-remote.js');
const state = (label = 'saved') => ({ saved: { label: 'saved' }, draft: { label }, generation: 0, loaded: true });

test('pending browser edits poll promptly without overlapping reads, then return to idle frequency', async () => {
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
