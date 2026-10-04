'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');

const entry = path.join(__dirname, '../../public/js/admin/component-config-controller.js');
const plain = (value) => JSON.parse(JSON.stringify(value));

async function fixture(options = {}) {
  const { createComponentConfigController } = await loadModuleExports(entry);
  const writes = [];
  const controller = createComponentConfigController({
    initial: { fontSize: 24, color: '#ffffff' },
    persist: (draft, changed) => new Promise((resolve, reject) => writes.push({ draft, changed, resolve, reject })),
    ...options,
  });
  return { controller, writes };
}

test('both views share drafts, save a frozen snapshot and preserve edits during save', async () => {
  const { controller, writes } = await fixture();
  const page = [], preview = [];
  controller.subscribe((state) => page.push(state));
  const unsubscribe = controller.subscribe((state) => preview.push(state));
  controller.edit({ fontSize: 28 });
  assert.equal(preview.at(-1).draft.fontSize, 28);
  controller.edit({ fontSize: 32 });
  const saving = controller.save();
  assert.equal(controller.getState().saving, true);
  assert.equal(controller.discard(), false);
  assert.equal(controller.save(), saving);
  controller.edit({ fontSize: 36 });
  assert.equal(writes.length, 1);
  assert.deepEqual(plain(writes[0].draft), { fontSize: 32, color: '#ffffff' });
  assert.deepEqual(plain(writes[0].changed), { fontSize: 32 });
  writes[0].resolve({ fontSize: 32, color: '#eeeeee' });
  assert.equal(await saving, true);
  const state = controller.getState();
  assert.equal(state.saved.fontSize, 32);
  assert.equal(state.draft.fontSize, 36);
  assert.equal(state.draft.color, '#eeeeee');
  assert.equal(page.at(-1).dirty, true);
  unsubscribe();
  controller.discard();
  assert.equal(page.at(-1).draft.fontSize, 32);
  assert.equal(preview.at(-1).draft.fontSize, 36);
  assert.equal(writes.length, 1);
});

test('failed or unconfirmed saves retain all drafts for explicit retry', async () => {
  const { controller, writes } = await fixture();
  controller.edit({ fontSize: 28, color: '#123456' });
  const saving = controller.save();
  writes[0].reject(new Error('未接收字段'));
  assert.equal(await saving, false);
  assert.equal(controller.getState().error, '未接收字段');
  assert.deepEqual(plain(controller.getState().draft), { fontSize: 28, color: '#123456' });
  assert.equal(controller.getState().saved.fontSize, 24);
  const retry = controller.save();
  writes[1].resolve({ fontSize: 28, color: '#123456' });
  assert.equal(await retry, true);
  assert.equal(controller.getState().dirty, false);
});

test('external config updates merge untouched fields and only conflicting edits report conflict', async () => {
  const { controller } = await fixture();
  controller.edit({ fontSize: 28 });
  controller.receive({ fontSize: 24, color: '#123456' });
  assert.equal(controller.getState().conflict, false);
  assert.equal(controller.getState().draft.color, '#123456');
  controller.receive({ fontSize: 30, color: '#123456' });
  assert.equal(controller.getState().conflict, true);
  assert.equal(controller.getState().draft.fontSize, 28);
  controller.discard();
  assert.equal(controller.getState().draft.fontSize, 30);
  assert.equal(controller.getState().conflict, false);
});

test('save echoes do not report conflicts and later config edits remain dirty', async () => {
  const { controller, writes } = await fixture();
  controller.edit({ fontSize: 28 });
  const saving = controller.save();
  controller.edit({ fontSize: 36 });
  controller.receive({ fontSize: 28, color: '#ffffff' });
  assert.equal(controller.getState().conflict, false);
  writes[0].resolve({ fontSize: 28, color: '#ffffff' });
  await saving;
  assert.equal(controller.getState().draft.fontSize, 36);
  assert.equal(controller.getState().dirty, true);
});

test('a late save acknowledgement cannot undo a newer authoritative configuration', async () => {
  let confirmations = 0;
  const latest = { fontSize: 32, color: '#ff0000' };
  const { controller, writes } = await fixture({ confirm: async () => { confirmations++; return latest; } });
  controller.edit({ fontSize: 28 });
  const saving = controller.save();
  controller.receive({ fontSize: 28, color: '#ffffff' });
  controller.receive(latest);
  writes[0].resolve({ fontSize: 28, color: '#ffffff' });
  assert.equal(await saving, false);
  assert.equal(confirmations, 1);
  assert.deepEqual(plain(controller.getState().saved), latest);
  assert.deepEqual(plain(controller.getState().draft), latest);
  assert.equal(controller.getState().applied, false);
  assert.match(controller.getState().error, /其他入口更新/);
});

test('an older broadcast before the save acknowledgement is reconciled, not preferred', async () => {
  let confirmations = 0;
  const confirmed = { fontSize: 28, color: '#eeeeee' };
  const { controller, writes } = await fixture({ confirm: async () => { confirmations++; return confirmed; } });
  controller.edit({ fontSize: 28 });
  const saving = controller.save();
  controller.receive({ fontSize: 24, color: '#ffffff' });
  writes[0].resolve(confirmed);
  assert.equal(await saving, true);
  assert.equal(confirmations, 1);
  assert.deepEqual(plain(controller.getState().saved), confirmed);
  assert.deepEqual(plain(controller.getState().draft), confirmed);
});

test('uncontested acknowledgements and identical save echoes do not request confirmation', async () => {
  for (const echo of [false, true]) {
    const { controller, writes } = await fixture({ confirm: () => assert.fail('unexpected confirmation read') });
    controller.edit({ fontSize: 28 });
    const saving = controller.save();
    if (echo) controller.receive({ fontSize: 28, color: '#ffffff' });
    writes[0].resolve({ fontSize: 28, color: '#ffffff' });
    assert.equal(await saving, true);
  }
});

test('confirmation preserves new edits and cannot undo broadcasts received while it was pending', async () => {
  const confirmation = Promise.withResolvers();
  const started = Promise.withResolvers();
  const { controller, writes } = await fixture({ confirm: () => { started.resolve(); return confirmation.promise; } });
  controller.edit({ fontSize: 28 });
  const saving = controller.save();
  controller.receive({ fontSize: 28, color: '#ffffff' });
  controller.receive({ fontSize: 32, color: '#ff0000' });
  writes[0].resolve({ fontSize: 28, color: '#ffffff' });
  await started.promise;
  controller.edit({ fontSize: 36 });
  controller.receive({ fontSize: 40, color: '#00ff00' });
  confirmation.resolve({ fontSize: 32, color: '#ff0000' });
  assert.equal(await saving, false);
  assert.deepEqual(plain(controller.getState().saved), { fontSize: 40, color: '#00ff00' });
  assert.deepEqual(plain(controller.getState().draft), { fontSize: 36, color: '#00ff00' });
  assert.equal(controller.getState().dirty, true);
  assert.equal(controller.getState().conflict, true);
});

test('confirmation errors settle without discarding drafts or newer saved state', async () => {
  const { controller, writes } = await fixture({ confirm: async () => { throw new Error('确认读取失败'); } });
  controller.edit({ fontSize: 28 });
  const saving = controller.save();
  controller.receive({ fontSize: 32, color: '#ff0000' });
  controller.edit({ fontSize: 36 });
  writes[0].resolve({ fontSize: 28, color: '#ffffff' });
  assert.equal(await saving, false);
  assert.equal(controller.getState().saving, false);
  assert.equal(controller.getState().saved.fontSize, 32);
  assert.equal(controller.getState().draft.fontSize, 36);
  assert.equal(controller.getState().error, '确认读取失败');
});

test('a reverted edit stays dirty after confirmation without treating unrelated changes as a failed save', async () => {
  const { controller, writes } = await fixture({ confirm: async () => ({ fontSize: 28, color: '#ff0000' }) });
  controller.edit({ fontSize: 28 });
  const saving = controller.save();
  controller.edit({ fontSize: 24 });
  controller.receive({ fontSize: 28, color: '#ff0000' });
  writes[0].resolve({ fontSize: 28, color: '#ffffff' });
  assert.equal(await saving, true);
  assert.deepEqual(plain(controller.getState().saved), { fontSize: 28, color: '#ff0000' });
  assert.deepEqual(plain(controller.getState().draft), { fontSize: 24, color: '#ff0000' });
  assert.equal(controller.getState().dirty, true);
  assert.equal(controller.getState().conflict, false);
});

test('an ambiguous acknowledgement without a read capability preserves authority and requests confirmation', async () => {
  const { controller, writes } = await fixture();
  controller.edit({ fontSize: 28 });
  const saving = controller.save();
  controller.receive({ fontSize: 28, color: '#ffffff' });
  controller.receive({ fontSize: 32, color: '#ff0000' });
  writes[0].resolve({ fontSize: 28, color: '#ffffff' });
  assert.equal(await saving, false);
  assert.deepEqual(plain(controller.getState().saved), { fontSize: 32, color: '#ff0000' });
  assert.deepEqual(plain(controller.getState().draft), { fontSize: 32, color: '#ff0000' });
  assert.equal(controller.getState().applied, false);
  assert.match(controller.getState().error, /重新读取/);
});

test('reset during confirmation invalidates the old save without clearing a new one', async () => {
  const confirmation = Promise.withResolvers();
  const started = Promise.withResolvers();
  const { controller, writes } = await fixture({ confirm: () => { started.resolve(); return confirmation.promise; } });
  controller.edit({ fontSize: 28 });
  const oldSave = controller.save();
  controller.receive({ fontSize: 32, color: '#ff0000' });
  writes[0].resolve({ fontSize: 28, color: '#ffffff' });
  await started.promise;
  controller.reset({ fontSize: 40, color: '#222222' });
  controller.receive({ fontSize: 40, color: '#222222' });
  controller.edit({ fontSize: 44 });
  const newSave = controller.save();
  confirmation.resolve({ fontSize: 32, color: '#ff0000' });
  assert.equal(await oldSave, false);
  assert.equal(controller.getState().saving, true);
  assert.equal(controller.getState().draft.fontSize, 44);
  writes[1].resolve(writes[1].draft);
  assert.equal(await newSave, true);
});

test('late reads cannot replace newer received config or saved config', async () => {
  let resolveRead;
  const { controller } = await fixture({ read: () => new Promise((resolve) => { resolveRead = resolve; }) });
  const reading = controller.reload();
  controller.receive({ fontSize: 32, color: '#eeeeee' });
  resolveRead({ fontSize: 24, color: '#ffffff' });
  await reading;
  assert.equal(controller.getState().draft.fontSize, 32);
  assert.equal(controller.getState().loading, false);
});

test('reverting to the saved value during a request survives its snapshot and acknowledgement', async () => {
  const { controller, writes } = await fixture();
  controller.edit({ fontSize: 28 });
  const saving = controller.save();
  controller.edit({ fontSize: 24 });
  controller.receive({ fontSize: 28, color: '#ffffff' });
  assert.equal(controller.getState().draft.fontSize, 24);
  writes[0].resolve({ fontSize: 28, color: '#ffffff' });
  await saving;
  assert.equal(controller.getState().draft.fontSize, 24);
  assert.equal(controller.getState().dirty, true);
});

test('reset invalidates old account saves and reads without clobbering a new save', async () => {
  const { controller, writes } = await fixture();
  controller.edit({ fontSize: 28 });
  const oldSave = controller.save();
  controller.reset({ fontSize: 40, color: '#222222' });
  controller.receive({ fontSize: 40, color: '#222222' });
  controller.edit({ fontSize: 44 });
  const newSave = controller.save();
  writes[0].resolve({ fontSize: 28, color: '#ffffff' });
  assert.equal(await oldSave, false);
  assert.equal(controller.getState().saving, true);
  assert.equal(controller.getState().draft.fontSize, 44);
  writes[1].resolve({ fontSize: 44, color: '#222222' });
  assert.equal(await newSave, true);
  assert.equal(controller.getState().dirty, false);
});

test('state snapshots cannot mutate the controller and compound fields are atomic', async () => {
  const { controller } = await fixture({ initial: { layout: { width: 1920 }, color: '#ffffff' } });
  const snapshot = controller.getState();
  snapshot.draft.layout.width = 1;
  controller.edit({ layout: { width: 1280 } });
  controller.receive({ layout: { width: 1080 }, color: '#123456' });
  assert.deepEqual(plain(controller.getState().draft.layout), { width: 1280 });
  assert.equal(controller.getState().draft.color, '#123456');
  controller.discard();
  assert.equal(controller.getState().draft.layout.width, 1080);
});

test('state exposes an account generation that changes only on reset', async () => {
  const { controller, writes } = await fixture();
  const generation = controller.getState().generation;
  assert.equal(typeof generation, 'number');
  controller.edit({ fontSize: 28 });
  controller.receive({ fontSize: 24, color: '#123456' });
  const saving = controller.save();
  writes[0].resolve(writes[0].draft);
  await saving;
  assert.equal(controller.getState().generation, generation);
  const received = [];
  controller.subscribe((state) => received.push(state.generation));
  controller.reset();
  assert.equal(controller.getState().generation, generation + 1);
  assert.equal(received.at(-1), generation + 1);
});

test('prepare is synchronous and freezes values, changes and edit revisions without writing', async () => {
  const { controller, writes } = await fixture({ initial: { layout: { width: 1920 }, color: '#ffffff' } });
  controller.edit({ layout: { width: 1280 } });
  const prepared = controller.prepareSave();
  assert.equal(prepared.valid, true);
  assert.equal(prepared.changed, true);
  assert.equal(prepared.error, '');
  assert.equal(writes.length, 0);
  assert.equal(controller.getState().saving, false);
  controller.edit({ layout: { width: 1080 }, color: '#123456' });
  const saving = prepared.commit();
  assert.equal(prepared.commit(), saving);
  assert.equal(controller.save(), saving);
  assert.deepEqual(plain(writes[0].draft), { layout: { width: 1280 }, color: '#ffffff' });
  assert.deepEqual(plain(writes[0].changed), { layout: { width: 1280 } });
  controller.edit({ layout: { width: 720 } });
  writes[0].resolve(writes[0].draft);
  assert.equal(await saving, true);
  assert.deepEqual(plain(controller.getState().draft), { layout: { width: 720 }, color: '#123456' });
  assert.equal(await prepared.commit(), true);
  assert.equal(writes.length, 1);
});

test('prepare rejects unloaded and saving controllers and skips clean configurations', async () => {
  const { controller, writes } = await fixture({ read: async () => ({ fontSize: 24, color: '#ffffff' }) });
  controller.edit({ fontSize: 28 });
  const unloaded = controller.prepareSave();
  assert.equal(unloaded.valid, false);
  assert.match(unloaded.error, /读取/);
  assert.equal(await unloaded.commit(), false);
  assert.equal(writes.length, 0);
  await controller.reload();
  const prepared = controller.prepareSave();
  const saving = prepared.commit();
  const busy = controller.prepareSave();
  assert.equal(busy.valid, false);
  assert.match(busy.error, /正在保存/);
  assert.equal(await busy.commit(), false);
  assert.equal(writes.length, 1);
  writes[0].resolve(writes[0].draft);
  await saving;
  const clean = controller.prepareSave();
  assert.equal(clean.valid, true);
  assert.equal(clean.changed, false);
  controller.edit({ fontSize: 36 });
  assert.equal(await clean.commit(), false);
  assert.equal(writes.length, 1);
});

test('reset prevents an old prepared commit from writing into either account', async () => {
  const { controller, writes } = await fixture();
  controller.edit({ fontSize: 28 });
  const prepared = controller.prepareSave();
  controller.reset({ fontSize: 40, color: '#222222' });
  controller.receive({ fontSize: 40, color: '#222222' });
  controller.edit({ fontSize: 44 });
  assert.equal(await prepared.commit(), false);
  assert.equal(writes.length, 0);
  assert.equal(controller.getState().draft.fontSize, 44);
  const saving = controller.save();
  writes[0].resolve(writes[0].draft);
  assert.equal(await saving, true);
});

test('validation returns concrete errors without writes and save retains invalid drafts', async () => {
  let mode = 'string';
  const seen = [];
  const { controller, writes } = await fixture({
    validate(draft) {
      seen.push(plain(draft));
      draft.fontSize = 999;
      if (mode === 'string') return '请填写字号。';
      if (mode === 'throw') throw new Error('参数面板无效。');
    },
  });
  controller.edit({ fontSize: 28 });
  assert.equal(controller.prepareSave().error, '请填写字号。');
  assert.equal(writes.length, 0);
  assert.equal(controller.getState().error, '');
  mode = 'throw';
  assert.equal(await controller.save(), false);
  assert.equal(controller.getState().error, '参数面板无效。');
  assert.equal(controller.getState().draft.fontSize, 28);
  mode = 'valid';
  const saving = controller.save();
  assert.equal(writes[0].draft.fontSize, 28);
  assert.ok(seen.every((draft) => draft.fontSize === 28));
  writes[0].resolve(writes[0].draft);
  assert.equal(await saving, true);
});

test('synchronous persistence errors and non-Error rejections settle and allow retries', async () => {
  let attempts = 0;
  const { controller } = await fixture({
    persist(draft) {
      attempts += 1;
      if (attempts === 1) throw new Error('同步失败');
      if (attempts === 2) return Promise.reject(null);
      return draft;
    },
  });
  controller.edit({ fontSize: 28 });
  assert.equal(await controller.save(), false);
  assert.equal(controller.getState().error, '同步失败');
  assert.equal(controller.getState().saving, false);
  assert.equal(await controller.save(), false);
  assert.match(controller.getState().error, /保存失败/);
  assert.equal(controller.getState().dirty, true);
  assert.equal(await controller.save(), true);
});

test('saving notifications see the pending promise and reset can cancel before persistence', async () => {
  const { controller, writes } = await fixture();
  let reentrant;
  const unsubscribe = controller.subscribe((state) => {
    if (state.saving) reentrant = controller.save();
  });
  controller.edit({ fontSize: 28 });
  const saving = controller.save();
  assert.equal(reentrant, saving);
  writes[0].resolve(writes[0].draft);
  await saving;
  unsubscribe();
  controller.subscribe((state) => {
    if (state.saving) controller.reset();
  });
  controller.edit({ fontSize: 32 });
  assert.equal(await controller.save(), false);
  assert.equal(writes.length, 1);
  assert.equal(controller.getState().loaded, false);
});
