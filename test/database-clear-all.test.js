// 编写人：Aurora
// Clear-all Matrix 和部分失败测试
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it, beforeEach, afterEach } = require('node:test');
const { createDatabases, clearAllData, closeDatabases } = require('../src/storage/database');
const { now } = require('../src/shared/utils');
const {
  seedClearAllConfiguration,
  seedClearAllBusinessData,
  assertClearAllResultStructure,
  assertConfigurationsPreserved,
  assertBusinessCleared,
  assertDefaultsRecreated,
  assertDeletedCounts,
} = require('./helpers/database-clear-fixture');

describe('clearAllData Matrix', () => {
  let databases;
  let tempDir;

  beforeEach(() => {
    tempDir = path.join(process.cwd(), 'test', 'tmp', `clear-all-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tempDir, { recursive: true });
    databases = createDatabases({ dataDir: tempDir });
  });

  afterEach(() => {
    if (databases) {
      closeDatabases(databases);
    }
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should preserve configuration tables', () => {
    const { songDb, superChatDb, giftDb, musicDb, checkinDb } = databases;
    seedClearAllConfiguration(databases);
    const giftSourceId = seedClearAllBusinessData(databases);

    // Execute clear-all
    const result = clearAllData(songDb, superChatDb, giftDb, musicDb, checkinDb, { sourceId: Number(giftSourceId) });

    assertClearAllResultStructure(result);
    assertConfigurationsPreserved(databases);
    assertBusinessCleared(databases);
    assertDefaultsRecreated(giftDb);
    assertDeletedCounts(result);
  });

  it('should handle empty databases', () => {
    const { songDb, superChatDb, giftDb, musicDb, checkinDb } = databases;

    const result = clearAllData(songDb, superChatDb, giftDb, musicDb, checkinDb);

    assert.strictEqual(result.cleared, true);
    assert.strictEqual(result.totalDeleted, 0);

    // Assert defaults still recreated
    const categoriesCount = songDb.prepare('SELECT COUNT(*) AS count FROM song_categories').get().count;
    assert.strictEqual(categoriesCount, 1);

    const overtimeState = giftDb.prepare('SELECT * FROM overtime_machine_state WHERE id = 1').get();
    assert.strictEqual(overtimeState.enabled, 0);
  });

  for (const [databaseName, table] of [
    ['songDb', 'song_categories'],
    ['giftDb', 'overtime_machine_state'],
  ]) {
    it(`rolls back all deletions when recreating ${table} fails`, (t) => {
      const { songDb, superChatDb, giftDb, musicDb, checkinDb } = databases;
      const timestamp = now();
      songDb
        .prepare(
          `INSERT INTO song_categories
        (name, created_at, updated_at) VALUES ('保留分类', ?, ?)`,
        )
        .run(timestamp, timestamp);
      giftDb.exec(`UPDATE overtime_machine_state
        SET enabled = 1, status = 'running', remaining_ms = 120000 WHERE id = 1`);
      musicDb
        .prepare(
          `INSERT INTO play_queue_state
        (client_id, payload, updated_at) VALUES ('retain', '{}', ?)`,
        )
        .run(timestamp);
      const originalState = giftDb.prepare('SELECT * FROM overtime_machine_state').get();
      let commits = 0;
      for (const db of Object.values(databases)) {
        const exec = db.exec;
        t.mock.method(db, 'exec', function (sql) {
          if (sql === 'COMMIT') commits += 1;
          return exec.call(this, sql);
        });
      }
      databases[databaseName].exec(`CREATE TEMP TRIGGER fail_defaults
        BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'default insert failed'); END`);

      assert.throws(
        () => clearAllData(songDb, superChatDb, giftDb, musicDb, checkinDb),
        (error) => {
          assert.deepStrictEqual(error.details, [
            {
              db: databaseName,
              phase: 'recreate',
              error: 'default insert failed',
            },
          ]);
          return true;
        },
      );
      assert.strictEqual(commits, 0);
      assert.deepStrictEqual(
        songDb
          .prepare('SELECT name FROM song_categories')
          .all()
          .map((row) => row.name),
        ['保留分类'],
      );
      assert.deepStrictEqual(giftDb.prepare('SELECT * FROM overtime_machine_state').get(), originalState);
      assert.strictEqual(musicDb.prepare('SELECT COUNT(*) AS count FROM play_queue_state').get().count, 1);
      for (const db of Object.values(databases)) {
        db.exec('BEGIN');
        db.exec('ROLLBACK');
      }
    });
  }

  it('should rollback every uncommitted database after a commit failure', () => {
    const { songDb, superChatDb, giftDb, musicDb, checkinDb } = databases;
    const timestamp = now();

    superChatDb
      .prepare(
        `
      INSERT INTO super_chats (platform_id, uid, user_name, price, message, status, source, created_at, updated_at)
      VALUES ('rollback-sc', '1', '测试用户', 30, '保留', 'active', 'superchat', ?, ?)
    `,
      )
      .run(timestamp, timestamp);
    giftDb
      .prepare(
        `
      INSERT INTO gift_events (platform_id, gift_id, gift_name, uid, user_name, num, unit_price, total_price, coin_type, status, created_at, updated_at)
      VALUES ('rollback-gift', '1', '测试礼物', '1', '测试用户', 1, 1, 1, 'gold', 'active', ?, ?)
    `,
      )
      .run(timestamp, timestamp);
    musicDb
      .prepare(
        `
      INSERT INTO play_queue_state (client_id, payload, updated_at)
      VALUES ('rollback-client', '{}', ?)
    `,
      )
      .run(timestamp);
    checkinDb
      .prepare(
        `
      INSERT INTO checkin_users (uid, user_name, total_days, first_checkin_at, last_checkin_at, last_checkin_date, updated_at)
      VALUES ('rollback-user', '测试用户', 1, ?, ?, ?, ?)
    `,
      )
      .run(timestamp, timestamp, timestamp.slice(0, 10), timestamp);

    let commitFailed = false;
    const failingSuperChatDb = new Proxy(superChatDb, {
      get(target, property) {
        if (property === 'exec') {
          return (sql) => {
            if (!commitFailed && sql === 'COMMIT') {
              commitFailed = true;
              throw new Error('simulated COMMIT failure');
            }
            return target.exec(sql);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    const result = clearAllData(songDb, failingSuperChatDb, giftDb, musicDb, checkinDb);

    assert.strictEqual(result.partial, true);
    assert.deepStrictEqual(result.committed, ['songDb']);
    assert.deepStrictEqual(result.failed, ['superChatDb']);
    assert.deepStrictEqual(result.rolledBack, ['superChatDb', 'giftDb', 'musicDb', 'checkinDb']);
    assert.deepStrictEqual(result.rollbackFailed, []);

    assert.strictEqual(superChatDb.prepare('SELECT COUNT(*) AS count FROM super_chats').get().count, 1);
    assert.strictEqual(giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get().count, 1);
    assert.strictEqual(musicDb.prepare('SELECT COUNT(*) AS count FROM play_queue_state').get().count, 1);
    assert.strictEqual(checkinDb.prepare('SELECT COUNT(*) AS count FROM checkin_users').get().count, 1);

    for (const db of [superChatDb, giftDb, musicDb, checkinDb]) {
      db.exec('BEGIN');
      db.exec('ROLLBACK');
    }
  });
});
