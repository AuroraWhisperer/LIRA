'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { SONG_SCHEMA } = require('../../src/storage/schema');
const { createAiConfigStore } = require('../../src/ai/config-store');
const { createAiAssistantService } = require('../../src/ai/ai-assistant-service');
const { AI_CONFIG_DEFAULTS } = require('../../src/ai/config');
const { waitUntil } = require('../helpers/ai-assistant-service-fixture');

function fixture(t, options = {}) {
  let time = 1000000;
  const db = new DatabaseSync(':memory:');
  db.exec(SONG_SCHEMA);
  const store = createAiConfigStore(db, {}, { now: () => time });
  const config = { ...AI_CONFIG_DEFAULTS, enabled: true, trigger: '小米', modelProvider: 'doubao', contextTtlSeconds: 600, roomLimitPerMinute: 120 };
  const requests = [];
  const delivered = [];
  const service = createAiAssistantService({
    store: { ...store, getConfig: () => ({ ...config }) },
    deepseek: { async createResponse(request) {
      requests.push(request);
      return options.respond ? options.respond(request) : { text: `答${requests.length}`, functionCalls: [], usage: {} };
    } },
    tools: {}, now: () => time, delay: async () => {}, log: { warn() {} },
    sendReply: async input => { delivered.push(input.message); return {}; },
    waitForDelivery: options.waitForDelivery,
  });
  t.after(async () => { await service.shutdown(); db.close(); });
  const ask = (question, extra = {}) => service.handleDanmaku({ roomId: '100', uid: 'viewer-a', userName: '同名观众', message: `小米 ${question}`, ...extra });
  const idle = () => waitUntil(() => service.getStatus().queued === 0 && !service.getStatus().delivering);
  return { service, store, db, config, requests, delivered, ask, idle, advance: ms => { time += ms; } };
}

test('3/5 minute gaps retain multiple delivered turns, isolate viewers/rooms, and expire at the boundary', async t => {
  const f = fixture(t);
  f.ask('玩成语接龙，我先出一心一意');
  await f.idle();
  f.advance(180000);
  f.ask('意气风发');
  await f.idle();
  f.ask('给我出谜语', { uid: 'viewer-b' });
  await f.idle();
  f.advance(300000);
  f.ask('继续');
  await f.idle();
  const continued = JSON.parse(f.requests[3].input);
  assert.match(continued.earlierExchanges[0].question, /成语接龙/);
  assert.equal(continued.previousExchange.question, '意气风发');
  assert.equal(JSON.parse(f.requests[2].input).previousExchange, null);
  assert.equal(f.requests[0].conversationKey, f.requests[3].conversationKey);
  f.ask('继续', { roomId: '200' });
  await f.idle();
  assert.equal(JSON.parse(f.requests[4].input).previousExchange, null);
  f.advance(600000);
  f.ask('继续');
  await f.idle();
  assert.equal(JSON.parse(f.requests[5].input).previousExchange, null);
  assert.notEqual(f.requests[0].conversationKey, f.requests[5].conversationKey);
});

test('same viewer waits for delivery while another viewer may generate', async t => {
  const gate = Promise.withResolvers();
  let first = true;
  const f = fixture(t, { waitForDelivery: async () => { if (first) { first = false; await gate.promise; } return true; } });
  f.ask('开局接龙');
  f.ask('继续');
  f.ask('猜谜语', { uid: 'viewer-b' });
  try {
    await waitUntil(() => f.delivered.length === 1 && f.requests.length >= 2);
    assert.equal(JSON.parse(f.requests[1].input).question, '猜谜语');
  } finally {
    gate.resolve();
  }
  await f.idle();
  assert.equal(JSON.parse(f.requests[2].input).previousExchange.question, '开局接龙');
  assert.deepEqual(f.delivered, ['答1', '答3', '答2']);
});

test('end command clears in queue order even when its confirmation never arrives', async t => {
  const f = fixture(t, { waitForDelivery: async () => !f.delivered.at(-1).startsWith('已结束') });
  f.ask('开始猜谜语');
  f.ask('结束对话！');
  f.ask('还记得吗');
  await f.idle();
  assert.equal(f.requests.length, 2);
  assert.equal(JSON.parse(f.requests[1].input).previousExchange, null);
  assert.notEqual(f.requests[0].conversationKey, f.requests[1].conversationKey);
  assert.equal(f.delivered.filter(text => text.startsWith('已结束')).length, 3);
});

test('unidentified messages cannot share persistent memory through a nickname', async t => {
  const f = fixture(t);
  for (const extra of [{ uid: '' }, { uid: '' }, { roomId: '' }, { roomId: '' }]) {
    f.ask('继续', extra);
    await f.idle();
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM ai_viewer_context').get().count, 0);
  assert.ok(f.requests.every(request => JSON.parse(request.input).previousExchange === null));
});

test('a queued request starts fresh when its history expires before generation', async t => {
  const gate = Promise.withResolvers();
  const f = fixture(t, { respond: async request => {
    if (JSON.parse(request.input).question === '等一下') await gate.promise;
    return { text: '接下来继续', functionCalls: [], usage: {} };
  } });
  f.ask('开始接龙');
  await f.idle();
  f.advance(599000);
  f.ask('等一下', { uid: 'viewer-b' });
  try {
    await waitUntil(() => f.requests.length === 2);
    f.ask('继续');
    f.advance(1000);
  } finally {
    gate.resolve();
  }
  await f.idle();
  assert.equal(JSON.parse(f.requests[2].input).previousExchange, null);
  assert.notEqual(f.requests[0].conversationKey, f.requests[2].conversationKey);
});

test('a successful in-flight reply renews its snapshot after expiry, but a failed turn does not', async t => {
  let pending;
  let failing = false;
  const f = fixture(t, { respond: async () => {
    if (pending) await pending.promise;
    if (failing) throw new Error('synthetic failure');
    return { text: '接下来继续', functionCalls: [], usage: {} };
  } });
  f.ask('开始接龙');
  await f.idle();
  f.advance(599000);
  pending = Promise.withResolvers();
  f.ask('接着来');
  try {
    await waitUntil(() => f.requests.length === 2);
    f.advance(1000);
    f.store.pruneExpired();
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM ai_viewer_context').get().count, 0);
  } finally {
    pending.resolve();
    pending = null;
  }
  await f.idle();
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM ai_viewer_context').get().count, 1);
  f.advance(599000);
  failing = true;
  f.ask('再继续');
  await f.idle();
  f.advance(1000);
  f.store.pruneExpired();
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM ai_viewer_context').get().count, 0);
});

test('saved idle time survives reopening while missing settings use the 10 minute default', t => {
  const f = fixture(t);
  assert.equal(f.store.getConfig().contextTtlSeconds, 600);
  f.store.updateConfig({ contextTtlSeconds: 1200 });
  const reopened = createAiConfigStore(f.db, {});
  assert.equal(reopened.getConfig().contextTtlSeconds, 1200);
});
