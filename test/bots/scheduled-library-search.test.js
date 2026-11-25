'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { allNodes, createFakeDocument } = require('../helpers/fake-dom');

test('scheduled library search preserves spaces between keystrokes and only filters the visible entries', async () => {
  const { createScheduledLibraryEditor } = await import('../../public/js/admin/danmaku-scheduled-library.js');
  const documentRef = createFakeDocument();
  const search = documentRef.createElement('input');
  search.value = '';
  const list = documentRef.createElement('div');
  const elements = { Search: search, List: list, Count: documentRef.createElement('span'), Add: documentRef.createElement('button') };
  documentRef.getElementById = id => elements[id.slice('danmakuScheduledLibrary'.length)];
  let changes = 0;
  const editor = createScheduledLibraryEditor({ documentRef, changed: () => { changes++; } });
  const messages = ['LIVE SET｜首播', 'LIVESET｜返场'];
  editor.load(messages);
  for (const char of 'live set') {
    search.value += char;
    search.listeners.input();
  }
  assert.equal(search.value, 'live set');
  assert.deepEqual(allNodes(list).filter(node => node.tag === 'input').map(node => node.value), [messages[0]]);
  assert.deepEqual(editor.read(), messages);
  assert.equal(changes, 0);
});
