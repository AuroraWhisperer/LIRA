'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAiAssistantService } = require('../src/ai/ai-assistant-service');
const { AI_CONFIG_DEFAULTS } = require('../src/ai/config');

async function until(condition) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    if (condition()) return;
    await new Promise(setImmediate);
  }
  assert.fail('AI operation did not reach the expected checkpoint');
}

function fixture(t, overrides = {}) {
  let context = { question: '旧问', answer: '旧答' };
  const commits = [];
  const pending = [];
  const sent = [];
  const service = createAiAssistantService({
    store: {
      getConfig: () => ({ ...AI_CONFIG_DEFAULTS, enabled: true, trigger: '小米', deepseekApiKey: 'test-key', deepseekResponsesUrl: 'https://example.test/responses', model: 'test-model', generationConcurrency: 3, userCooldownSeconds: 0 }),
      isBlacklisted: () => false, getContext: () => context,
      setContext(_uid, value) { context = value; commits.push(value); },
      getCache: overrides.getCache || (() => null), setCache() {}, logRequest() {},
    },
    deepseek: { async createResponse(request) {
      if (request.purpose !== 'generation') return { text: '{"allowed":true}', usage: {}, functionCalls: [] };
      return new Promise((resolve) => pending.push({ request, resolve: (text) => resolve({ text, usage: {}, functionCalls: [] }) }));
    } },
    tools: {}, now: () => 100000, delay: async () => {}, random: () => 0,
    sendReply: async (value) => { sent.push(value.message); return {}; },
    waitForDelivery: overrides.waitForDelivery,
    log: { warn() {} },
  });
  t.after(async () => {
    const stopping = service.shutdown();
    for (const job of pending) job.resolve('cleanup');
    await stopping;
  });
  return {
    service, pending, sent, commits, context: () => context,
    ask(question) { assert.equal(service.handleDanmaku({ uid: 'viewer', userName: '观众', message: `小米 ${question}` }).accepted, true); },
  };
}

for (const cached of [false, true]) {
  test(`AI commits same-viewer answers in delivered order (${cached ? 'cached B' : 'fast B'})`, async (t) => {
    const f = fixture(t, { getCache: cached ? (key) => JSON.parse(key)[4] === '第二问' ? { text: '第二答', category: 'chat' } : null : undefined });
    f.ask('第一问');
    f.ask('第二问');
    await until(() => f.pending.length === (cached ? 1 : 2));
    if (!cached) f.pending[1].resolve('第二答');
    await until(() => f.service.getStatus().ready === 1);
    assert.equal(f.commits.length, 0);
    f.pending[0].resolve('第一答');
    await until(() => f.commits.length === 2);
    assert.deepEqual(f.sent, ['第一答', '第二答']);
    assert.deepEqual(f.commits.map((value) => value.question), ['第一问', '第二问']);
    f.ask('第三问');
    await until(() => f.pending.length === (cached ? 2 : 3));
    const third = f.pending.at(-1);
    assert.match(String(third.request.input), /第二问/);
    assert.match(String(third.request.input), /第二答/);
    assert.doesNotMatch(String(third.request.input), /第一答/);
    third.resolve('第三答');
    await until(() => f.commits.length === 3);
  });
}

for (const delivered of [true, false]) {
  test(`AI commits only the confirmed retry; terminal delivery ${delivered ? 'success' : 'failure'}`, async (t) => {
    let confirmations = 0;
    const f = fixture(t, { waitForDelivery: async () => ++confirmations > 1 && delivered });
    f.ask('第一问');
    await until(() => f.pending.length === 1);
    f.pending[0].resolve('未确认回答');
    await until(() => f.pending.length === 2);
    assert.equal(f.commits.length, 0);
    assert.deepEqual(f.pending[1].request.input, f.pending[0].request.input);
    f.pending[1].resolve('重试回答');
    if (!delivered) {
      await until(() => f.pending.length === 3);
      f.pending[2].resolve('最终未送达');
    }
    await until(() => !f.service.getStatus().delivering && f.service.getStatus().queued === 0);
    assert.deepEqual(f.context(), delivered
      ? { question: '第一问', answer: '重试回答' }
      : { question: '旧问', answer: '旧答' });
    assert.equal(f.commits.length, delivered ? 1 : 0);
  });
}
