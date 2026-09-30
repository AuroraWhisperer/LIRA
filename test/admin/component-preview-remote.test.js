'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const entry = path.resolve(__dirname, '../../public/js/admin/component-preview-remote.js');
const state = (label = 'saved') => ({ saved: { label: 'saved' }, draft: { label }, generation: 0, loaded: true });

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
