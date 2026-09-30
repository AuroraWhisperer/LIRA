'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');

const admin = path.join(__dirname, '../../public/js/admin');
const plain = (value) => JSON.parse(JSON.stringify(value));

async function fixture(options = {}) {
  const { createComponentConfigController } = await loadModuleExports(path.join(admin, 'component-config-controller.js'));
  const { createComponentSaveBatch } = await loadModuleExports(path.join(admin, 'component-save-batch.js'));
  const writes = [];
  const entries = ['clock', 'queue', 'overtime'].map((id) => ({
    id,
    title: id,
    controller: createComponentConfigController({
      initial: { size: 24, color: '#ffffff' },
      persist: (draft, changed) => {
        options.onWrite?.(id, entries);
        return new Promise((resolve, reject) => writes.push({ id, draft, changed, resolve, reject }));
      },
      ...options.controllers?.[id],
    }),
    validate: options.validators?.[id],
  }));
  return { entries, writes, batch: createComponentSaveBatch(entries) };
}

function editAll(entries) {
  for (const { controller } of entries) controller.edit({ size: 28 });
}

test('all component snapshots freeze before any notification or business write', async () => {
  const { entries, writes, batch } = await fixture({
    onWrite(id, owners) {
      if (id === 'clock') owners[1].controller.edit({ size: 40 });
    },
  });
  editAll(entries);
  let notified = false;
  batch.subscribe((state) => {
    if (!notified && state.clock.status === 'saving') {
      notified = true;
      entries[2].controller.edit({ color: '#123456' });
    }
  });
  const saving = batch.save();
  assert.equal(writes.length, 3);
  for (const write of writes) {
    assert.deepEqual(plain(write.draft), { size: 28, color: '#ffffff' });
    assert.deepEqual(plain(write.changed), { size: 28 });
    write.resolve(write.draft);
  }
  const result = await saving;
  assert.ok(Object.values(result).every(({ status }) => status === 'success'));
  assert.equal(entries[1].controller.getState().draft.size, 40);
  assert.equal(entries[2].controller.getState().draft.color, '#123456');
  assert.equal(entries[0].controller.getState().dirty, false);
});

test('partial failure keeps successful writes and retry submits only failed components', async () => {
  const { entries, writes, batch } = await fixture();
  editAll(entries);
  const saving = batch.save();
  writes[0].resolve(writes[0].draft);
  writes[1].reject(new Error('点歌板未确认保存。'));
  writes[2].resolve(writes[2].draft);
  const result = await saving;
  assert.equal(result.clock.status, 'success');
  assert.deepEqual(plain(result.queue), { status: 'failed', error: '点歌板未确认保存。' });
  assert.equal(result.overtime.status, 'success');
  assert.equal(entries[1].controller.getState().saved.size, 24);
  assert.equal(entries[1].controller.getState().draft.size, 28);
  entries[0].controller.edit({ size: 32 });
  entries[1].controller.edit({ size: 36 });
  const retry = batch.retryFailed();
  assert.equal(writes.length, 4);
  assert.equal(writes[3].id, 'queue');
  assert.equal(writes[3].draft.size, 36);
  writes[3].resolve(writes[3].draft);
  assert.equal((await retry).queue.status, 'success');
  assert.equal(entries[0].controller.getState().dirty, true);
  await batch.retryFailed();
  assert.equal(writes.length, 4);
});

test('preflight checks every target and any validation error causes zero business writes', async () => {
  const checked = [];
  const { entries, writes, batch } = await fixture({
    validators: {
      clock: () => '请填写时钟标题。',
      queue: () => { throw new Error('点歌板参数无效。'); },
    },
  });
  editAll(entries);
  for (const entry of entries) {
    const prepare = entry.controller.prepareSave;
    entry.controller.prepareSave = () => {
      checked.push(entry.id);
      return prepare();
    };
  }
  const saving = batch.save();
  assert.deepEqual(checked, ['clock', 'queue', 'overtime']);
  assert.equal(writes.length, 0);
  const result = await saving;
  assert.deepEqual(plain(result), {
    clock: { status: 'failed', error: '请填写时钟标题。' },
    queue: { status: 'failed', error: '点歌板参数无效。' },
    overtime: { status: 'not-submitted', error: '' },
  });
  assert.ok(entries.every(({ controller }) => controller.getState().dirty));
});

test('controller validation, unloaded state and active saves block the entire preflight', async () => {
  for (const mode of ['invalid', 'unloaded', 'saving']) {
    const { entries, writes, batch } = await fixture({
      controllers: {
        queue: mode === 'invalid' ? { validate: () => '字号无效。' }
          : mode === 'unloaded' ? { read: async () => ({ size: 24 }) } : {},
      },
    });
    editAll(entries);
    const prior = mode === 'saving' ? entries[1].controller.save() : null;
    const previousWrites = writes.length;
    const result = await batch.save();
    assert.equal(result.queue.status, 'failed', mode);
    assert.equal(result.clock.status, 'not-submitted', mode);
    assert.equal(result.overtime.status, 'not-submitted', mode);
    assert.equal(writes.length, previousWrites, mode);
    if (prior) {
      writes[0].resolve(writes[0].draft);
      await prior;
    }
  }
});

test('explicit selection skips clean components while default selection saves only dirty ones', async () => {
  const { entries, writes, batch } = await fixture();
  entries[0].controller.edit({ size: 28 });
  entries[2].controller.edit({ size: 32 });
  const selected = batch.save(['clock', 'queue']);
  assert.equal(writes.length, 1);
  assert.equal(batch.getState().queue.status, 'skipped');
  assert.equal(batch.getState().overtime.status, 'idle');
  writes[0].resolve(writes[0].draft);
  await selected;
  const remaining = batch.save();
  assert.equal(writes.length, 2);
  assert.equal(writes[1].id, 'overtime');
  writes[1].resolve(writes[1].draft);
  await remaining;
  await batch.save();
  assert.equal(writes.length, 2);
});

test('pending calls including reentrant subscriptions share the same promise', async () => {
  const { entries, writes, batch } = await fixture();
  editAll(entries);
  let reentrant;
  batch.subscribe((state) => {
    if (state.clock.status === 'saving') reentrant = batch.save();
  });
  const saving = batch.save();
  assert.equal(reentrant, saving);
  assert.equal(batch.save(['queue']), saving);
  assert.equal(batch.retryFailed(), saving);
  writes[0].resolve(writes[0].draft);
  await Promise.resolve();
  assert.equal(batch.save(), saving);
  writes[1].reject(new Error('失败'));
  writes[2].resolve(writes[2].draft);
  await saving;
  assert.equal(writes.length, 3);
});

test('reset after preparation prevents the old snapshot from being submitted', async () => {
  const { entries, writes, batch } = await fixture({
    onWrite(id, owners) {
      if (id !== 'clock') return;
      owners[1].controller.reset({ size: 48, color: '#222222' });
      owners[1].controller.receive({ size: 48, color: '#222222' });
      owners[1].controller.edit({ size: 52 });
    },
  });
  editAll(entries);
  const saving = batch.save();
  assert.deepEqual(writes.map(({ id }) => id), ['clock', 'overtime']);
  for (const write of writes) write.resolve(write.draft);
  const result = await saving;
  assert.equal(result.queue.status, 'idle');
  assert.equal(entries[1].controller.getState().saved.size, 48);
  assert.equal(entries[1].controller.getState().draft.size, 52);
});

test('reset during a batch invalidates old responses and retains new account state', async () => {
  const { entries, writes, batch } = await fixture();
  editAll(entries);
  const saving = batch.save();
  for (const { controller } of entries) {
    controller.reset({ size: 48, color: '#222222' });
    controller.receive({ size: 48, color: '#222222' });
  }
  for (const write of writes) write.resolve(write.draft);
  const result = await saving;
  assert.ok(Object.values(result).every(({ status }) => status === 'idle'));
  assert.ok(entries.every(({ controller }) => controller.getState().saved.size === 48));
});

test('reset clears only that component failure and cannot retry its new account draft', async () => {
  const { entries, writes, batch } = await fixture();
  editAll(entries);
  const saving = batch.save();
  writes[0].reject(new Error('旧账号时钟失败'));
  writes[1].reject(new Error('点歌板失败'));
  writes[2].resolve(writes[2].draft);
  await saving;
  entries[0].controller.reset({ size: 48, color: '#222222' });
  entries[0].controller.receive({ size: 48, color: '#222222' });
  entries[0].controller.edit({ size: 52 });
  assert.deepEqual(plain(batch.getState().clock), { status: 'idle', error: '' });
  assert.equal(batch.getState().queue.status, 'failed');
  const retry = batch.retryFailed();
  assert.equal(writes.length, 4);
  assert.equal(writes[3].id, 'queue');
  writes[3].resolve(writes[3].draft);
  await retry;
  assert.equal(entries[0].controller.getState().dirty, true);
});

test('reset releases obsolete pending saves and late failures cannot replace new account results', { timeout: 2000 }, async () => {
  const { entries, writes, batch } = await fixture();
  const controller = entries[0].controller;
  controller.edit({ size: 28 });
  const oldSave = batch.save(['clock']);
  controller.reset({ size: 48, color: '#222222' });
  controller.receive({ size: 48, color: '#222222' });
  controller.edit({ size: 52 });
  const oldResult = await oldSave;
  assert.equal(oldResult.clock.status, 'idle');
  const newSave = batch.save(['clock']);
  assert.equal(writes.length, 2);
  assert.equal(batch.getState().clock.status, 'saving');
  writes[0].reject(new Error('迟到的旧账号失败'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(plain(batch.getState().clock), { status: 'saving', error: '' });
  assert.equal(controller.getState().saving, true);
  writes[1].resolve(writes[1].draft);
  assert.equal((await newSave).clock.status, 'success');
  assert.equal(controller.getState().saved.size, 52);
});

test('dispose removes controller subscriptions and ignores late saves without starting new writes', { timeout: 2000 }, async () => {
  const { createComponentConfigController } = await loadModuleExports(path.join(admin, 'component-config-controller.js'));
  const { createComponentSaveBatch } = await loadModuleExports(path.join(admin, 'component-save-batch.js'));
  let finishWrite;
  const controller = createComponentConfigController({ initial: { size: 24 },
    persist: (draft) => new Promise((resolve) => { finishWrite = () => resolve(draft); }) });
  let subscriptions = 0;
  const subscribe = controller.subscribe;
  controller.subscribe = (listener) => {
    subscriptions += 1;
    const unsubscribe = subscribe(listener);
    return () => { subscriptions -= 1; unsubscribe(); };
  };
  const batch = createComponentSaveBatch([{ id: 'clock', title: '时钟', controller }]);
  let notifications = 0;
  batch.subscribe(() => { notifications += 1; });
  controller.edit({ size: 28 });
  const saving = batch.save();
  assert.equal(subscriptions, 1);
  const before = notifications;
  batch.dispose();
  batch.dispose();
  assert.equal(subscriptions, 0);
  await saving;
  finishWrite();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.getState().saved.size, 28);
  assert.equal(notifications, before);
  controller.edit({ size: 32 });
  await batch.save();
  assert.equal(controller.getState().saving, false);
  assert.equal(controller.getState().dirty, true);
});

test('unexpected prepare and commit failures settle as per-component results', async () => {
  const { entries, writes, batch } = await fixture();
  editAll(entries);
  const original = entries[0].controller.prepareSave;
  entries[0].controller.prepareSave = () => { throw new Error('预检失败'); };
  assert.equal((await batch.save()).clock.error, '预检失败');
  assert.equal(writes.length, 0);
  entries[0].controller.prepareSave = original;
  entries[1].controller.prepareSave = () => ({
    valid: true, changed: true, error: '', commit: () => { throw new Error('同步提交失败'); },
  });
  entries[2].controller.prepareSave = () => ({
    valid: true, changed: true, error: '', commit: () => Promise.reject('异步提交失败'),
  });
  const saving = batch.save();
  writes[0].resolve(writes[0].draft);
  const result = await saving;
  assert.equal(result.clock.status, 'success');
  assert.equal(result.queue.error, '同步提交失败');
  assert.equal(result.overtime.error, '异步提交失败');
});

test('subscriptions and returned state are isolated and unsubscribing stops updates', async () => {
  const { entries, writes, batch } = await fixture();
  const updates = [];
  const unsubscribe = batch.subscribe((state) => {
    updates.push(plain(state));
    state.clock.status = 'modified';
  });
  assert.equal(updates.length, 1);
  assert.equal(batch.getState().clock.status, 'idle');
  entries[0].controller.edit({ size: 28 });
  const saving = batch.save();
  assert.equal(updates.at(-1).clock.status, 'saving');
  writes[0].resolve(writes[0].draft);
  const result = await saving;
  assert.equal(updates.at(-1).clock.status, 'success');
  result.clock.status = 'modified';
  assert.equal(batch.getState().clock.status, 'success');
  unsubscribe();
  const count = updates.length;
  await batch.save();
  assert.equal(updates.length, count);
});

test('saving another component preserves outstanding failures without retrying new successful edits', async () => {
  const { entries, writes, batch } = await fixture();
  editAll(entries);
  const first = batch.save();
  writes[0].reject(new Error('时钟失败'));
  writes[1].resolve(writes[1].draft);
  writes[2].resolve(writes[2].draft);
  await first;
  entries[1].controller.edit({ size: 32 });
  const second = batch.save(['queue']);
  writes[3].resolve(writes[3].draft);
  await second;
  assert.equal(batch.getState().clock.status, 'failed');
  assert.equal(batch.getState().queue.status, 'success');
  entries[1].controller.edit({ size: 36 });
  const retry = batch.retryFailed();
  assert.equal(writes[4].id, 'clock');
  assert.equal(writes.length, 5);
  writes[4].resolve(writes[4].draft);
  await retry;
  assert.equal(batch.getState().clock.status, 'success');
  assert.equal(entries[1].controller.getState().draft.size, 36);
  assert.equal(entries[1].controller.getState().saved.size, 32);
  assert.equal(entries[1].controller.getState().dirty, true);
  await batch.retryFailed();
  assert.equal(writes.length, 5);
});

test('a result listener failure cannot finish a batch before other writes settle', async () => {
  const { entries, writes, batch } = await fixture();
  editAll(entries);
  batch.subscribe((state) => {
    if (state.clock.status === 'success') throw new Error('视图已卸载');
  });
  const saving = batch.save();
  writes[0].resolve(writes[0].draft);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(batch.save(), saving);
  assert.equal(batch.getState().queue.status, 'saving');
  writes[1].resolve(writes[1].draft);
  writes[2].resolve(writes[2].draft);
  const result = await saving;
  assert.ok(Object.values(result).every(({ status }) => status === 'success'));
});

test('retry after failed preflight excludes components that were not submitted', async () => {
  let invalid = true;
  const { entries, writes, batch } = await fixture({
    validators: { clock: () => invalid ? '表单无效。' : '' },
  });
  editAll(entries);
  await batch.save();
  invalid = false;
  const retry = batch.retryFailed();
  assert.deepEqual(writes.map(({ id }) => id), ['clock']);
  writes[0].resolve(writes[0].draft);
  const result = await retry;
  assert.equal(result.clock.status, 'success');
  assert.equal(result.queue.status, 'not-submitted');
  assert.equal(result.overtime.status, 'not-submitted');
});
