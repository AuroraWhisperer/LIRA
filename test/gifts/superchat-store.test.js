'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const {
  addSuperChatItem,
  getSuperChatSnapshot,
  handleSuperChatAction,
  retractSuperChatItems,
} = require('../../src/bilibili/superchat-service');
const { clearAllData, clearSuperChatData, closeDatabases, createDatabases } = require('../../src/storage/database');
const { createSuperChatStore } = require('../../src/storage/superchat-store');
const { createSuperChatUndo } = require('../../src/bilibili/superchat-undo');
const { migrateSuperChatReceipts } = require('../../src/storage/superchat-receipt-migration');
const { SUPER_CHAT_SCHEMA, runMigrations, getSchemaVersion } = require('../../src/storage/schema');
const { applyRetentionPolicies } = require('../../src/storage/retention');

function fixture(t) {
  const root = path.join(__dirname, '../../tmp/test');
  fs.mkdirSync(root, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(root, 'superchat-store-'));
  const f = { dataDir, db: null, context: null };
  f.restart = () => {
    if (f.db) closeDatabases(f.db);
    f.db = createDatabases({ dataDir });
    f.context = { store: createSuperChatStore(f.db.superChatDb) };
  };
  f.restart();
  t.after(() => {
    closeDatabases(f.db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return f;
}

function receipts(db) {
  return db.prepare('SELECT * FROM super_chat_receipts ORDER BY platform_id').all().map((row) => ({ ...row }));
}

test('consecutive SC deletions form one batch and restore original identity, status and order', (t) => {
  const { context, db } = fixture(t);
  const undo = createSuperChatUndo({ store: context.store, getScope: () => 'owner:room' });
  t.after(undo.clear);
  const first = addSuperChatItem(context, { platformId: 'undo-1', price: 30, message: '第一条' });
  const second = addSuperChatItem(context, { platformId: 'undo-2', price: 50, message: '第二条' });
  handleSuperChatAction(context, 'assist', first.id);
  const before = getSuperChatSnapshot(context);
  const one = undo.remove(first.id);
  const two = undo.remove(second.id);
  assert.equal(two.token, one.token);
  assert.equal(two.count, 2);
  assert.ok(two.expiresAt >= one.expiresAt);
  assert.deepEqual(getSuperChatSnapshot(context), []);
  assert.equal(addSuperChatItem(context, { platformId: 'undo-1', price: 30 }), null);
  assert.throws(() => undo.restore('forged'), { code: 'SUPERCHAT_UNDO_EXPIRED' });
  undo.restore(two.token);
  assert.deepEqual(getSuperChatSnapshot(context), before);
  assert.deepEqual(receipts(db.superChatDb), []);
  assert.equal(addSuperChatItem(context, { platformId: 'undo-1', price: 30 }).id, first.id);
  assert.throws(() => undo.restore(two.token), { code: 'SUPERCHAT_UNDO_EXPIRED' });
});

test('SC undo expires and cannot cross account/room changes, platform retraction or explicit clear', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-13T00:00:00Z') });
  const { context } = fixture(t);
  let scope = 'owner:room-a';
  const undo = createSuperChatUndo({ store: context.store, getScope: () => scope });
  t.after(undo.clear);
  for (const reason of ['expired', 'scope', 'retract', 'clear']) {
    const item = addSuperChatItem(context, { platformId: reason, price: 30 });
    const batch = undo.remove(item.id);
    if (reason === 'expired') t.mock.timers.setTime(batch.expiresAt);
    if (reason === 'scope') scope = 'owner:room-b';
    if (reason === 'retract') {
      retractSuperChatItems(context, [reason]);
      undo.retract([reason]);
    }
    if (reason === 'clear') undo.clear();
    assert.throws(() => undo.restore(batch.token), { code: 'SUPERCHAT_UNDO_EXPIRED' });
    assert.equal(addSuperChatItem(context, { platformId: reason, price: 30 }), null);
  }
});

test('failed SC batch restore rolls back all rows and receipts and remains retryable', (t) => {
  const { context, db } = fixture(t);
  const undo = createSuperChatUndo({ store: context.store, getScope: () => 'owner:room' });
  t.after(undo.clear);
  for (const platformId of ['restore-ok', 'restore-fail']) {
    const item = addSuperChatItem(context, { platformId, price: 30 });
    undo.remove(item.id);
  }
  const batch = undo.remove(9999);
  const before = receipts(db.superChatDb);
  db.superChatDb.exec(`CREATE TRIGGER fail_sc_restore BEFORE INSERT ON super_chats
    WHEN NEW.platform_id = 'restore-fail' BEGIN SELECT RAISE(ABORT, 'restore failure'); END;`);
  assert.throws(() => undo.restore(batch.token), /restore failure/);
  assert.deepEqual(getSuperChatSnapshot(context), []);
  assert.deepEqual(receipts(db.superChatDb), before);
  db.superChatDb.exec('DROP TRIGGER fail_sc_restore');
  undo.restore(batch.token);
  assert.equal(getSuperChatSnapshot(context).length, 2);
});

test('displayed SuperChats retain content while deletion keeps only replay receipts', (t) => {
  const { db, context } = fixture(t);
  const item = addSuperChatItem(context, {
    platformId: 'sc-1',
    uid: '100',
    userName: 'Viewer',
    price: 30,
    message: 'Hello',
    requesterGuardLevel: 2,
    requesterMedalName: 'Medal',
    requesterMedalLevel: 7,
  });

  assert.equal(item.platform_id, 'sc-1');
  assert.equal(getSuperChatSnapshot(context).length, 1);
  assert.equal(addSuperChatItem(context, { platformId: 'sc-1', price: 30 }).id, item.id);
  for (const action of ['assist', 'unassist']) {
    const [shown] = handleSuperChatAction(context, action, item.id);
    assert.equal(shown.status, action === 'assist' ? 'assisted' : 'active');
    for (const field of ['uid', 'user_name', 'message', 'price', 'requester_guard_level', 'requester_medal_name', 'requester_medal_level']) {
      assert.equal(shown[field], item[field]);
    }
  }

  handleSuperChatAction(context, 'delete', item.id);
  assert.deepEqual(getSuperChatSnapshot(context), []);
  assert.equal(addSuperChatItem(context, { platformId: 'sc-1', price: 30 }), null);
  assert.equal(db.superChatDb.prepare('SELECT * FROM super_chats WHERE id = ?').get(item.id), undefined);

  const second = addSuperChatItem(context, { platformId: 'sc-2', price: 50, message: '撤回后删除内容' });
  const remaining = addSuperChatItem(context, { platformId: 'sc-3', price: 30 });
  assert.equal(retractSuperChatItems(context, ['sc-2', 'sc-2', 'missing']), 1);
  assert.deepEqual(getSuperChatSnapshot(context).map((row) => row.id), [remaining.id]);
  assert.equal(retractSuperChatItems(context, ['sc-2']), 0);
  assert.equal(retractSuperChatItems(context, []), 0);
  const stored = context.store.findByPlatformId('sc-2');
  assert.deepEqual(stored, { platform_id: 'sc-2', status: 'deleted' });
  assert.equal(db.superChatDb.prepare('SELECT * FROM super_chats WHERE id = ?').get(second.id), undefined);
  for (const action of ['assist', 'unassist']) {
    const snapshot = handleSuperChatAction(context, action, second.id);
    assert.deepEqual(snapshot.map((row) => row.id), [remaining.id]);
    assert.equal(context.store.findByPlatformId('sc-2').status, 'deleted');
  }
  assert.equal(addSuperChatItem(context, { platformId: 'sc-2', price: 50 }), null);
  assert.equal(addSuperChatItem(context, { platformId: 'missing', price: 30 }), null, 'a retraction received first blocks its late original packet');
  assert.deepEqual(receipts(db.superChatDb), [{ platform_id: 'missing' }, { platform_id: 'sc-1' }, { platform_id: 'sc-2' }]);

  const anonymous = addSuperChatItem(context, { price: 30, message: 'No platform ID' });
  handleSuperChatAction(context, 'delete', anonymous.id);
  assert.equal(receipts(db.superChatDb).length, 3, 'an unidentified SC cannot contribute a replay key');
});

test('clear actions remove SC content and preserve duplicate suppression across restart', (t) => {
  const f = fixture(t);
  const first = addSuperChatItem(f.context, { platformId: 'clear-1', price: 30, message: 'Remove all fields' });
  handleSuperChatAction(f.context, 'assist', first.id);
  addSuperChatItem(f.context, { platformId: 'clear-2', price: 50 });
  assert.equal(clearSuperChatData(f.db.superChatDb).deletedCount, 2);
  assert.deepEqual(getSuperChatSnapshot(f.context), []);
  assert.deepEqual(receipts(f.db.superChatDb), [{ platform_id: 'clear-1' }, { platform_id: 'clear-2' }]);
  f.restart();
  assert.equal(addSuperChatItem(f.context, { platformId: 'clear-1', price: 30 }), null);
  addSuperChatItem(f.context, { platformId: 'clear-3', price: 30 });
  const result = clearAllData(f.db.songDb, f.db.superChatDb, f.db.giftDb, f.db.musicDb, f.db.checkinDb);
  assert.equal(result.cleared, true);
  assert.deepEqual(getSuperChatSnapshot(f.context), []);
  assert.deepEqual(receipts(f.db.superChatDb), ['clear-1', 'clear-2', 'clear-3'].map((platform_id) => ({ platform_id })));
  f.restart();
  assert.equal(addSuperChatItem(f.context, { platformId: 'clear-3', price: 30 }), null);
  assert.equal(addSuperChatItem(f.context, { platformId: 'new-after-clear', price: 30 }).platform_id, 'new-after-clear');
});

test('configured SC retention keeps receipts atomically while a dry run changes nothing', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-12T00:00:00Z') });
  const f = fixture(t);
  addSuperChatItem(f.context, { platformId: 'expired', price: 30, messageTimestamp: Date.parse('2026-01-01T00:00:00Z') });
  const current = addSuperChatItem(f.context, { platformId: 'current', price: 30 });
  handleSuperChatAction(f.context, 'assist', current.id);
  const policy = { superChatDays: 30 };
  assert.equal(applyRetentionPolicies(f.db, { policy, dryRun: true }).superChatsDeleted, 1);
  assert.equal(getSuperChatSnapshot(f.context).length, 2);
  assert.deepEqual(receipts(f.db.superChatDb), []);
  assert.equal(applyRetentionPolicies(f.db, { policy }).superChatsDeleted, 1);
  assert.deepEqual(getSuperChatSnapshot(f.context).map((row) => [row.platform_id, row.status]), [['current', 'assisted']]);
  assert.deepEqual(receipts(f.db.superChatDb), [{ platform_id: 'expired' }]);
  assert.equal(addSuperChatItem(f.context, { platformId: 'expired', price: 30 }), null);
});

test('failed SC removal rolls back both content and newly recorded receipts', (t) => {
  const f = fixture(t);
  addSuperChatItem(f.context, { platformId: 'cannot-delete', price: 30, message: 'Keep until commit' });
  const before = getSuperChatSnapshot(f.context);
  f.db.superChatDb.exec(`CREATE TRIGGER fail_sc_delete BEFORE DELETE ON super_chats
    BEGIN SELECT RAISE(ABORT, 'delete failure'); END;`);
  assert.throws(() => retractSuperChatItems(f.context, ['cannot-delete', 'late-packet']), /delete failure/);
  assert.deepEqual(getSuperChatSnapshot(f.context), before);
  assert.deepEqual(receipts(f.db.superChatDb), []);
  assert.throws(() => clearSuperChatData(f.db.superChatDb), /delete failure/);
  assert.deepEqual(getSuperChatSnapshot(f.context), before);
  assert.deepEqual(receipts(f.db.superChatDb), []);
  f.db.superChatDb.exec('DROP TRIGGER fail_sc_delete');
  assert.equal(retractSuperChatItems(f.context, ['cannot-delete', 'late-packet']), 1);
  assert.deepEqual(receipts(f.db.superChatDb), [{ platform_id: 'cannot-delete' }, { platform_id: 'late-packet' }]);
});

test('SC receipt migration removes old deleted payloads, preserves displayed rows and retries atomically', (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(SUPER_CHAT_SCHEMA);
  const insert = db.prepare(`INSERT INTO super_chats
    (platform_id, uid, user_name, price, message, status, created_at, updated_at)
    VALUES (?, '123', 'Viewer', 50, 'Private SC content', ?, '2026-01-01', '2026-01-01')`);
  for (const [id, status] of [['gone', 'deleted'], ['', 'deleted'], ['live', 'active'], ['done', 'assisted']]) insert.run(id, status);
  const before = db.prepare('SELECT * FROM super_chats ORDER BY id').all();
  runMigrations(db, 'super_chat_db', [() => {}]);
  db.exec(`CREATE TRIGGER fail_migration_delete BEFORE DELETE ON super_chats
    BEGIN SELECT RAISE(ABORT, 'migration failure'); END;`);
  assert.throws(() => runMigrations(db, 'super_chat_db', [() => {}, migrateSuperChatReceipts]), /migration failure/);
  assert.equal(getSchemaVersion(db, 'super_chat_db'), 1);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'super_chat_receipts'").get(), undefined);
  assert.deepEqual(db.prepare('SELECT * FROM super_chats ORDER BY id').all(), before);
  db.exec('DROP TRIGGER fail_migration_delete');
  assert.equal(runMigrations(db, 'super_chat_db', [() => {}, migrateSuperChatReceipts]).applied, 1);
  assert.equal(getSchemaVersion(db, 'super_chat_db'), 2);
  assert.deepEqual(db.prepare('SELECT * FROM super_chats ORDER BY id').all(), before.filter((row) => row.status !== 'deleted'));
  assert.deepEqual(receipts(db), [{ platform_id: 'gone' }]);
  migrateSuperChatReceipts(db);
  assert.equal(runMigrations(db, 'super_chat_db', [() => {}, migrateSuperChatReceipts]).applied, 0);
  assert.deepEqual(receipts(db), [{ platform_id: 'gone' }]);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
});
