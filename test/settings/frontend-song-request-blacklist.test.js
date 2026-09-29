'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { createDom } = require('../helpers/toast-dom');

async function createEditor(savedValue = '') {
  const { documentRef } = createDom();
  const createElement = documentRef.createElement;
  documentRef.createElement = (tag) => {
    const node = createElement(tag);
    node.dataset = {};
    node.value = '';
    Object.defineProperty(node, 'nextElementSibling', {
      get() {
        const siblings = this.parentNode?.children || [];
        return siblings[siblings.indexOf(this) + 1] || null;
      },
    });
    return node;
  };
  const elements = new Map();
  for (const suffix of ['', 'Words', 'Empty', 'Count', 'Add']) {
    elements.set(`songRequestBlacklist${suffix}`, documentRef.createElement('div'));
  }
  documentRef.getElementById = (id) => elements.get(id);
  const { createSongRequestBlacklist } = await loadModuleExports(path.resolve('public/js/admin/song-request-blacklist.js'));
  const editor = createSongRequestBlacklist({
    documentRef,
    getState: () => ({ getAppState: () => ({ settings: { songRequestBlacklist: savedValue } }) }),
  });
  editor.init();
  return {
    editor,
    documentRef,
    field: elements.get('songRequestBlacklist'),
    list: elements.get('songRequestBlacklistWords'),
    empty: elements.get('songRequestBlacklistEmpty'),
    count: elements.get('songRequestBlacklistCount'),
    add: elements.get('songRequestBlacklistAdd'),
  };
}

test('blacklist entries preserve literal text and serialize additions, edits and deletions', async () => {
  const { documentRef, field, list, empty, count, add } = await createEditor('78\n<img src=x onerror=alert(1)>');
  assert.equal(list.children.length, 2);
  assert.equal(list.children[1].children[0].value, '<img src=x onerror=alert(1)>');
  assert.equal(list.children[1].children[0].children.length, 0);
  assert.equal(empty.hidden, true);
  assert.equal(count.textContent, '2 个词条');

  add.fire('click');
  const input = list.children[2].children[0];
  assert.equal(documentRef.activeElement, input);
  input.value = '这是一条超过输入框可见宽度的屏蔽词'.repeat(10);
  input.fire('input');
  assert.equal(field.value, `78\n<img src=x onerror=alert(1)>\n${input.value}`);
  assert.deepEqual(field.dataset, { preserveDirty: 'true', dirty: 'true' });

  list.children[1].children[1].fire('click');
  assert.equal(field.value, `78\n${input.value}`);
  assert.equal(documentRef.activeElement, input);
  assert.equal(input.getAttribute('aria-label'), '屏蔽词 2');
  assert.equal(input.nextElementSibling.getAttribute('aria-label'), '删除词条 2');
  list.children[1].children[1].fire('click');
  list.children[0].children[1].fire('click');
  assert.equal(field.value, '');
  assert.equal(count.textContent, '0 个词条');
  assert.equal(empty.hidden, false);
  assert.equal(documentRef.activeElement, add);
});

test('snapshots preserve editable drafts and selection until successful save releases the draft', async () => {
  const { editor, documentRef, field, list, count } = await createEditor('78');
  const input = list.children[0].children[0];
  input.focus();
  input.selectionStart = 1;
  input.selectionEnd = 2;
  editor.render('78');
  assert.equal(list.children[0].children[0], input);
  input.value = '  修改中的词条  ';
  input.fire('input');
  editor.render('78\n已保存的词');
  assert.equal(list.children[0].children[0], input);
  assert.equal(documentRef.activeElement, input);
  assert.equal(input.selectionStart, 1);
  assert.equal(input.selectionEnd, 2);
  assert.equal(field.value, input.value);

  field.dataset.dirty = 'false';
  editor.render('修改中的词条');
  assert.equal(list.children[0].children[0].value, '修改中的词条');
  assert.equal(field.value, '修改中的词条');
  editor.render('');
  assert.equal(list.children.length, 0);
  assert.equal(count.textContent, '0 个词条');
});

test('Enter adds an entry without submitting the form, while IME confirmation does not add one', async () => {
  const { documentRef, list, add } = await createEditor();
  add.fire('click');
  const input = list.children[0].children[0];
  let prevented = false;
  input.fire('keydown', { key: 'Enter', isComposing: true, preventDefault() { prevented = true; } });
  assert.equal(list.children.length, 1);
  assert.equal(prevented, false);
  input.fire('keydown', { key: 'Enter', isComposing: false, preventDefault() { prevented = true; } });
  assert.equal(list.children.length, 2);
  assert.equal(prevented, true);
  assert.equal(documentRef.activeElement, list.children[1].children[0]);
});
