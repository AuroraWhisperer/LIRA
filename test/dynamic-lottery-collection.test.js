'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');

const {
  createCollectionService,
} = require('../src/bilibili/dynamic-lottery/collection-service');
const {
  runDynamicLotteryMigrations,
} = require('../src/storage/dynamic-lottery-migrations');
const {
  createDynamicLotteryStore,
} = require('../src/storage/dynamic-lottery-store');

function record(recordId, uid, occurredAtMs) {
  return {
    source: 'comment',
    recordId,
    uid,
    occurredAtMs,
    text: '参加抽奖',
    parentId: null,
    level: null,
  };
}

function createFixture(options = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  runDynamicLotteryMigrations(db);
  const store = createDynamicLotteryStore(db);
  let now = options.nowMs ?? 2_000;
  let sessionEpoch = 1;
  const calls = [];
  const pages = [...(options.pages || [])];
  const provider = {
    async readPage(input) {
      calls.push(input);
      const page = pages.shift();
      if (page instanceof Error) throw page;
      assert.ok(page, 'unexpected collection page request');
      if (options.switchSessionAfterRead) sessionEpoch += 1;
      return page;
    },
  };
  store.createTask({
    id: 'task-1',
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
    nowMs: 500,
  });
  const service = createCollectionService({
    store,
    provider,
    getContext: async () => ({
      streamerId: 'streamer-1',
      ownerUid: '999',
      sessionEpoch,
    }),
    clock: { nowMs: () => now },
  });
  return {
    db,
    store,
    service,
    calls,
    setNow(value) {
      now = value;
    },
  };
}

test('collection starts only by explicit post-cutoff action and never draws', async () => {
  const fixture = createFixture({
    nowMs: 999,
    pages: [
      {
        records: [record('1', '101', 999), record('2', '102', 1_001)],
        nextCursor: 'cursor-2',
        ended: false,
      },
      {
        records: [record('1', '101', 999), record('3', '103', 1_000)],
        nextCursor: null,
        ended: true,
      },
    ],
  });
  try {
    assert.equal(fixture.calls.length, 0);
    await assert.rejects(
      fixture.service.start({ taskId: 'task-1' }),
      (error) => error.code === 'LOTTERY_COLLECTION_NOT_READY',
    );
    assert.equal(fixture.calls.length, 0);

    fixture.setNow(2_000);
    const task = await fixture.service.start({ taskId: 'task-1' });
    assert.equal(task.status, 'ready');
    assert.equal(fixture.calls.length, 2);
    assert.deepEqual(
      fixture.store.getEvidence(task.activeScanId).map((item) => item.recordId),
      ['1', '2', '3'],
    );
  } finally {
    await fixture.service.dispose();
    fixture.db.close();
  }
});

test('collection rejects a response from a changed session before commit', async () => {
  const fixture = createFixture({
    switchSessionAfterRead: true,
    pages: [
      {
        records: [record('1', '101', 900)],
        nextCursor: null,
        ended: true,
      },
    ],
  });
  try {
    const task = await fixture.service.start({ taskId: 'task-1' });
    assert.equal(task.status, 'paused');
    assert.equal(fixture.store.getEvidence(task.activeScanId).length, 0);
    assert.equal(
      fixture.store.getScan(task.activeScanId).pauseReason,
      'LOTTERY_SESSION_CHANGED',
    );
  } finally {
    await fixture.service.dispose();
    fixture.db.close();
  }
});
