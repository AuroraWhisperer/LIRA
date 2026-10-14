'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { createDom } = require('../helpers/toast-dom');

async function createEditor(entries = []) {
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
  const { createSongRequestUserBlacklist } = await loadModuleExports(
    path.resolve('public/js/admin/song-request-user-blacklist.js'), { Event },
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
  assert.equal(ui.documentRef.activeElement, row.uid);
  assert.equal(row.uid.type, 'text', 'long Bilibili UIDs must not lose numeric precision');
  row.uid.value = '1234567890123456789012345';
  row.name.value = '<img src=x onerror=alert(1)>';
  row.expiry.value = '2032-10-14T18:30:00.123';
  row.expiry.fire('input');
  assert.deepEqual(JSON.parse(ui.field.value), [{
    uid: row.uid.value, name: row.name.value, expiresAt: new Date(row.expiry.value).getTime(),
  }]);
  assert.equal(row.name.children.length, 0);
  assert.equal(row.status.textContent, '限时');
  assert.deepEqual(ui.field.dataset, { preserveDirty: 'true', dirty: 'true' });
  assert.deepEqual(ui.draftEvents, [{ type: 'input', bubbles: true }, { type: 'input', bubbles: true }]);
  assert.equal(ui.count.textContent, '1 人');

  row.expiry.value = '';
  row.expiry.fire('input');
  assert.equal(JSON.parse(ui.field.value)[0].expiresAt, 0);
  assert.equal(row.status.textContent, '永久');
  row.remove.fire('click');
  assert.equal(ui.field.value, '[]');
  assert.equal(ui.empty.hidden, false);
  assert.equal(ui.table.hidden, true);
  assert.equal(ui.documentRef.activeElement, ui.add);
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
  assert.equal(ui.row(0).uid.value, '34');
  assert.equal(ui.row(0).name.value, '已保存昵称');
  assert.equal(ui.row(0).status.textContent, '永久');
});

test('editing a note preserves the maximum supported expiry in the local time zone', async () => {
  const ui = await createEditor([{ uid: '123', expiresAt: 253402300799999 }]);
  const row = ui.row(0);
  row.name.value = '修改备注';
  row.name.fire('input');
  assert.equal(JSON.parse(ui.field.value)[0].expiresAt, 253402300799999);
});

test('user editor shows the saved list limit and restores add after deleting an entry', async () => {
  const ui = await createEditor(Array.from({ length: 200 }, (_, index) => ({ uid: String(index + 1), expiresAt: 0 })));
  assert.equal(ui.add.disabled, true);
  ui.row(0).remove.fire('click');
  assert.equal(ui.add.disabled, false);
  assert.equal(ui.count.textContent, '199 人');
  assert.equal(ui.row(0).uid.getAttribute('aria-label'), '用户 1 的 B 站 UID');
  assert.equal(ui.row(0).remove.getAttribute('aria-label'), '删除用户 1');
});
