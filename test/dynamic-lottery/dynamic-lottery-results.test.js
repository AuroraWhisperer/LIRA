'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const path = require('node:path');
const test = require('node:test');
const { commentRecord, openLotteryDatabase } = require('../helpers/dynamic-lottery-fixture');
const { createScratchDirectory } = require('../helpers/scratch-directory');
const { createDynamicLotteryStore } = require('../../src/storage/dynamic-lottery-store');
const { createLotteryDrawStore } = require('../../src/storage/dynamic-lottery-draw-store');
const { createDrawService } = require('../../src/bilibili/dynamic-lottery/draw-service');
const { parseCommentPage } = require('../../src/bilibili/dynamic-lottery/provider-parsers');

const comment = (recordId, uid, text, displayName) => commentRecord(recordId, uid, { text, displayName });

function readyTask(store, id, streamerId, records) {
  store.createTask({
    id,
    streamerId,
    ownerUid: '999',
    dynamicId: '888',
    requestId: id,
    target: { url: 'https://t.bilibili.com/888', ownerUid: '999' },
    rules: {
      version: 2,
      entryAction: 'comment',
      requiredActions: [],
      winnerCount: 2,
      requireFollow: true,
      endsAtMs: 1_000,
    },
    nowMs: 1_000,
  });
  store.beginScan({
    id: `scan-${id}`,
    taskId: id,
    sessionEpoch: 1,
    sources: ['comment'],
    startedAtMs: 1_000,
  });
  store.commitPage({
    taskId: id,
    scanId: `scan-${id}`,
    source: 'comment',
    expectedCursor: null,
    page: { records, nextCursor: null, ended: true },
    sessionEpoch: 1,
    committedAtMs: 2_000,
  });
  return store.getTask(id);
}

test('winner metadata uses the frozen comment and scan, including legacy names, across resume', async () => {
  const db = openLotteryDatabase();
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
    readyTask(store, 'task-2', 'streamer-2', [comment('1', '101', '其他账号活动的评论', '其他活动昵称')]);
    let paused = true;
    let shuffleCalls = 0;
    const service = createDrawService({
      store,
      drawStore,
      getContext: async () => ({ streamerId: 'streamer-1', sessionEpoch: 1 }),
      clock: { nowMs: () => 3_000 },
      randomIntFn: (maximum) => {
        shuffleCalls += 1;
        return maximum - 1;
      },
      provider: {
        verifyOwner: async () => {},
        readRelation: async (uid) => ({
          state: uid === '102' && paused ? 'unknown' : 'eligible',
          reason: 'FOLLOWING',
          subjectUid: uid,
          ownerUid: '999',
          checkedAtMs: 3_000,
        }),
      },
    });
    await assert.rejects(service.start(task, new AbortController().signal), { code: 'LOTTERY_RELATION_UNKNOWN' });
    const partial = drawStore.getResult(task.id);
    assert.equal(partial.status, 'paused');
    assert.equal(partial.reason, 'LOTTERY_RELATION_UNKNOWN');
    assert.equal(partial.checkedCount, 1);
    assert.equal(partial.winners[0].displayName, '真实昵称');
    assert.equal(partial.winners[0].commentText, text);
    assert.equal(partial.digest, createHash('sha256').update('["101","102"]').digest('hex'));
    const originalOrder = drawStore.getRound(task.id).order;
    paused = false;
    await service.start(store.getTask(task.id), new AbortController().signal);
    const result = drawStore.getResult(task.id);
    assert.equal(result.status, 'completed');
    assert.equal(result.reason, '', 'the previous pause reason is absent after completing the draw');
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

test('candidate checks and progress reads do not repeatedly parse the frozen candidate order', async () => {
  const db = openLotteryDatabase();
  const store = createDynamicLotteryStore(db);
  try {
    const records = Array.from({ length: 1000 }, (_, index) => commentRecord(String(index + 1), String(index + 10000)));
    const task = readyTask(store, 'large-draw', 'streamer-1', records);
    const order = records.map(record => record.uid);
    createLotteryDrawStore(db).freeze({ task, members: records, order, digest: 'frozen-fixture', nowMs: 2500 });
    const drawStore = createLotteryDrawStore(db);
    let checked = 0;
    const service = createDrawService({
      store, drawStore,
      getContext: async () => ({ streamerId: 'streamer-1', sessionEpoch: 1 }),
      clock: { nowMs: () => 3000 },
      provider: {
        verifyOwner: async () => {},
        readRelation: async uid => {
          drawStore.getResult(task.id);
          checked += 1;
          return { state: checked > 18 ? 'eligible' : 'ineligible', reason: 'FOLLOWING', subjectUid: uid,
            ownerUid: '999', checkedAtMs: 3000 };
        },
      },
    });
    const serializedOrder = JSON.stringify(order);
    const parse = JSON.parse;
    let orderParses = 0;
    let result;
    JSON.parse = function (value, ...args) {
      if (value === serializedOrder) orderParses += 1;
      return parse.call(this, value, ...args);
    };
    try {
      await service.start(store.getTask(task.id), new AbortController().signal);
      result = drawStore.getResult(task.id);
    } finally {
      JSON.parse = parse;
    }
    assert.equal(result.checkedCount, 20);
    assert.deepEqual(result.winners.map(winner => winner.uid), ['10018', '10019']);
    assert.equal(orderParses, 1, 'checking a small prefix and reading progress reuse one immutable order');
  } finally {
    db.close();
  }
});

test('frozen order snapshots remain detached and reflect rollback and other database connections', (t) => {
  const scratch = createScratchDirectory('lottery-order-', t);
  const dbPath = path.join(scratch, 'lottery.db');
  const db = openLotteryDatabase(dbPath);
  let other;
  try {
    const store = createDynamicLotteryStore(db);
    const drawStore = createLotteryDrawStore(db);
    const records = [commentRecord('1', '101'), commentRecord('2', '102')];
    const task = readyTask(store, 'order-isolation', 'streamer-1', records);
    const round = drawStore.freeze({ task, members: records, order: ['101', '102'], digest: 'fixture', nowMs: 2500 });
    round.order.reverse();
    assert.deepEqual(drawStore.getRound(task.id).order, ['101', '102']);
    db.exec('BEGIN');
    db.prepare('UPDATE lottery_orders SET order_json = ? WHERE id = ?').run('["102","101"]', round.orderId);
    assert.deepEqual(drawStore.getRound(task.id).order, ['102', '101']);
    db.exec('ROLLBACK');
    assert.deepEqual(drawStore.getRound(task.id).order, ['101', '102']);
    other = openLotteryDatabase(dbPath);
    other.prepare('UPDATE lottery_orders SET order_json = ? WHERE id = ?').run('["102","101"]', round.orderId);
    assert.deepEqual(drawStore.getRound(task.id).order, ['102', '101']);
    drawStore.setStatus(task, 'drawing', '', 3000);
    assert.throws(() => drawStore.recordCheck({ task, roundId: round.id, index: 0, uid: '101',
      verification: { state: 'eligible', reason: 'FOLLOWING' }, nowMs: 3001 }), { code: 'LOTTERY_DRAW_CONFLICT' });
    assert.equal(drawStore.getRound(task.id).nextIndex, 0);
  } finally {
    other?.close();
    db.close();
  }
});

test('missing or invalid optional nickname does not remove an otherwise valid comment', () => {
  for (const uname of [undefined, null, 123, '']) {
    const page = parseCommentPage(
      {
        data: {
          replies: [
            {
              rpid_str: '1',
              ctime: 1,
              member: { mid: '101', uname },
              content: { message: '参加' },
            },
          ],
          cursor: { is_end: true },
        },
      },
      null,
    );
    assert.equal(page.records.length, 1);
    assert.equal(page.records[0].displayName, null);
  }
});
