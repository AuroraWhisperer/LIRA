'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const admin = path.resolve(__dirname, '../../public/js/admin');
const key = 'a'.repeat(64);

async function fixture() {
  const drafts = await loadModuleExports(path.join(admin, 'component-preview-drafts.js'));
  const { createComponentConfigController } = await loadModuleExports(path.join(admin, 'component-config-controller.js'));
  const values = new Map();
  let writes = 0;
  let saves = 0;
  const storage = { getItem: name => values.get(name) || null, setItem(name, value) { values.set(name, value); writes++; } };
  const controller = initial => createComponentConfigController({ initial, persist: async draft => { saves++; return draft; } });
  const recover = (current, draftKey = key) => drafts.createPreviewDraftRecovery({ key: draftKey,
    connections: [{ component: 'clock', controller: current }], storage });
  return { ...drafts, storage, controller, recover, values, writes: () => writes, saves: () => saves };
}

test('reopening restores unsaved fields without saving and leaves unchanged fields current', async () => {
  const f = await fixture();
  const first = f.controller({ label: 'saved', size: 12 });
  const previous = f.recover(first);
  first.edit({ label: 'unfinished' });
  previous.dispose();
  const current = f.controller({ label: 'saved', size: 20 });
  const restored = f.recover(current);
  assert.equal(current.getState().draft.label, 'unfinished');
  assert.equal(current.getState().draft.size, 20);
  assert.equal(current.getState().saved.label, 'saved');
  assert.equal(current.getState().dirty, true);
  assert.equal(f.saves(), 0);
  assert.match(restored.getState().message, /已恢复.*未保存/);
  const writes = f.writes();
  current.edit({ label: 'unfinished' });
  assert.equal(f.writes(), writes, 'Identical notifications must not rewrite storage.');
  const raw = [...f.values.values()][0];
  assert.deepEqual(Object.keys(JSON.parse(raw).components.clock).sort(), ['draft', 'saved']);
  restored.dispose();
});

test('newer saved values and desktop drafts require an explicit recovery choice', async () => {
  for (const changedSaved of [true, false]) {
    const f = await fixture();
    const first = f.controller({ label: 'saved' });
    const previous = f.recover(first);
    first.edit({ label: 'cached' });
    previous.dispose();
    const current = f.controller({ label: changedSaved ? 'newer' : 'saved' });
    if (!changedSaved) current.edit({ label: 'newer' });
    const next = f.recover(current);
    assert.equal(next.getState().pending, true);
    assert.equal(current.getState().draft.label, 'newer');
    assert.equal(f.readPreviewDraft(key, f.storage).components.clock.draft.label, 'cached');
    next.restore();
    assert.equal(next.getState().pending, false);
    assert.equal(current.getState().draft.label, 'cached');
    assert.equal(current.getState().dirty, true);
    assert.equal(f.saves(), 0);
    next.dispose();
  }
});

test('a draft already retained by the desktop does not require recovery when its saved baseline changes', async () => {
  const f = await fixture();
  const first = f.controller({ label: 'saved' });
  const previous = f.recover(first);
  first.edit({ label: 'cached' });
  previous.dispose();
  const current = f.controller({ label: 'newer saved' });
  current.edit({ label: 'cached' });
  const recovery = f.recover({ ...current, edit() { assert.fail('The desktop already has this draft.'); } });
  assert.equal(recovery.getState().pending, false);
  assert.equal(current.getState().draft.label, 'cached');
  assert.equal(current.getState().saved.label, 'newer saved');
  assert.equal(current.getState().dirty, true);
  assert.equal(f.saves(), 0);
  recovery.dispose();
});

test('using current settings, discard and successful save do not revive old work', async () => {
  for (const action of ['useCurrent', 'discard', 'save']) {
    const f = await fixture();
    const first = f.controller({ label: 'saved' });
    const previous = f.recover(first);
    first.edit({ label: 'cached' });
    if (action === 'discard') first.discard();
    if (action === 'save') await first.save();
    previous.dispose();
    const current = f.controller({ label: action === 'save' ? 'cached' : action === 'useCurrent' ? 'newer' : 'saved' });
    const next = f.recover(current);
    if (action === 'useCurrent') next.useCurrent();
    next.dispose();
    const reopened = f.controller(current.getState().saved);
    const recovery = f.recover(reopened);
    assert.equal(reopened.getState().dirty, false);
    assert.equal(recovery.getState().pending, false);
    recovery.dispose();
  }
});

test('different recovery identities never restore another account or scene', async () => {
  const f = await fixture();
  const first = f.controller({ label: 'saved' });
  const previous = f.recover(first);
  first.edit({ label: 'private draft' });
  previous.dispose();
  const other = f.controller({ label: 'other account' });
  const next = f.recover(other, 'b'.repeat(64));
  assert.equal(other.getState().draft.label, 'other account');
  assert.equal(other.getState().dirty, false);
  assert.equal(f.readPreviewDraft(key, f.storage).components.clock.draft.label, 'private draft');
  next.dispose();
});

test('unavailable or invalid browser storage does not interrupt editing', async () => {
  const f = await fixture();
  const current = f.controller({ label: 'saved' });
  const storage = { getItem() { throw new Error('disabled'); }, setItem() { throw new Error('full'); } };
  const recovery = f.createPreviewDraftRecovery({ key, connections: [{ component: 'clock', controller: current }], storage });
  current.edit({ label: 'still editing' });
  assert.equal(current.getState().draft.label, 'still editing');
  assert.match(recovery.getState().message, /无法保留本地恢复草稿/);
  assert.equal(f.readPreviewDraft(key, { getItem: () => '{invalid' }), null);
  assert.equal(f.readPreviewDraft(key, { getItem: () => '{"schemaVersion":1,"components":{"clock":null}}' }), null);
  recovery.dispose();
});

test('unloaded owners preserve old snapshots while ready and disconnected owners retain new edits', async () => {
  const f = await fixture();
  const clock = f.controller({ label: 'saved' });
  const queue = f.controller({ style: 'saved' });
  const connections = [{ component: 'clock', controller: clock }, { component: 'queue', controller: queue }];
  let recovery = f.createPreviewDraftRecovery({ key, connections, storage: f.storage });
  queue.edit({ style: 'cached' });
  recovery.dispose();
  queue.reset({ style: 'saved' });
  recovery = f.createPreviewDraftRecovery({ key, connections, storage: f.storage });
  clock.edit({ label: 'new work' });
  let snapshot = f.readPreviewDraft(key, f.storage);
  assert.equal(snapshot.components.clock.draft.label, 'new work');
  assert.equal(snapshot.components.queue.draft.style, 'cached');
  assert.equal(queue.getState().draft.style, 'saved', 'Do not edit an uninitialized controller.');
  queue.receive({ style: 'saved' });
  assert.equal(queue.getState().draft.style, 'cached', 'Restore after readiness, before persisting defaults.');
  recovery.dispose();

  const { createRemotePreviewController } = await loadModuleExports(path.join(admin, 'component-preview-remote.js'), { structuredClone });
  const remote = createRemotePreviewController({ generation: 0, loaded: true, saved: { label: 'saved' }, draft: { label: 'saved' } },
    async () => { throw new Error('expired'); });
  recovery = f.createPreviewDraftRecovery({ key: 'b'.repeat(64), connections: [{ component: 'clock', controller: remote }], storage: f.storage });
  await remote.edit({ label: 'unconfirmed' });
  assert.equal(remote.getState().loaded, false);
  recovery.dispose();
  snapshot = f.readPreviewDraft('b'.repeat(64), f.storage);
  assert.equal(snapshot.components.clock.draft.label, 'unconfirmed');
});

test('a delayed owner with changed saved values requires recovery choice without blocking other persistence', async () => {
  const f = await fixture();
  const clock = f.controller({ label: 'saved' });
  const first = f.recover(clock);
  clock.edit({ label: 'cached' });
  first.dispose();
  clock.reset({ label: 'initial' });
  const queue = f.controller({ style: 'saved' });
  const recovery = f.createPreviewDraftRecovery({ key, storage: f.storage,
    connections: [{ component: 'clock', controller: clock }, { component: 'queue', controller: queue }] });
  clock.receive({ label: 'changed elsewhere' });
  assert.equal(recovery.getState().pending, true);
  queue.edit({ style: 'new work' });
  const snapshot = f.readPreviewDraft(key, f.storage);
  assert.equal(snapshot.components.clock.draft.label, 'cached');
  assert.equal(snapshot.components.queue.draft.style, 'new work');
  recovery.restore();
  assert.equal(clock.getState().draft.label, 'cached');
  recovery.dispose();
});
