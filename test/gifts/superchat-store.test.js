'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  addSuperChatItem,
  getSuperChatSnapshot,
  handleSuperChatAction,
  retractSuperChatItems,
} = require('../../src/bilibili/superchat-service');
const { closeDatabases, createDatabases } = require('../../src/storage/database');
const { createSuperChatStore } = require('../../src/storage/superchat-store');

test('SuperChat service persists through its narrow store boundary', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-superchat-store-'));
  const db = createDatabases({ dataDir });
  const context = { store: createSuperChatStore(db.superChatDb) };

  try {
    const item = addSuperChatItem(context, {
      platformId: 'sc-1',
      uid: '100',
      userName: 'Viewer',
      price: 30,
      message: 'Hello',
    });

    assert.equal(item.platform_id, 'sc-1');
    assert.equal(getSuperChatSnapshot(context).length, 1);
    assert.equal(addSuperChatItem(context, { platformId: 'sc-1', price: 30 }).id, item.id);

    handleSuperChatAction(context, 'delete', item.id);
    assert.deepEqual(getSuperChatSnapshot(context), []);
    assert.equal(addSuperChatItem(context, { platformId: 'sc-1', price: 30 }), null);

    const second = addSuperChatItem(context, { platformId: 'sc-2', price: 50, message: '保留财务历史' });
    const remaining = addSuperChatItem(context, { platformId: 'sc-3', price: 30 });
    assert.equal(retractSuperChatItems(context, ['sc-2', 'sc-2', 'missing']), 1);
    assert.deepEqual(getSuperChatSnapshot(context).map((row) => row.id), [remaining.id]);
    assert.equal(retractSuperChatItems(context, ['sc-2']), 0);
    assert.equal(retractSuperChatItems(context, []), 0);
    const stored = context.store.findByPlatformId('sc-2');
    assert.equal(stored.id, second.id);
    assert.equal(stored.status, 'deleted');
    assert.equal(stored.price, 50);
    assert.equal(stored.message, '保留财务历史');
    for (const action of ['assist', 'unassist']) {
      const snapshot = handleSuperChatAction(context, action, second.id);
      assert.deepEqual(snapshot.map((row) => row.id), [remaining.id]);
      assert.equal(context.store.findByPlatformId('sc-2').status, 'deleted');
    }
    assert.equal(addSuperChatItem(context, { platformId: 'sc-2', price: 50 }), null);
  } finally {
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
