'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { commentRecord, openLotteryDatabase } = require('../helpers/dynamic-lottery-fixture');
const { createDynamicLotteryStore } = require('../../src/storage/dynamic-lottery-store');
const { createLotteryDrawStore } = require('../../src/storage/dynamic-lottery-draw-store');
const { createDynamicLotteryRuntime } = require('../../src/server/dynamic-lottery-runtime');

function task(store, id, streamerId = 'streamer-1', nowMs = 1_000) {
  return store.createTask({
    id, streamerId, ownerUid: '999', dynamicId: '888', requestId: `request-${id}`,
    target: { url: 'https://t.bilibili.com/888', ownerUid: '999', description: '当前抽奖' },
    rules: { version: 2, entryAction: 'comment', requiredActions: [], winnerCount: 1,
      requireFollow: false, endsAtMs: 1_000, inputSignature: `signature-${id}` },
    nowMs,
  });
}

function frozen(store, drawStore, current) {
  store.beginScan({ id: `scan-${current.id}`, taskId: current.id, sessionEpoch: 1, sources: ['comment'], startedAtMs: 2_000 });
  store.commitPage({
    taskId: current.id, scanId: `scan-${current.id}`, source: 'comment', expectedCursor: null,
    page: { records: [commentRecord('1', '123', { text: '必须随旧场清理的评论', displayName: '中奖昵称' })], nextCursor: null, ended: true },
    sessionEpoch: 1, committedAtMs: 2_100,
  });
  return drawStore.freeze({ task: store.getTask(current.id), members: [{ uid: '123', source: 'comment', recordId: '1' }],
    order: ['123'], digest: 'fixture-digest', nowMs: 2_200 });
}

function finish(store, drawStore, current, state = 'eligible') {
  const round = drawStore.getRound(current.id) || frozen(store, drawStore, current);
  drawStore.setStatus(current, 'drawing', '', 2_300);
  drawStore.recordCheck({ task: current, roundId: round.id, index: 0, uid: '123',
    verification: { state, reason: 'fixture', ownerUid: '999', subjectUid: '123' }, nowMs: 2_400 });
}

function snapshot(db) {
  const tables = ['lottery_tasks', 'lottery_scans', 'lottery_evidence', 'lottery_rounds', 'lottery_round_members',
    'lottery_orders', 'lottery_awards', 'lottery_events', 'lottery_request_budget'];
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
}

test('current results remain readable until successful creation deletes the complete prior task tree', (t) => {
  const db = openLotteryDatabase();
  t.after(() => db.close());
  const store = createDynamicLotteryStore(db);
  const drawStore = createLotteryDrawStore(db);
  const previous = task(store, 'previous');
  finish(store, drawStore, previous);
  const result = drawStore.getResult(previous.id);
  assert.equal(result.status, 'completed');
  assert.equal(result.winners[0].displayName, '中奖昵称');
  store.pruneCompletedHistory();
  assert.deepEqual(drawStore.getResult(previous.id), result, 'the current completed task survives restart cleanup');
  store.requestBudget.setHold({ scope: 'streamer-1', reason: 'COOLING_DOWN', nowMs: 2_500 });
  const budget = db.prepare('SELECT * FROM lottery_request_budget').all();
  const next = task(store, 'next', 'streamer-1', 3_000);
  assert.equal(store.getTask(previous.id), null);
  assert.equal(drawStore.getResult(previous.id), null);
  assert.equal(store.getTask(next.id).status, 'draft');
  for (const table of ['lottery_scans', 'lottery_evidence', 'lottery_rounds', 'lottery_round_members', 'lottery_orders', 'lottery_awards'])
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0, table);
  const receipts = db.prepare('SELECT * FROM lottery_events').all();
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].event_type, 'create-retired');
  assert.equal(receipts[0].task_id, null);
  assert.equal(receipts[0].round_id, null);
  assert.equal(receipts[0].payload_json, '{}');
  assert.deepEqual(store.findCreateReceipt('streamer-1', previous.requestId), { inputSignature: 'signature-previous' });
  assert.throws(() => task(store, 'previous'), { code: 'LOTTERY_TASK_CLEARED' });
  assert.equal(store.pruneCompletedHistory(), 0);
  assert.deepEqual(db.prepare('SELECT * FROM lottery_request_budget').all(), budget);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('new draws remove completed and exhausted tasks only within their streamer while preserving resumable work', (t) => {
  const db = openLotteryDatabase();
  t.after(() => db.close());
  const store = createDynamicLotteryStore(db);
  const drawStore = createLotteryDrawStore(db);
  const completed = task(store, 'completed');
  const exhausted = task(store, 'exhausted');
  const paused = task(store, 'paused');
  const collecting = task(store, 'collecting');
  const frozenTask = task(store, 'frozen');
  const foreign = task(store, 'foreign', 'streamer-2');
  finish(store, drawStore, completed);
  finish(store, drawStore, exhausted, 'ineligible');
  frozen(store, drawStore, paused);
  drawStore.setStatus(paused, 'paused', 'LOTTERY_OPERATION_PAUSED', 2_500);
  store.beginScan({ id: 'scan-collecting', taskId: collecting.id, sessionEpoch: 1, sources: ['comment'], startedAtMs: 2_500 });
  frozen(store, drawStore, frozenTask);
  finish(store, drawStore, foreign);
  const preserved = [paused, collecting, frozenTask, foreign].map((current) => ({ task: store.getTask(current.id), round: drawStore.getRound(current.id) }));
  task(store, 'next', 'streamer-1', 3_000);
  assert.equal(store.getTask(completed.id), null);
  assert.equal(store.getTask(exhausted.id), null);
  for (const before of preserved) {
    assert.deepEqual(store.getTask(before.task.id), before.task);
    assert.deepEqual(drawStore.getRound(before.task.id), before.round);
  }
  assert.equal(store.findCreateReceipt('streamer-2', completed.requestId), null);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('restart cleanup follows the default selected task and preserves paused progress across reopen', async (t) => {
  const scratch = path.resolve(__dirname, '../../tmp');
  fs.mkdirSync(scratch, { recursive: true });
  const dir = fs.mkdtempSync(path.join(scratch, 'lottery-retention-'));
  const file = path.join(dir, 'lottery.db');
  let db = openLotteryDatabase(file);
  let runtime;
  t.after(async () => {
    await runtime?.dispose();
    db.close();
    assert.equal(path.dirname(path.resolve(dir)), scratch);
    assert.ok(path.basename(dir).startsWith('lottery-retention-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  let store = createDynamicLotteryStore(db);
  let drawStore = createLotteryDrawStore(db);
  const old = task(store, 'a-old');
  const current = task(store, 'z-current');
  const otherOld = task(store, 'other-old', 'streamer-2', 1_000);
  const otherCurrent = task(store, 'other-current', 'streamer-2', 2_000);
  finish(store, drawStore, old);
  finish(store, drawStore, current);
  finish(store, drawStore, otherOld, 'ineligible');
  frozen(store, drawStore, otherCurrent);
  drawStore.setStatus(otherCurrent, 'drawing', '', 2_500);
  const expectedResult = drawStore.getResult(current.id);
  const expectedOrder = drawStore.getRound(otherCurrent.id).order;
  db.close();
  db = openLotteryDatabase(file);
  let streamerId = 'streamer-1';
  runtime = createDynamicLotteryRuntime({ db,
    auth: { getIdentity: () => ({ streamerId, authorizationEpoch: 1 }), getContext: () => { throw new Error('startup must stay offline'); } },
    fetchImpl: () => { throw new Error('startup must not fetch'); },
  });
  store = createDynamicLotteryStore(db);
  drawStore = createLotteryDrawStore(db);
  assert.equal(runtime.getState().task.id, current.id, 'equal dates use the same descending ID tie break as the UI');
  assert.deepEqual(runtime.getState().result, expectedResult);
  assert.equal(store.getTask(old.id), null);
  assert.equal(store.getTask(otherOld.id), null, 'a newer unfinished task supersedes the old finished result');
  streamerId = 'streamer-2';
  assert.equal(runtime.getState().task.status, 'paused');
  assert.deepEqual(drawStore.getRound(otherCurrent.id).order, expectedOrder);
  assert.equal(store.pruneCompletedHistory(), 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM lottery_events WHERE event_type = 'create-retired'").get().n, 2);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  await runtime.dispose();
  runtime = null;
  db.close();
  db = openLotteryDatabase(file);
  store = createDynamicLotteryStore(db);
  assert.deepEqual(store.findCreateReceipt('streamer-1', old.requestId), { inputSignature: 'signature-a-old' });
  assert.throws(() => task(store, old.id), { code: 'LOTTERY_TASK_CLEARED' });
  assert.equal(store.pruneCompletedHistory(), 0);
});

test('cleanup and creation roll back together if evidence deletion or request receipt persistence fails', (t) => {
  const db = openLotteryDatabase();
  t.after(() => db.close());
  const store = createDynamicLotteryStore(db);
  const drawStore = createLotteryDrawStore(db);
  const previous = task(store, 'previous');
  finish(store, drawStore, previous);
  const before = snapshot(db);
  db.exec("CREATE TRIGGER fail_history_delete BEFORE DELETE ON lottery_evidence BEGIN SELECT RAISE(ABORT, 'cannot delete history'); END");
  assert.throws(() => task(store, 'next'), /cannot delete history/);
  assert.deepEqual(snapshot(db), before);
  db.exec('DROP TRIGGER fail_history_delete');
  db.exec("CREATE TRIGGER fail_history_receipt BEFORE INSERT ON lottery_events WHEN NEW.event_type = 'create-retired' BEGIN SELECT RAISE(ABORT, 'cannot save receipt'); END");
  assert.throws(() => task(store, 'next'), /cannot save receipt/);
  assert.deepEqual(snapshot(db), before);
  db.exec('DROP TRIGGER fail_history_receipt');
  task(store, 'next');
  assert.equal(store.getTask(previous.id), null);
  assert.equal(store.findCreateReceipt('streamer-1', previous.requestId).inputSignature, 'signature-previous');
});
