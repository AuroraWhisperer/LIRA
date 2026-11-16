'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { createClock } = require('../helpers/toast-dom');
const entry = path.resolve(__dirname, '../../public/js/admin/settings-autosave.js');

async function fixture(save, canSave) {
  const { createAutosave } = await loadModuleExports(entry);
  const callbacks = new Map();
  let sequence = 0;
  const root = new EventTarget();
  const scheduler = createAutosave({ save, canSave, root, windowRef: {
    setTimeout(fn) { callbacks.set(++sequence, fn); return sequence; },
    clearTimeout(id) { callbacks.delete(id); },
  } });
  const run = async () => {
    const tasks = [...callbacks.values()];
    callbacks.clear();
    tasks.forEach(fn => fn());
    for (let index = 0; index < 8; index++) await Promise.resolve();
  };
  return { scheduler, root, run, callbacks };
}

test('autosave coalesces typing, waits for composition and serializes newer edits', async () => {
  let value = '', finish;
  const writes = [];
  const { scheduler, root, run } = await fixture(() => {
    writes.push(value);
    return new Promise(resolve => { finish = resolve; });
  });
  root.dispatchEvent(new Event('compositionstart'));
  value = '拼'; scheduler.schedule();
  value = '拼音输入'; scheduler.schedule();
  await run();
  assert.equal(writes.length, 0);
  root.dispatchEvent(new Event('compositionend'));
  await run();
  assert.deepEqual(writes, ['拼音输入']);
  value = '后续输入'; scheduler.schedule();
  await run();
  assert.equal(writes.length, 1);
  finish(true);
  for (let index = 0; index < 8; index++) await Promise.resolve();
  await run();
  assert.deepEqual(writes, ['拼音输入', '后续输入']);
  finish(true);
  scheduler.dispose();
});

test('invalid drafts wait for readiness, failures stop and account cancellation drops queued work', async () => {
  let valid = false, calls = 0;
  const { scheduler, root, run, callbacks } = await fixture(async () => {
    calls++;
    throw new Error('offline');
  }, () => valid);
  scheduler.schedule();
  await run();
  assert.equal(calls, 0);
  valid = true; scheduler.resume();
  await run();
  assert.equal(calls, 1);
  assert.equal(callbacks.size, 0);
  scheduler.schedule(); scheduler.cancel();
  await run();
  assert.equal(calls, 1);
  scheduler.schedule(); scheduler.dispose();
  root.dispatchEvent(new Event('compositionend'));
  await run();
  assert.equal(calls, 1);
});

test('component autosave persists a reverted edit after an in-flight acknowledgment and cancels an old account draft', async () => {
  const { bindComponentAutosave } = await loadModuleExports(entry);
  const { createComponentConfigController } = await loadModuleExports(path.resolve(__dirname, '../../public/js/admin/component-config-controller.js'));
  const clock = createClock(), writes = [];
  const controller = createComponentConfigController({ initial: { size: 24 },
    persist: value => new Promise(resolve => writes.push({ value, resolve })) });
  const root = new EventTarget();
  root.querySelectorAll = () => [{ type: 'number', value: '', checkValidity: () => true,
    dataset: { autosaveOptional: 'true' } }];
  const binding = bindComponentAutosave(controller, { root, windowRef: clock });
  controller.edit({ size: 40 });
  clock.tick(600);
  controller.edit({ size: 24 });
  writes[0].resolve({ size: 40 });
  for (let index = 0; index < 12; index++) await Promise.resolve();
  clock.tick(600);
  assert.equal(writes[1].value.size, 24);
  writes[1].resolve({ size: 24 });
  for (let index = 0; index < 12; index++) await Promise.resolve();
  controller.edit({ size: 60 });
  controller.reset({ size: 18 });
  clock.tick(600);
  assert.equal(writes.length, 2);
  binding.dispose();
});

test('canvas edits remain drafts until publication while desktop edits still autosave', async () => {
  const { bindComponentAutosave } = await loadModuleExports(entry);
  const { createComponentConfigController } = await loadModuleExports(path.resolve(__dirname, '../../public/js/admin/component-config-controller.js'));
  const clock = createClock(), writes = [];
  const controller = createComponentConfigController({ initial: { size: 24 }, read: async () => ({ size: 24 }),
    persist: async value => { writes.push(value); return value; } });
  const root = new EventTarget();
  root.querySelectorAll = () => [];
  const binding = bindComponentAutosave(controller, { root, windowRef: clock });
  await controller.reload();
  controller.edit({ size: 40 }, { source: 'preview' });
  await controller.reload();
  clock.tick(1000);
  assert.equal(writes.length, 0);
  assert.equal(controller.getState().draft.size, 40);
  await controller.save();
  assert.equal(writes[0].size, 40);
  controller.edit({ size: 50 });
  clock.tick(600);
  for (let index = 0; index < 12; index++) await Promise.resolve();
  assert.equal(writes[1].size, 50);
  binding.dispose();
});
