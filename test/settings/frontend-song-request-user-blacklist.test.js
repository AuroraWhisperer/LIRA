'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { createDom } = require('../helpers/toast-dom');

async function createEditor(entries = [], globals = {}) {
  const { documentRef } = createDom();
  const createElement = documentRef.createElement;
  const draftEvents = [];
  documentRef.createElement = (tag) => {
    const node = createElement(tag);
    node.dataset = {};
    node.value = '';
    node.dispatchEvent = (event) => draftEvents.push({ type: event.type, bubbles: event.bubbles });
    return node;
  };
  const elements = new Map();
  for (const suffix of ['', 'Rows', 'Table', 'Empty', 'Count', 'Add']) {
    elements.set(`songRequestUserBlacklist${suffix}`, documentRef.createElement('div'));
  }
  documentRef.getElementById = (id) => elements.get(id);
  const [{ createSongRequestUserBlacklist }, { eventBus, Events }] = await loadModuleExports(
    [path.resolve('public/js/admin/song-request-user-blacklist.js'), path.resolve('public/js/shared/event-bus.js')], { Event, ...globals },
  );
  const editor = createSongRequestUserBlacklist({
    documentRef,
    getState: () => ({ getAppState: () => ({ settings: { songRequestUserBlacklist: JSON.stringify(entries) } }) }),
  });
  editor.init();
  const list = elements.get('songRequestUserBlacklistRows');
  return {
    editor, documentRef, draftEvents, list,
    field: elements.get('songRequestUserBlacklist'),
    empty: elements.get('songRequestUserBlacklistEmpty'),
    table: elements.get('songRequestUserBlacklistTable'),
    count: elements.get('songRequestUserBlacklistCount'),
    add: elements.get('songRequestUserBlacklistAdd'),
    receive(state, changedKeys = ['queue']) { eventBus.emit(Events.STATE_LOADED, { state, changedKeys }); },
    row(index) {
      const [uid, name, expiry, status, remove] = list.children[index].children.map((cell) => cell.children[0]);
      return { uid, name, expiry, status, remove };
    },
  };
}

test('user blacklist starts unrestricted and edits literal UIDs, names and local expiry as a saved draft', async () => {
  const ui = await createEditor();
  assert.equal(ui.field.value, '[]');
  assert.equal(ui.empty.hidden, false);
  assert.equal(ui.table.hidden, true);
  ui.add.fire('click');
  const row = ui.row(0);
  assert.equal(row.uid.type, 'text', 'long Bilibili UIDs must not lose numeric precision');
  row.uid.value = '1234567890123456789012345';
  row.name.value = '<img src=x onerror=alert(1)>';
  row.expiry.value = '2032-10-14T18:30:00.123';
  row.expiry.fire('input');
  assert.deepEqual(JSON.parse(ui.field.value), [{
    uid: row.uid.value, name: row.name.value, expiresAt: new Date(row.expiry.value).getTime(),
  }]);
  assert.equal(row.name.children.length, 0);
  assert.deepEqual(ui.field.dataset, { preserveDirty: 'true', dirty: 'true' });
  assert.deepEqual(ui.draftEvents, [{ type: 'input', bubbles: true }, { type: 'input', bubbles: true }]);

  row.expiry.value = '';
  row.expiry.fire('input');
  assert.equal(JSON.parse(ui.field.value)[0].expiresAt, 0);
  row.remove.fire('click');
  assert.equal(ui.field.value, '[]');
  assert.equal(ui.empty.hidden, false);
  assert.equal(ui.table.hidden, true);
});

test('blacklist snapshots preserve edits and focus, then update same-length rows after save', async () => {
  const expiry = new Date('2020-01-02T03:04:00.000Z').getTime();
  const ui = await createEditor([{ uid: '12', name: '以前的昵称', expiresAt: expiry }]);
  const row = ui.row(0);
  assert.equal(new Date(row.expiry.value).getTime(), expiry, 'local input preserves the saved instant');
  row.expiry.value = row.expiry.value.replace(/:00\.000$/, '');
  assert.equal(row.status.textContent, '已过期');
  row.name.focus();
  ui.editor.render(ui.field.value);
  assert.equal(ui.row(0).name, row.name);
  row.name.value = '编辑中的昵称';
  row.name.fire('input');
  ui.editor.render('[{"uid":"34","name":"远端昵称","expiresAt":0}]');
  assert.equal(ui.row(0).name, row.name);
  assert.equal(ui.documentRef.activeElement, row.name);
  assert.equal(JSON.parse(ui.field.value)[0].name, '编辑中的昵称');

  ui.field.dataset.dirty = 'false';
  // formsService may fill the hidden field before the editor receives the snapshot.
  ui.field.value = '[{"uid":"34","name":"已保存昵称","expiresAt":0}]';
  ui.editor.render(ui.field.value);
  assert.equal(ui.row(0).name, row.name, 'autosave must not replace a focused input');
  ui.documentRef.activeElement = null;
  ui.editor.render(ui.field.value);
  assert.equal(ui.row(0).uid.value, '34');
  assert.equal(ui.row(0).name.value, '已保存昵称');
  assert.equal(ui.row(0).status.textContent, '永久');
  const saved = ui.field.value;
  ui.row(0).name.value = '另一次草稿';
  ui.row(0).name.fire('input');
  ui.field.dataset.dirty = 'false';
  ui.editor.render(saved);
  assert.equal(ui.row(0).name.value, '已保存昵称', 'resetting a draft restores even the previously rendered snapshot');
});

test('unrelated snapshots leave blacklist labels alone until expiry and hidden updates remain current', async () => {
  let now = Date.parse('2030-01-01T00:00:00Z');
  const ui = await createEditor([{ uid: '123', expiresAt: now + 5000 }], {
    Date: class extends Date { static now() { return now; } },
  });
  const row = ui.row(0);
  const state = { settings: { songRequestUserBlacklist: ui.field.value } };
  let attributeWrites = 0;
  let statusWrites = 0;
  for (const node of [row.uid, row.name, row.expiry, row.remove]) {
    const setAttribute = node.setAttribute;
    node.setAttribute = (...args) => { attributeWrites++; setAttribute(...args); };
  }
  const statusProperty = Object.getOwnPropertyDescriptor(row.status, 'textContent');
  Object.defineProperty(row.status, 'textContent', {
    ...statusProperty, set(value) { statusWrites++; statusProperty.set.call(this, value); },
  });
  for (let index = 0; index < 20; index++) ui.receive({ ...state, queue: { requestResult: { id: index } } });
  assert.equal(attributeWrites, 0);
  assert.equal(statusWrites, 0);
  const activeStatus = row.status.textContent;
  now += 5000;
  ui.receive(state);
  assert.notEqual(row.status.textContent, activeStatus);
  ui.receive(state);
  assert.equal(attributeWrites, 0, 'expiry does not rewrite structural labels');
  assert.equal(statusWrites, 1);
  now -= 1000;
  ui.receive(state);
  assert.equal(row.status.textContent, activeStatus, 'clock rollback restores a limit that has not yet expired');
  ui.receive(state);
  assert.equal(attributeWrites, 0);
  assert.equal(statusWrites, 2);
  ui.documentRef.hidden = true;
  ui.receive({ settings: { songRequestUserBlacklist: '[{"uid":"456","name":"更新后","expiresAt":0}]' } }, ['settings']);
  ui.documentRef.hidden = false;
  assert.equal(ui.row(0).uid.value, '456');
  assert.equal(ui.row(0).name.value, '更新后');
});

test('editing a note preserves the maximum supported expiry in the local time zone', async () => {
  const ui = await createEditor([{ uid: '123', expiresAt: 253402300799999 }]);
  const row = ui.row(0);
  row.name.value = '修改备注';
  row.name.fire('input');
  assert.equal(JSON.parse(ui.field.value)[0].expiresAt, 253402300799999);
});

test('user editor enforces the saved list limit and restores add after deleting an entry', async () => {
  const ui = await createEditor(Array.from({ length: 200 }, (_, index) => ({ uid: String(index + 1), expiresAt: 0 })));
  assert.equal(ui.add.disabled, true);
  ui.row(0).remove.fire('click');
  assert.equal(ui.add.disabled, false);
});

test('unrelated edits preserve the second occurrence of a daylight-saving local time', async (t) => {
  const originalTimezone = process.env.TZ;
  t.after(() => { if (originalTimezone === undefined) delete process.env.TZ; else process.env.TZ = originalTimezone; });
  process.env.TZ = 'America/New_York';
  const expiresAt = Date.parse('2026-11-01T06:30:00Z');
  const ui = await createEditor([{ uid: '12', expiresAt }, { uid: '34', expiresAt: 0 }]);
  assert.equal(new Date(ui.row(0).expiry.value).getTime(), expiresAt - 3600000, 'the local string is ambiguous');
  ui.row(1).name.value = 'new note';
  ui.row(1).name.fire('input');
  assert.equal(JSON.parse(ui.field.value)[0].expiresAt, expiresAt);
  ui.row(0).expiry.value = '2026-11-01T03:30';
  ui.row(0).expiry.fire('input');
  assert.equal(JSON.parse(ui.field.value)[0].expiresAt, Date.parse('2026-11-01T08:30:00Z'));
});
