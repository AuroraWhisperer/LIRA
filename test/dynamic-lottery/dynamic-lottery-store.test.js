'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations } = require('../../src/storage/schema');
const { DYNAMIC_LOTTERY_SCHEMA } = require('../../src/storage/dynamic-lottery-schema');

const { runDynamicLotteryMigrations } = require('../../src/storage/dynamic-lottery-migrations');
const { commentRecord, openLotteryDatabase } = require('../helpers/dynamic-lottery-fixture');
const { createDynamicLotteryStore } = require('../../src/storage/dynamic-lottery-store');

const openDatabase = openLotteryDatabase;

function seedTask(store, overrides = {}) {
  return store.createTask({
    id: overrides.id || 'task-1',
    streamerId: 'streamer-1',
    ownerUid: '999',
    dynamicId: '888',
    requestId: 'request-1',
    target: {
      dynamicId: '888',
      ownerUid: '999',
      commentOid: '777',
      commentType: 11,
    },
    rules: {
      entryAction: 'comment',
      requiredActions: [],
      startsAtMs: 0,
      endsAtMs: 1_000,
    },
    nowMs: 2_000,
  });
}

const evidence = (recordId = '1') => commentRecord(recordId, '123', { level: 5 });

test('dynamic lottery migrations create nine tables idempotently', () => {
  const db = openDatabase();
  try {
    const first = runDynamicLotteryMigrations(db);
    assert.equal(first.applied, 0);
    assert.equal(first.to, 2);
    assert.deepEqual(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'lottery_%' ORDER BY name")
        .all()
        .map((row) => row.name),
      [
        'lottery_awards',
        'lottery_events',
        'lottery_evidence',
        'lottery_orders',
        'lottery_request_budget',
        'lottery_round_members',
        'lottery_rounds',
        'lottery_scans',
        'lottery_tasks',
      ],
    );
  } finally {
    db.close();
  }
});

test('v2 upgrades old evidence without losing text or checkpoints and only runs once', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db, 'lottery_db', [(database) => database.exec(DYNAMIC_LOTTERY_SCHEMA)]);
  const store = createDynamicLotteryStore(db);
  try {
    seedTask(store);
    store.beginScan({
      id: 'scan-1',
      taskId: 'task-1',
      sessionEpoch: 4,
      sources: ['comment'],
      startedAtMs: 2_100,
    });
    db.prepare(
      `INSERT INTO lottery_evidence
      (scan_id, source, record_id, uid, text, occurred_at_ms, created_at_ms)
      VALUES ('scan-1', 'comment', '1', '123', ?, 900, 2200)`,
    ).run('旧评论\n<img src=x onerror=alert(1)>');
    const before = store.getScan('scan-1');
    assert.equal(runDynamicLotteryMigrations(db).applied, 1);
    assert.deepEqual(store.getScan('scan-1'), before);
    assert.equal(store.getEvidence('scan-1')[0].text, '旧评论\n<img src=x onerror=alert(1)>');
    assert.equal(store.getEvidence('scan-1')[0].displayName, null);
    assert.equal(runDynamicLotteryMigrations(db).applied, 0);
    assert.equal(store.getEvidence('scan-1').length, 1);
  } finally {
    db.close();
  }
});

test('page evidence and cursor checkpoint commit atomically', () => {
  const db = openDatabase();
  const store = createDynamicLotteryStore(db);
  try {
    seedTask(store);
    store.beginScan({
      id: 'scan-1',
      taskId: 'task-1',
      sessionEpoch: 4,
      sources: ['comment'],
      startedAtMs: 2_100,
    });
    db.exec(`
      CREATE TRIGGER fail_lottery_scan_checkpoint
      BEFORE UPDATE OF source_state_json ON lottery_scans
      BEGIN
        SELECT RAISE(ABORT, 'injected checkpoint failure');
      END;
    `);

    assert.throws(
      () =>
        store.commitPage({
          taskId: 'task-1',
          scanId: 'scan-1',
          source: 'comment',
          expectedCursor: null,
          page: { records: [evidence()], nextCursor: 'cursor-2', ended: false },
          sessionEpoch: 4,
          committedAtMs: 2_200,
        }),
      /checkpoint failure/u,
    );
    assert.deepEqual(store.getEvidence('scan-1'), []);
    assert.equal(store.getScan('scan-1').sources.comment.cursor, null);

    db.exec('DROP TRIGGER fail_lottery_scan_checkpoint');
    store.commitPage({
      taskId: 'task-1',
      scanId: 'scan-1',
      source: 'comment',
      expectedCursor: null,
      page: { records: [evidence()], nextCursor: 'cursor-2', ended: false },
      sessionEpoch: 4,
      committedAtMs: 2_200,
    });
    assert.equal(store.getEvidence('scan-1').length, 1);
    assert.equal(store.getScan('scan-1').sources.comment.cursor, 'cursor-2');

    assert.throws(
      () =>
        store.commitPage({
          taskId: 'task-1',
          scanId: 'scan-1',
          source: 'comment',
          expectedCursor: 'cursor-2',
          page: { records: [evidence()], nextCursor: null, ended: true },
          sessionEpoch: 5,
          committedAtMs: 2_300,
        }),
      (error) => error.code === 'LOTTERY_STALE_SESSION',
    );

    store.commitPage({
      taskId: 'task-1',
      scanId: 'scan-1',
      source: 'comment',
      expectedCursor: 'cursor-2',
      page: { records: [evidence()], nextCursor: null, ended: true },
      sessionEpoch: 4,
      committedAtMs: 2_300,
    });
    assert.equal(store.getEvidence('scan-1').length, 1);
    assert.equal(store.getScan('scan-1').status, 'completed');
    assert.equal(store.getScan('scan-1').sources.comment.coverage, 'exhausted');
    assert.equal(store.getTask('task-1').status, 'ready');
  } finally {
    db.close();
  }
});

test('repeating the same scan pause is idempotent', () => {
  const db = openDatabase();
  const store = createDynamicLotteryStore(db);
  try {
    seedTask(store);
    store.beginScan({
      id: 'scan-1',
      taskId: 'task-1',
      sessionEpoch: 4,
      sources: ['comment'],
      startedAtMs: 2_100,
    });

    const first = store.pauseScan({
      taskId: 'task-1',
      reason: 'LOTTERY_COLLECTION_PAUSED',
      nowMs: 2_200,
    });
    const repeated = store.pauseScan({
      taskId: 'task-1',
      reason: 'LOTTERY_COLLECTION_PAUSED',
      nowMs: 2_300,
    });

    assert.equal(repeated.revision, first.revision);
    assert.equal(store.getScan('scan-1').updatedAtMs, 2_200);
  } finally {
    db.close();
  }
});

test('request budget cooldown survives database reopen', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-lottery-budget-'));
  const filePath = path.join(dataDir, 'lottery.db');
  let db = openDatabase(filePath);
  try {
    let store = createDynamicLotteryStore(db);
    assert.equal(
      store.requestBudget.reserve({
        scope: 'streamer-1',
        kind: 'comment_page',
        nowMs: 1_000,
      }).allowed,
      true,
    );
    store.requestBudget.finish({
      scope: 'streamer-1',
      finishedAtMs: 1_100,
      status: 200,
    });
    db.close();

    db = openDatabase(filePath);
    store = createDynamicLotteryStore(db);
    const blocked = store.requestBudget.reserve({
      scope: 'streamer-1',
      kind: 'comment_page',
      nowMs: 2_000,
    });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.waitUntilMs, 5_100);

    store.requestBudget.setHold({
      scope: 'streamer-1',
      reason: 'VERIFICATION_REQUIRED',
      nowMs: 2_000,
    });
    assert.equal(store.requestBudget.get({ scope: 'streamer-1', nowMs: 2_000 }).holdReason, 'VERIFICATION_REQUIRED');
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('request budget persists expired state cleanup when hourly capacity still blocks a reservation', () => {
  const db = openDatabase();
  const store = createDynamicLotteryStore(db);
  const nowMs = 3_601_000;
  const recentTimes = Array(600).fill(nowMs - 1_000);
  try {
    const seed = db.prepare(`
      INSERT INTO lottery_request_budget
        (scope_key, request_times_json, consecutive_count, last_finished_at_ms,
         earliest_resume_at_ms, hold_reason, updated_at_ms)
      VALUES (?, ?, 50, ?, ?, 'RATE_LIMIT_COOLDOWN', 0)
    `);
    for (const scopeKey of ['local', 'account:streamer-1']) {
      seed.run(scopeKey, JSON.stringify([1_000, ...recentTimes]), nowMs - 60_000, nowMs - 1);
    }

    const blocked = store.requestBudget.reserve({ scope: 'streamer-1', kind: 'comment_page', nowMs });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.requestCount, 600);
    assert.equal(blocked.waitUntilMs, nowMs - 1_000 + 3_600_000);
    for (const row of db.prepare('SELECT * FROM lottery_request_budget').all()) {
      assert.deepEqual(JSON.parse(row.request_times_json), recentTimes);
      assert.equal(row.consecutive_count, 0);
      assert.equal(row.earliest_resume_at_ms, 0);
      assert.equal(row.hold_reason, '');
      assert.equal(row.updated_at_ms, nowMs);
    }
  } finally {
    db.close();
  }
});

test('request budget writes each scope once and retries atomically after a failed reservation', () => {
  const db = openDatabase();
  const store = createDynamicLotteryStore(db);
  try {
    db.exec(`
      CREATE TEMP TABLE budget_updates (scope_key TEXT);
      CREATE TEMP TRIGGER count_budget_updates AFTER UPDATE ON lottery_request_budget
      BEGIN INSERT INTO budget_updates VALUES (NEW.scope_key); END;
      CREATE TEMP TRIGGER fail_account_budget BEFORE UPDATE ON lottery_request_budget
      WHEN NEW.scope_key = 'account:streamer-1'
      BEGIN SELECT RAISE(ABORT, 'synthetic account update failure'); END;
    `);
    const request = { scope: 'streamer-1', kind: 'comment_page', nowMs: 1_000 };
    assert.throws(() => store.requestBudget.reserve(request), /synthetic account update failure/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM lottery_request_budget').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM budget_updates').get().count, 0);

    db.exec('DROP TRIGGER fail_account_budget');
    assert.equal(store.requestBudget.reserve(request).allowed, true);
    const writes = db.prepare('SELECT scope_key, COUNT(*) AS count FROM budget_updates GROUP BY scope_key').all();
    assert.equal(writes.length, 2);
    for (const row of writes) assert.equal(row.count, 1);
    assert.equal(store.requestBudget.get({ scope: 'streamer-1', nowMs: 1_000 }).requestCount, 1);
  } finally {
    db.close();
  }
});
