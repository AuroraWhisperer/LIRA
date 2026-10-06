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
  const recoverCanvas = current => drafts.createPreviewDraftRecovery({ key,
    connections: [{ component: 'canvas', controller: current }], storage });
  return { ...drafts, storage, controller, recover, recoverCanvas, values, writes: () => writes, saves: () => saves };
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

const browserItem = (url, overrides = {}) => ({ id: '00000000-0000-4000-8000-000000000001', type: 'browser',
  name: '外部网页', x: 0, y: 0, width: 800, height: 600, visible: true, locked: false,
  appearance: { mode: 'independent', config: { url, viewportWidth: 800, viewportHeight: 600 } }, ...overrides });
const canvas = (...items) => ({ document: { schemaVersion: 1, id: '00000000-0000-4000-8000-000000000002',
  title: '浏览器源草稿', canvas: { width: 1920, height: 1080 }, items } });
const plain = value => JSON.parse(JSON.stringify(value));

test('browser recovery storage and reads remove URLs from both saved and draft without mutating live state', async () => {
  const f = await fixture();
  const savedUrl = 'https://provider.example/saved?token=saved-capability';
  const draftUrl = 'https://provider.example/draft?token=draft-capability';
  const first = f.controller(canvas(browserItem(savedUrl)));
  const recovery = f.recoverCanvas(first);
  first.edit(canvas(browserItem(draftUrl, { x: 80, width: 960 })));
  const snapshot = JSON.parse([...f.values.values()][0]);
  assert.deepEqual(snapshot.components.canvas, {
    saved: canvas(browserItem('')), draft: canvas(browserItem('', { x: 80, width: 960 })),
    browserUrlsChanged: true,
  });
  assert.equal(first.getState().saved.document.items[0].appearance.config.url, savedUrl);
  assert.equal(first.getState().draft.document.items[0].appearance.config.url, draftUrl);
  assert.equal([...f.values.values()][0].includes('capability'), false);
  assert.equal([...f.values.values()][0].includes('provider.example'), false);
  recovery.dispose();

  snapshot.components.canvas.saved.document.items[0].appearance.config.url = savedUrl;
  snapshot.components.canvas.draft.document.items[0].appearance.config.url = draftUrl;
  const read = f.readPreviewDraft(key, { getItem: () => JSON.stringify(snapshot) });
  assert.equal(read.components.canvas.saved.document.items[0].appearance.config.url, '');
  assert.equal(read.components.canvas.draft.document.items[0].appearance.config.url, '');
  assert.equal(read.components.canvas.draft.document.items[0].width, 960);
  for (const value of ['true', 1, null, {}]) {
    snapshot.components.canvas.browserUrlsChanged = value;
    assert.equal(f.readPreviewDraft(key, { getItem: () => JSON.stringify(snapshot) }), null);
  }
});

test('a saved browser source reopens cleanly without a URL recovery warning', async () => {
  const f = await fixture();
  const first = f.controller(canvas());
  const previous = f.recoverCanvas(first);
  first.edit(canvas(browserItem('https://provider.example/source?token=saved')));
  assert.equal(f.readPreviewDraft(key, f.storage).components.canvas.browserUrlsChanged, true);
  await first.save();
  assert.equal(f.readPreviewDraft(key, f.storage).components.canvas.browserUrlsChanged, false);
  previous.dispose();
  const current = f.controller(first.getState().saved);
  const recovery = f.recoverCanvas(current);
  assert.equal(current.getState().dirty, false);
  assert.equal(recovery.getState().pending, false);
  assert.equal(recovery.getState().message, '');
  recovery.dispose();
});

test('a browser geometry-only draft restores without requesting its unchanged URL again', async () => {
  const f = await fixture();
  const url = 'https://provider.example/source?token=saved';
  const first = f.controller(canvas(browserItem(url)));
  const previous = f.recoverCanvas(first);
  first.edit(canvas(browserItem(url, { width: 960 })));
  assert.equal(f.readPreviewDraft(key, f.storage).components.canvas.browserUrlsChanged, false);
  previous.dispose();
  const current = f.controller(canvas(browserItem(url)));
  const recovery = f.recoverCanvas(current);
  assert.equal(current.getState().draft.document.items[0].width, 960);
  assert.equal(current.getState().draft.document.items[0].appearance.config.url, url);
  assert.match(recovery.getState().message, /已恢复.*未保存/);
  assert.doesNotMatch(recovery.getState().message, /网址|重新填写/);
  recovery.dispose();
});

test('browser geometry restores with current authorized URLs and ignores URL changes when finding conflicts', async () => {
  const f = await fixture();
  const first = f.controller(canvas(browserItem('https://provider.example/old')));
  const previous = f.recoverCanvas(first);
  first.edit(canvas(browserItem('https://provider.example/unsaved?token=private', { x: 80, width: 960 })));
  previous.dispose();
  const currentUrl = 'https://provider.example/current?token=rotated';
  const current = f.controller(canvas(browserItem(currentUrl)));
  const recovery = f.recoverCanvas(current);
  assert.equal(recovery.getState().pending, false);
  assert.deepEqual(plain(current.getState().draft), canvas(browserItem(currentUrl, { x: 80, width: 960 })));
  assert.deepEqual(plain(current.getState().saved), canvas(browserItem(currentUrl)));
  assert.equal(current.getState().dirty, true);
  assert.equal(f.saves(), 0);
  assert.match(recovery.getState().message, /已恢复.*未保存/);
  assert.match(recovery.getState().message, /网址.*重新填写/);
  recovery.dispose();
});

test('browser URL-only drafts reopen with saved URLs without an artificial edit, conflict or dirty state', async () => {
  const f = await fixture();
  const saved = canvas(browserItem('https://provider.example/saved?token=saved'));
  const first = f.controller(saved);
  const previous = f.recoverCanvas(first);
  first.edit(canvas(browserItem('https://provider.example/unsaved?token=unsaved')));
  previous.dispose();
  const current = f.controller(saved);
  const recovery = f.recoverCanvas({ ...current, edit() { assert.fail('Redacted URLs are not recoverable edits.'); } });
  assert.equal(current.getState().dirty, false);
  assert.equal(recovery.getState().pending, false);
  assert.deepEqual(plain(current.getState().draft), saved);
  assert.match(recovery.getState().message, /未保存的浏览器源网址修改需重新填写/);
  current.edit(canvas(browserItem('https://provider.example/reentered')));
  assert.doesNotMatch(recovery.getState().message, /重新填写/);
  recovery.dispose();
});

test('unsaved new browser sources recover as empty URL placeholders with their geometry and viewport intact', async () => {
  const f = await fixture();
  const first = f.controller(canvas());
  const previous = f.recoverCanvas(first);
  const item = browserItem('https://provider.example/new?token=private', { x: 40, y: 80, width: 640, height: 360 });
  item.appearance.config.viewportWidth = 1920;
  item.appearance.config.viewportHeight = 1080;
  first.edit(canvas(item));
  previous.dispose();
  const current = f.controller(canvas());
  const recovery = f.recoverCanvas(current);
  item.appearance.config.url = '';
  assert.deepEqual(plain(current.getState().draft), canvas(item));
  assert.equal(current.getState().dirty, true);
  assert.equal(recovery.getState().pending, false);
  assert.equal(f.saves(), 0);
  assert.match(recovery.getState().message, /缺少网址.*重新填写/);
  assert.equal(f.readPreviewDraft(key, f.storage).components.canvas.browserUrlsChanged, false);
  recovery.dispose();
  const reopened = f.recoverCanvas(f.controller(canvas()));
  assert.match(reopened.getState().message, /缺少网址.*重新填写/);
  reopened.dispose();
});

test('browser recovery preserves URL edits already held by the desktop and does not reapply a retained document', async () => {
  for (const retainedGeometry of [false, true]) {
    const f = await fixture();
    const savedUrl = 'https://provider.example/saved';
    const currentUrl = 'https://provider.example/current-draft?token=in-memory';
    const first = f.controller(canvas(browserItem(savedUrl)));
    const previous = f.recoverCanvas(first);
    first.edit(canvas(browserItem('https://provider.example/old-draft', { width: 960 })));
    previous.dispose();
    const current = f.controller(canvas(browserItem(savedUrl)));
    current.edit(canvas(browserItem(currentUrl, { width: retainedGeometry ? 960 : 800 })));
    let edits = 0;
    const recovery = f.recoverCanvas({ ...current, edit(change) { edits++; current.edit(change); } });
    assert.equal(recovery.getState().pending, false);
    assert.equal(current.getState().draft.document.items[0].appearance.config.url, currentUrl);
    assert.equal(current.getState().draft.document.items[0].width, 960);
    assert.equal(edits, retainedGeometry ? 0 : 1);
    assert.doesNotMatch(recovery.getState().message, /重新填写/);
    assert.equal(f.saves(), 0);
    recovery.dispose();
  }
});

test('recovered browser URLs follow item identities when a layout draft reorders sources', async () => {
  const f = await fixture();
  const secondId = '00000000-0000-4000-8000-000000000003';
  const first = f.controller(canvas(browserItem('https://first.example/old'),
    browserItem('https://second.example/old', { id: secondId })));
  const previous = f.recoverCanvas(first);
  first.edit(canvas(browserItem('https://second.example/unsaved', { id: secondId }),
    browserItem('https://first.example/unsaved')));
  previous.dispose();
  const current = f.controller(canvas(browserItem('https://first.example/current'),
    browserItem('https://second.example/current', { id: secondId })));
  const recovery = f.recoverCanvas(current);
  assert.equal(recovery.getState().pending, false);
  assert.deepEqual(plain(current.getState().draft), canvas(browserItem('https://second.example/current', { id: secondId }),
    browserItem('https://first.example/current')));
  recovery.dispose();
});

test('non-URL browser document changes still need a recovery choice and restore uses the latest desktop URL', async () => {
  for (const changedSaved of [true, false]) {
    const f = await fixture();
    const saved = canvas(browserItem('https://provider.example/saved'));
    const first = f.controller(saved);
    const previous = f.recoverCanvas(first);
    first.edit(canvas(browserItem('https://provider.example/old-draft', { width: 960 })));
    previous.dispose();
    const newer = canvas(browserItem('https://provider.example/current', { width: 700 }));
    const current = f.controller(changedSaved ? newer : saved);
    if (!changedSaved) current.edit(newer);
    const recovery = f.recoverCanvas(current);
    assert.equal(recovery.getState().pending, true);
    assert.equal(current.getState().draft.document.items[0].width, 700);
    current.edit(canvas(browserItem('https://provider.example/latest?token=current', { width: 700 })));
    recovery.restore();
    assert.equal(recovery.getState().pending, false);
    assert.equal(current.getState().draft.document.items[0].width, 960);
    assert.equal(current.getState().draft.document.items[0].appearance.config.url, 'https://provider.example/latest?token=current');
    assert.equal(f.saves(), 0);
    recovery.dispose();
  }
});
