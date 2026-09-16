'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const { runDynamicLotteryMigrations } = require('../src/storage/dynamic-lottery-migrations');
const { createDynamicLotteryStore } = require('../src/storage/dynamic-lottery-store');
const { createLotteryDrawStore } = require('../src/storage/dynamic-lottery-draw-store');
const { createDrawService } = require('../src/bilibili/dynamic-lottery/draw-service');
const { parseCommentPage } = require('../src/bilibili/dynamic-lottery/provider-parsers');

function comment(recordId, uid, text, displayName) {
  return {
    source: 'comment', recordId, uid, text, displayName,
    occurredAtMs: 900, parentId: null, level: null,
  };
}

function readyTask(store, id, streamerId, records) {
  store.createTask({
    id, streamerId, ownerUid: '999', dynamicId: '888', requestId: id,
    target: { url: 'https://t.bilibili.com/888', ownerUid: '999' },
    rules: {
      version: 2, entryAction: 'comment', requiredActions: [],
      winnerCount: 2, requireFollow: true, endsAtMs: 1_000,
    },
    nowMs: 1_000,
  });
  store.beginScan({
    id: `scan-${id}`, taskId: id, sessionEpoch: 1,
    sources: ['comment'], startedAtMs: 1_000,
  });
  store.commitPage({
    taskId: id, scanId: `scan-${id}`, source: 'comment', expectedCursor: null,
    page: { records, nextCursor: null, ended: true },
    sessionEpoch: 1, committedAtMs: 2_000,
  });
  return store.getTask(id);
}

test('winner metadata uses the frozen comment and scan, including legacy names, across resume', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  runDynamicLotteryMigrations(db);
  const store = createDynamicLotteryStore(db);
  const drawStore = createLotteryDrawStore(db);
  const text = '<img src=x onerror=alert(1)>\n参与评论'.repeat(50);
  try {
    const task = readyTask(store, 'task-1', 'streamer-1', [
      comment('1', '101', text, '真实昵称'),
      comment('2', '101', '同一用户的另一条评论', '另一个昵称'),
      comment('3', '102', '历史记录仍有评论'),
      comment('4', '999', '作者不参加', '作者'),
    ]);
    readyTask(store, 'task-2', 'streamer-2', [
      comment('1', '101', '其他账号活动的评论', '其他活动昵称'),
    ]);
    let paused = true;
    let shuffleCalls = 0;
    const service = createDrawService({
      store, drawStore,
      getContext: async () => ({ streamerId: 'streamer-1', sessionEpoch: 1 }),
      clock: { nowMs: () => 3_000 },
      randomIntFn: (maximum) => { shuffleCalls += 1; return maximum - 1; },
      provider: {
        verifyOwner: async () => {},
        readRelation: async (uid) => ({
          state: uid === '102' && paused ? 'unknown' : 'eligible',
          reason: 'FOLLOWING', subjectUid: uid, ownerUid: '999', checkedAtMs: 3_000,
        }),
      },
    });
    await assert.rejects(service.start(task, new AbortController().signal),
      { code: 'LOTTERY_RELATION_UNKNOWN' });
    const partial = drawStore.getResult(task.id);
    assert.equal(partial.status, 'paused');
    assert.equal(partial.checkedCount, 1);
    assert.equal(partial.winners[0].displayName, '真实昵称');
    assert.equal(partial.winners[0].commentText, text);
    assert.equal(partial.digest, createHash('sha256').update('["101","102"]').digest('hex'));
    const originalOrder = drawStore.getRound(task.id).order;
    paused = false;
    await service.start(store.getTask(task.id), new AbortController().signal);
    const result = drawStore.getResult(task.id);
    assert.equal(result.status, 'completed');
    assert.equal(result.winners.length, 2);
    assert.equal(result.winners[1].displayName, null);
    assert.equal(result.winners[1].commentText, '历史记录仍有评论');
    assert.equal(result.winners[1].position, 2);
    assert.equal(result.digest, partial.digest);
    assert.deepEqual(drawStore.getRound(task.id).order, originalOrder);
    assert.equal(shuffleCalls, 1);
    assert.equal(drawStore.getResult('task-2'), null);
  } finally {
    db.close();
  }
});

test('missing or invalid optional nickname does not remove an otherwise valid comment', () => {
  for (const uname of [undefined, null, 123, '']) {
    const page = parseCommentPage({ data: {
      replies: [{
        rpid_str: '1', ctime: 1, member: { mid: '101', uname },
        content: { message: '参加' },
      }],
      cursor: { is_end: true },
    } }, null);
    assert.equal(page.records.length, 1);
    assert.equal(page.records[0].displayName, null);
  }
});
