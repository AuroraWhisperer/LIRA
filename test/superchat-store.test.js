'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  addSuperChatItem,
  getSuperChatSnapshot,
  handleSuperChatAction
} = require('../src/bilibili/superchat-service');
const { closeDatabases, createDatabases } = require('../src/storage/database');
const { createSuperChatStore } = require('../src/storage/superchat-store');

test('SuperChat service persists through its narrow store boundary', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-superchat-store-'));
  const db = createDatabases({ dataDir });
  const context = { store: createSuperChatStore(db.superChatDb) };

  try {
    const item = addSuperChatItem(context, {
      platformId: 'sc-1', uid: '100', userName: 'Viewer', price: 30, message: 'Hello'
    });

    assert.equal(item.platform_id, 'sc-1');
    assert.equal(getSuperChatSnapshot(context).length, 1);
    assert.equal(addSuperChatItem(context, { platformId: 'sc-1', price: 30 }).id, item.id);

    handleSuperChatAction(context, 'delete', item.id);
    assert.deepEqual(getSuperChatSnapshot(context), []);
    assert.equal(addSuperChatItem(context, { platformId: 'sc-1', price: 30 }), null);
  } finally {
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
