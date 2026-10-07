'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { commentRecord, openLotteryDatabase } = require('../helpers/dynamic-lottery-fixture');
const { createDynamicLotteryStore } = require('../../src/storage/dynamic-lottery-store');
const { createLotteryDrawStore } = require('../../src/storage/dynamic-lottery-draw-store');
const { createDynamicLotteryService, publicCode } = require('../../src/bilibili/dynamic-lottery/service');
const { normalizeRules, buildCandidatePool, assertSameContext } = require('../../src/bilibili/dynamic-lottery/rules');
const { routes } = require('../../src/server/routes/dynamic-lottery-routes');

const URL = 'https://t.bilibili.com/888';
const RULES = { winnerCount: 1, requireLike: false, requireRepost: false, requireFollow: false };

let recordSequence = 100;
function seedTask(store, id, streamerId, overrides = {}) {
  store.createTask({
    id,
    streamerId,
    ownerUid: '999',
    dynamicId: '888',
    requestId: overrides.requestId || `request-${id}`,
    target: { kind: 'dynamic', url: URL, ownerUid: '999', description: '图文动态' },
    rules: { version: 2, entryAction: 'comment', requiredActions: [], winnerCount: 1, requireFollow: false,
      endsAtMs: 1_000, ...overrides.rules },
    nowMs: 1_000,
  });
  store.beginScan({ id: `scan-${id}`, taskId: id, sessionEpoch: 1, sources: ['comment'], startedAtMs: 1_000 });
  store.commitPage({
    taskId: id, scanId: `scan-${id}`, source: 'comment', expectedCursor: null, sessionEpoch: 1, committedAtMs: 2_000,
    page: { records: [commentRecord(String(recordSequence += 1), '7')], nextCursor: null, ended: true },
  });
  return store.getTask(id);
}

// The fake upstream never answers by itself: each call waits until the test
// releases it, and an aborted job rejects with its abort reason.
function createFixture(t) {
  const db = openLotteryDatabase();
  const store = createDynamicLotteryStore(db);
  const drawStore = createLotteryDrawStore(db);
  let identity = { streamerId: '42', authorizationEpoch: 3 };
  let contextIdentity = identity;
  const requests = [];
  const paused = [];
  const resumed = [];
  const service = createDynamicLotteryService({
    store,
    drawStore,
    clock: { nowMs: () => 5_000, sleep: async () => {} },
    getIdentity: () => identity,
    getContext: async () => ({ ...contextIdentity, sessionEpoch: 1, cookieHeader: 'DedeUserID=999; SESSDATA=synthetic' }),
    request: (input) => new Promise((resolve, reject) => {
      requests.push({ input, resolve, reject });
      input.signal?.addEventListener('abort', () => reject(input.signal.reason), { once: true });
    }),
    resumeRequests: (streamerId) => resumed.push(streamerId),
    pauseRequests: (streamerId, code) => paused.push([streamerId, code]),
  });
  t.after(() => service.dispose());
  return {
    db, store, drawStore, service, requests, paused, resumed,
    // A lagging account context can still report the previous identity.
    setIdentity(value, { contextLags = false } = {}) {
      identity = value;
      if (!contextLags) contextIdentity = value;
    },
    async settle() {
      for (let index = 0; index < 100 && service.getState().job; index += 1) await new Promise(setImmediate);
      assert.equal(service.getState().job, null, 'background job settles');
    },
    async nextRequest() {
      for (let index = 0; index < 100 && !requests.length; index += 1) await new Promise(setImmediate);
      return requests.shift();
    },
  };
}

test('tasks are visible and actionable only by the owning streamer identity', async (t) => {
  const f = createFixture(t);
  const own = seedTask(f.store, 'own-task', '42');
  const foreign = seedTask(f.store, 'foreign-task', '43');
  assert.deepEqual(f.service.getState().tasks.map((task) => task.id), [own.id]);
  assert.throws(() => f.service.getState({ taskId: foreign.id }), { code: 'LOTTERY_TASK_NOT_FOUND' });
  for (const action of ['draw', 'resume']) {
    assert.throws(() => f.service.actOnTask({ taskId: foreign.id, action, revision: foreign.revision }),
      { code: 'LOTTERY_TASK_NOT_FOUND' });
  }
  assert.throws(() => f.service.getState({ taskId: 'x'.repeat(65) }), { code: 'LOTTERY_TASK_NOT_FOUND' });
  assert.equal(f.requests.length, 0, 'a foreign task never reaches the upstream account');
  f.setIdentity({ streamerId: '43', authorizationEpoch: 1 });
  assert.deepEqual(f.service.getState().tasks.map((task) => task.id), [foreign.id]);
  f.setIdentity({ streamerId: '43' });
  assert.throws(() => f.service.getState(), { code: 'LOTTERY_IDENTITY_UNAVAILABLE' });
});

test('a create request is idempotent per streamer, conflicts on changed input and runs one job at a time', async (t) => {
  const f = createFixture(t);
  seedTask(f.store, 'stored', '42', { requestId: 'stored-request-0001', rules: { inputSignature: 'other-input' } });
  seedTask(f.store, 'foreign', '43', { requestId: 'request-aaaaaaaa-0001' });
  assert.throws(() => f.service.createTask({ ...RULES, url: URL, requestId: 'stored-request-0001' }),
    { code: 'LOTTERY_DRAW_CONFLICT' });
  assert.throws(() => f.service.createTask({ ...RULES, url: URL, requestId: 'short' }), { code: 'LOTTERY_RULES_INVALID' });

  const input = { ...RULES, url: URL, requestId: 'request-aaaaaaaa-0001' };
  assert.deepEqual(f.service.createTask(input).job, { kind: 'collect', taskId: null },
    'another streamer reusing the request ID does not block a new task');
  assert.deepEqual(f.resumed, ['42']);
  await f.nextRequest();
  assert.deepEqual(f.service.createTask(input).job, { kind: 'collect', taskId: null });
  assert.throws(() => f.service.createTask({ ...input, winnerCount: 2 }), { code: 'LOTTERY_DRAW_CONFLICT' });
  assert.throws(() => f.service.createTask({ ...input, requestId: 'request-bbbbbbbb-0002' }), { code: 'LOTTERY_BUSY' });
  const stored = f.store.getTask('stored');
  assert.throws(() => f.service.actOnTask({ taskId: stored.id, action: 'draw', revision: stored.revision }),
    { code: 'LOTTERY_BUSY' });
  assert.equal(f.requests.length, 0, 'repeated and rejected requests start no upstream work');
  assert.deepEqual(f.resumed, ['42'], 'a rejected request does not resume the paused budget');

  f.service.actOnTask({ action: 'pause' });
  await f.settle();
  assert.equal(f.service.getState().error, 'LOTTERY_OPERATION_PAUSED');
  assert.equal(f.store.listTasks('42').length, 1, 'the paused create stored no task');
});

test('task actions validate the action and revision before any upstream request', async (t) => {
  const f = createFixture(t);
  const task = seedTask(f.store, 'task', '42');
  assert.throws(() => f.service.actOnTask({ taskId: task.id, action: 'delete', revision: task.revision }),
    { code: 'LOTTERY_RULES_INVALID' });
  for (const revision of [task.revision + 1, undefined, String(task.revision)]) {
    assert.throws(() => f.service.actOnTask({ taskId: task.id, action: 'draw', revision }), { code: 'LOTTERY_DRAW_CONFLICT' });
  }
  const legacy = seedTask(f.store, 'legacy', '42', { rules: { version: 1 } });
  assert.throws(() => f.service.actOnTask({ taskId: legacy.id, action: 'draw', revision: legacy.revision }),
    { code: 'LOTTERY_LEGACY_TASK' });
  assert.equal(f.requests.length, 0);
  assert.deepEqual(f.resumed, []);
});

test('failures expose only a public code to the same identity and pause the shared budget on challenges', async (t) => {
  const f = createFixture(t);
  const task = seedTask(f.store, 'task', '42');
  f.service.actOnTask({ taskId: task.id, action: 'draw', revision: task.revision });
  assert.deepEqual(f.service.getState().job, { kind: 'draw', taskId: task.id });
  (await f.nextRequest()).reject(Object.assign(new Error('SESSDATA=synthetic upstream body'), { code: 'ECONNRESET' }));
  await f.settle();
  assert.equal(f.service.getState().error, 'LOTTERY_OPERATION_FAILED');
  assert.doesNotMatch(JSON.stringify(f.service.getState()), /SESSDATA|upstream body/u);
  f.setIdentity({ streamerId: '43', authorizationEpoch: 1 });
  assert.equal(f.service.getState().error, '', 'another streamer does not see the failure');

  f.setIdentity({ streamerId: '42', authorizationEpoch: 3 });
  f.service.actOnTask({ taskId: task.id, action: 'draw', revision: task.revision });
  (await f.nextRequest()).reject(Object.assign(new Error('challenge'), { code: 'LOTTERY_BILIBILI_CHALLENGE' }));
  await f.settle();
  assert.equal(f.service.getState().error, 'LOTTERY_BILIBILI_CHALLENGE');
  assert.deepEqual(f.paused, [['42', 'LOTTERY_BILIBILI_CHALLENGE']]);

  for (const [code, expected] of [['LOTTERY_BUSY', 'LOTTERY_BUSY'], ['lottery_busy', 'LOTTERY_OPERATION_FAILED'],
    [`LOTTERY_${'A'.repeat(65)}`, 'LOTTERY_OPERATION_FAILED'], ['LOTTERY_BUSY\n', 'LOTTERY_OPERATION_FAILED'],
    [42, 'LOTTERY_OPERATION_FAILED'], [undefined, 'LOTTERY_OPERATION_FAILED']]) {
    assert.equal(publicCode({ code }), expected, String(code));
  }
});

test('an authorization change during a job cannot run it for the new identity', async (t) => {
  const f = createFixture(t);
  const task = seedTask(f.store, 'task', '42');
  f.service.actOnTask({ taskId: task.id, action: 'draw', revision: task.revision });
  f.setIdentity({ streamerId: '42', authorizationEpoch: 4 }, { contextLags: true });
  for (let index = 0; index < 20; index += 1) await new Promise(setImmediate);
  assert.equal(f.requests.length, 0, 'a job queued before re-authorization never runs with the stale account context');
  f.setIdentity({ streamerId: '42', authorizationEpoch: 3 });
  await f.settle();
  assert.equal(f.service.getState().error, 'LOTTERY_SESSION_CHANGED');

  f.service.actOnTask({ taskId: task.id, action: 'draw', revision: task.revision });
  const pending = await f.nextRequest();
  f.setIdentity({ streamerId: '42', authorizationEpoch: 4 });
  assert.equal(f.service.getState().job, null, 'the old job is not reported to the new authorization');
  pending.resolve(new Response(JSON.stringify({ code: 0, data: { isLogin: true, mid: '999',
    wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
      sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png' } } }),
  { headers: { 'content-type': 'application/json' } }));
  for (let index = 0; index < 100 && f.requests.length === 0; index += 1) await new Promise(setImmediate);
  await f.service.dispose();
  assert.equal(f.requests.length, 0, 'no request is made after the identity changed');
  assert.equal(f.drawStore.getResult(task.id), null, 'no draw result is written');
});

test('routes map public lottery codes to HTTP statuses without raw errors', async () => {
  const call = async (dynamicLottery) => {
    const res = { headers: {}, setHeader(name, value) { this.headers[name] = value; },
      writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
    await routes['GET /api/bilibili/dynamic-lottery/state']({ dynamicLottery }, { query: new URLSearchParams() }, res);
    return res;
  };
  const failing = (error) => ({ getState() { throw error; } });
  for (const [error, status, code] of [
    [{ code: 'LOTTERY_IDENTITY_UNAVAILABLE' }, 403, 'LOTTERY_IDENTITY_UNAVAILABLE'],
    [{ code: 'LOTTERY_TASK_NOT_FOUND' }, 404, 'LOTTERY_TASK_NOT_FOUND'],
    [{ code: 'LOTTERY_BUSY' }, 409, 'LOTTERY_BUSY'],
    [{ code: 'LOTTERY_DRAW_CONFLICT' }, 409, 'LOTTERY_DRAW_CONFLICT'],
    [new Error('/data/lottery.sqlite is locked'), 400, 'LOTTERY_OPERATION_FAILED'],
  ]) {
    const res = await call(failing(Object.assign(new Error('raw detail'), error)));
    assert.equal(res.status, status, code);
    assert.deepEqual(res.body, { ok: false, error: code });
    assert.equal(res.headers['Cache-Control'], 'no-store');
  }
  assert.equal((await call(null)).status, 503);
});

test('rules accept only bounded winners and boolean requirements', () => {
  for (const winnerCount of [1, 100]) {
    assert.equal(normalizeRules({ ...RULES, winnerCount }, 10).winnerCount, winnerCount);
  }
  assert.deepEqual(normalizeRules({ ...RULES, requireLike: true, requireRepost: true }, 10).requiredActions, ['like', 'repost']);
  for (const input of [null, [], { ...RULES, winnerCount: 0 }, { ...RULES, winnerCount: 101 }, { ...RULES, winnerCount: 1.5 },
    { ...RULES, winnerCount: '1' }, { ...RULES, requireLike: 'true' }, { ...RULES, requireFollow: undefined }]) {
    assert.throws(() => normalizeRules(input, 10), { code: 'LOTTERY_RULES_INVALID' });
  }
});

test('the candidate pool requires every selected reaction and excludes the owner and late comments', () => {
  const comment = (uid, occurredAtMs = 900) => ({ source: 'comment', uid, recordId: `c-${uid}`, occurredAtMs });
  const reaction = (source, uid) => ({ source, uid, recordId: `${source}-${uid}`, occurredAtMs: null });
  const sources = { comment: { coverage: 'exhausted' }, like: { coverage: 'exhausted' }, repost: { coverage: 'exhausted' } };
  const evidence = [comment('1'), comment('22'), comment('3'), comment('4', 1_001), comment('999'), comment('1'),
    reaction('like', '1'), reaction('like', '22'), reaction('like', '4'), reaction('like', '999'),
    reaction('repost', '1'), reaction('repost', '3'), reaction('repost', '4'), reaction('repost', '999')];
  const pool = (requiredActions, scanSources = sources) => buildCandidatePool({
    task: { ownerUid: '999', rules: { requiredActions, endsAtMs: 1_000 } },
    scan: { status: 'completed', sources: scanSources },
    evidence,
  }).map((candidate) => candidate.uid);
  assert.deepEqual(pool([]), ['1', '3', '22']);
  assert.deepEqual(pool(['like']), ['1', '22']);
  assert.deepEqual(pool(['repost']), ['1', '3']);
  assert.deepEqual(pool(['like', 'repost']), ['1']);
  assert.throws(() => pool(['like'], { ...sources, like: { coverage: 'partial' } }), { code: 'LOTTERY_COLLECTION_INCOMPLETE' });
  assert.throws(() => buildCandidatePool({ task: { ownerUid: '999', rules: { requiredActions: [], endsAtMs: 1 } },
    scan: { status: 'completed', sources }, evidence: [comment('1', null)] }), { code: 'LOTTERY_UPSTREAM_INVALID' });
});

test('the request context must keep streamer, authorization and session epochs', () => {
  const context = { streamerId: '42', authorizationEpoch: 3, sessionEpoch: 1 };
  assert.doesNotThrow(() => assertSameContext(context, { ...context }));
  for (const change of [{ streamerId: '43' }, { authorizationEpoch: 4 }, { sessionEpoch: 2 }]) {
    assert.throws(() => assertSameContext(context, { ...context, ...change }), { code: 'LOTTERY_SESSION_CHANGED' });
  }
  assert.throws(() => assertSameContext(null, context), { code: 'LOTTERY_SESSION_CHANGED' });
});
