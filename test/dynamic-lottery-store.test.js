'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations } = require('../src/storage/schema');
const { DYNAMIC_LOTTERY_SCHEMA } = require('../src/storage/dynamic-lottery-schema');

const {
  runDynamicLotteryMigrations,
} = require('../src/storage/dynamic-lottery-migrations');
const {
  createDynamicLotteryStore,
} = require('../src/storage/dynamic-lottery-store');

function openDatabase(filePath = ':memory:') {
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA foreign_keys = ON');
  runDynamicLotteryMigrations(db);
  return db;
}

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

function evidence(recordId = '1') {
  return {
    source: 'comment',
    recordId,
    uid: '123',
    occurredAtMs: 900,
    text: '参加抽奖',
    parentId: null,
    level: 5,
  };
}

test('dynamic lottery migrations create nine tables idempotently', () => {
  const db = openDatabase();
  try {
    const first = runDynamicLotteryMigrations(db);
    assert.equal(first.applied, 0);
    assert.equal(first.to, 2);
    assert.deepEqual(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'lottery_%' ORDER BY name",
        )
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
      id: 'scan-1', taskId: 'task-1', sessionEpoch: 4,
      sources: ['comment'], startedAtMs: 2_100,
    });
    db.prepare(`INSERT INTO lottery_evidence
      (scan_id, source, record_id, uid, text, occurred_at_ms, created_at_ms)
      VALUES ('scan-1', 'comment', '1', '123', ?, 900, 2200)`)
      .run('旧评论\n<img src=x onerror=alert(1)>');
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
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-lottery-budget-'),
  );
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
    assert.equal(
      store.requestBudget.get({ scope: 'streamer-1', nowMs: 2_000 })
        .holdReason,
      'VERIFICATION_REQUIRED',
    );
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
