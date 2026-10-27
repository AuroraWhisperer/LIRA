'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AI_CONFIG_DEFAULTS } = require('../../src/ai/config');
const { createAnsweringDeepseek, createTestService, waitUntil } = require('../helpers/ai-assistant-service-fixture');
const { createDanmakuSenderService } = require('../../src/bilibili/danmaku/sender-service');

for (const config of [{ modelProvider: 'doubao' }, { modelProvider: 'openai', modelAuthMode: 'subscription', deepseekApiKey: '' }]) {
test(`${config.modelProvider} account changes discard accepted replies and prevent new admissions`, async t => {
  let revision = 1;
  let ready = true;
  let generating = false;
  const pending = Promise.withResolvers();
  const sent = [];
  const service = createTestService({
    config,
    deepseek: {
      isReady: () => ready,
      getSessionRevision: () => revision,
      async createResponse(request) {
        if (request.purpose !== 'generation') return { text: '{"allowed":true}', functionCalls: [], usage: {} };
        generating = true;
        await pending.promise;
        return { text: '旧会话的答案', functionCalls: [], usage: {} };
      },
    },
    sendReply: async value => sent.push(value),
  });
  t.after(async () => { pending.resolve(); await service.shutdown(); });
  assert.equal(service.handleDanmaku({ uid: 'old', message: '小米 你好' }).accepted, true);
  await waitUntil(() => generating);
  revision++;
  ready = false;
  assert.equal(service.handleDanmaku({ uid: 'paused', message: '小米 你好' }).accepted, false);
  pending.resolve();
  await waitUntil(() => service.getStatus().queued === 0);
  assert.deepEqual(sent, []);
  assert.equal(service.getStatus().lastError, '');
});
}

test('switching into account mode cancels the previous provider generation', async t => {
  let signal;
  const service = createTestService({ deepseek: {
    createResponse(request) {
      signal = request.signal;
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    },
  } });
  t.after(() => service.shutdown());
  service.handleDanmaku({ uid: 'old', message: '小米 测试' });
  await waitUntil(() => signal);
  service.updateConfig({ modelProvider: 'doubao' });
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason.code, 'DOUBAO_SESSION_CHANGED');
  assert.equal(service.getStatus().queued, 0);
});

test('disabling AI clears waiting and ready replies, aborts generation, and reopening accepts only new work', async (t) => {
  const pending = Promise.withResolvers();
  const sent = [];
  const generated = [];
  let oldSignal;
  const service = createTestService({
    config: { generationConcurrency: 2 },
    deepseek: { async createResponse(request) {
      if (request.purpose !== 'generation') return { text: '{"allowed":true}', functionCalls: [], usage: {} };
      generated.push(request.input);
      if (generated.length === 1 || generated.length === 3) {
        oldSignal ||= request.signal;
        await pending.promise; // A provider may settle after ignoring cancellation.
      }
      return { text: request.input, functionCalls: [], usage: {} };
    } },
    sendReply: async value => sent.push(value.mentionTarget.uid),
  });
  t.after(async () => { pending.resolve(); await service.shutdown(); });
  for (const uid of ['old-generating', 'old-ready', 'old-generating-two', 'old-waiting']) {
    service.handleDanmaku({ uid, userName: uid, message: '小米 测试问题' });
  }
  await waitUntil(() => service.getStatus().ready === 1 && service.getStatus().waiting === 1);
  service.updateConfig({ enabled: false });
  assert.equal(oldSignal.aborted, true);
  assert.equal(oldSignal.reason.code, 'AI_DISABLED');
  assert.equal(service.getStatus().queued, 0);
  assert.equal(service.handleDanmaku({ uid: 'off', message: '小米 问题' }).accepted, false);
  service.updateConfig({ enabled: true });
  assert.equal(service.handleDanmaku({ uid: 'new', userName: '新观众', message: '小米 新问题' }).accepted, true);
  await waitUntil(() => sent.length === 1);
  pending.resolve();
  await service.shutdown();
  assert.deepEqual(sent, ['new']);
  assert.equal(generated.length, 4, 'the old waiting task is never generated');
});

test('disabling during delivery confirmation cancels retries without recording a failure', async (t) => {
  const sent = [];
  const audit = [];
  let confirmation;
  let generations = 0;
  const service = createTestService({
    store: { logRequest: entry => audit.push(entry) },
    deepseek: createAnsweringDeepseek(() => `answer-${++generations}`),
    sendReply: async value => { sent.push(value.message); return { messages: [value.message] }; },
    waitForDelivery: async ({ signal }) => {
      if (confirmation) return true;
      confirmation = signal;
      return new Promise(resolve => signal.addEventListener('abort', () => resolve(false), { once: true }));
    },
  });
  t.after(() => service.shutdown());
  service.handleDanmaku({ uid: 'old', userName: '旧观众', message: '小米 测试' });
  await waitUntil(() => confirmation);
  service.updateConfig({ enabled: false });
  service.updateConfig({ enabled: true });
  assert.equal(confirmation.aborted, true);
  service.handleDanmaku({ uid: 'new', userName: '新观众', message: '小米 新问题' });
  await waitUntil(() => sent.length === 2 && !service.getStatus().delivering);
  assert.equal(generations, 2);
  assert.equal(audit.some(entry => entry.status === 'failed'), false);
});

test('disabling between actual sender chunks keeps the sent part and cancels the rest across reopening', async (t) => {
  const betweenChunks = Promise.withResolvers();
  const sent = [];
  let waiting = false;
  const sender = createDanmakuSenderService({
    getAuth: async () => ({ loggedIn: true, uid: 9, cookieHeader: 'synthetic' }),
    getRoom: async () => ({ roomId: '100' }),
    createClient: () => ({ resolveRoomInfo: async () => ({ roomId: '100' }),
      sendDanmaku: async (_room, message) => { sent.push(message); return { message }; } }),
    delay: async () => { waiting = true; await betweenChunks.promise; },
    log() {},
  });
  const service = createTestService({
    deepseek: createAnsweringDeepseek(() => '回答'.repeat(40)),
    sendReply: sender.send,
  });
  t.after(async () => { betweenChunks.resolve(); await service.shutdown(); });
  service.handleDanmaku({ uid: 'old', userName: '观众', message: '小米 测试' });
  await waitUntil(() => waiting);
  service.updateConfig({ enabled: false });
  service.updateConfig({ enabled: true });
  betweenChunks.resolve();
  await sender.send({ message: '手动弹幕', rateLimitIntervalMs: 0 });
  assert.equal(sent.length, 2);
  assert.equal(sent[1], '手动弹幕', 'cancellation does not stop unrelated sender operations');
});

test('unrelated config updates and failed disabling do not cancel an accepted reply', async (t) => {
  const pending = Promise.withResolvers();
  const sent = [];
  let signal;
  const service = createTestService({
    store: { updateConfig(changes) { if (changes.enabled === false) throw new Error('Synthetic save failure'); return changes; } },
    deepseek: { async createResponse(request) {
      signal = request.signal;
      if (request.purpose === 'generation') await pending.promise;
      return { text: request.purpose === 'generation' ? '正常回答' : '{"allowed":true}', functionCalls: [], usage: {} };
    } },
    sendReply: async value => sent.push(value),
  });
  t.after(async () => { pending.resolve(); await service.shutdown(); });
  service.handleDanmaku({ uid: 'one', userName: '观众', message: '小米 测试' });
  await waitUntil(() => signal);
  service.updateConfig({ model: 'another-model' });
  assert.equal(signal.aborted, false);
  assert.throws(() => service.updateConfig({ enabled: false }), /Synthetic save failure/);
  assert.equal(signal.aborted, false);
  pending.resolve();
  await waitUntil(() => sent.length === 1);
});

test('provider connection tests dispatch with the saved private configuration', async () => {
  const received = [];
  const service = createTestService({
    deepseek: {
      async testConnection(config) {
        received.push(['deepseek', config.deepseekApiKey]);
        return { provider: 'deepseek' };
      },
    },
    tools: {
      qweather: {
        async testConnection(config) {
          received.push(['qweather', config.deepseekApiKey]);
          return { provider: 'qweather' };
        },
      },
      amap: {
        async testConnection(config) {
          received.push(['amap', config.deepseekApiKey]);
          return { provider: 'amap' };
        },
      },
      getCurrentTime() {},
    },
  });

  service.updateConfig({ enabled: false });
  assert.deepEqual(await service.testProvider('deepseek'), {
    provider: 'deepseek',
  });
  assert.deepEqual(await service.testProvider('qweather'), {
    provider: 'qweather',
  });
  assert.deepEqual(await service.testProvider('amap'), { provider: 'amap' });
  await assert.rejects(service.testProvider('unknown'), (error) => error.code === 'AI_PROVIDER_UNKNOWN');
  assert.deepEqual(received, [
    ['deepseek', 'secret'],
    ['qweather', 'secret'],
    ['amap', 'secret'],
  ]);
});

test('shutdown aborts and drains active generation without writes or delivery', async () => {
  const writes = [];
  const deliveries = [];
  let requestSignal;
  const service = createTestService({
    store: {
      getCache: () => null,
      getContext: () => null,
      setCache: () => writes.push('cache'),
      setContext: () => writes.push('context'),
      logRequest: () => writes.push('audit'),
    },
    deepseek: {
      async createResponse(request) {
        requestSignal = request.signal;
        return new Promise((resolve, reject) => {
          request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
        });
      },
    },
    sendReply: async (value) => deliveries.push(value),
  });

  assert.equal(
    service.handleDanmaku({
      uid: 'shutdown-user',
      userName: 'Alice',
      message: '小米 等待中的问题',
    }).accepted,
    true,
  );
  await waitUntil(() => requestSignal);

  const shutdown = service.shutdown();
  assert.equal(
    service.handleDanmaku({
      uid: 'late-user',
      userName: 'Bob',
      message: '小米 新问题',
    }).reason,
    'stopped',
  );
  await shutdown;

  assert.equal(requestSignal.aborted, true);
  assert.equal(requestSignal.reason.code, 'AI_SHUTDOWN');
  assert.deepEqual(writes, []);
  assert.deepEqual(deliveries, []);
  assert.equal(service.getStatus().queued, 0);
});

test('shutdown aborts and waits for direct provider operations', async () => {
  let requestSignal;
  const service = createTestService({
    deepseek: {
      async listModels(request) {
        requestSignal = request.signal;
        return new Promise((resolve, reject) => {
          request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
        });
      },
    },
  });

  const listing = service.listModels();
  await waitUntil(() => requestSignal);
  const firstShutdown = service.shutdown();
  const secondShutdown = service.shutdown();

  assert.equal(firstShutdown, secondShutdown);
  await assert.rejects(listing, (error) => error.code === 'AI_SHUTDOWN');
  await firstShutdown;
  assert.equal(requestSignal.aborted, true);
  await assert.rejects(service.testConfiguration(), (error) => error.code === 'AI_SHUTDOWN');
});

test('shutdown releases delivery confirmation without retrying or logging a failure', async () => {
  const deliveries = [];
  const audits = [];
  let answerCount = 0;
  let deliverySignal;
  const service = createTestService({
    store: { logRequest: (entry) => audits.push(entry) },
    deepseek: createAnsweringDeepseek(() => `answer-${++answerCount}`),
    sendReply: async (value) => {
      deliveries.push(value.message);
      return {
        accountUid: '9',
        messages: [value.message],
        sentAfter: Date.now(),
      };
    },
    waitForDelivery: async (delivery) => {
      deliverySignal = delivery.signal;
      return new Promise((resolve) => {
        delivery.signal.addEventListener('abort', () => resolve(false), {
          once: true,
        });
      });
    },
  });

  service.handleDanmaku({
    uid: '42',
    userName: 'Alice',
    message: '小米 shutdown delivery',
  });
  await waitUntil(() => deliverySignal);
  await service.shutdown();

  assert.equal(deliverySignal.aborted, true);
  assert.deepEqual(deliveries, ['answer-1']);
  assert.equal(answerCount, 1);
  assert.equal(
    audits.some((entry) => entry.status === 'failed'),
    false,
  );
});

test('reply cache separates viewers and their conversation context', async (t) => {
  const contexts = new Map([
    ['alice', { question: '我在北京', answer: '知道了' }],
    ['bob', { question: '我在上海', answer: '知道了' }],
  ]);
  const inputs = [];
  const deliveries = [];
  const service = createTestService({
    store: {
      getContext: (uid) => contexts.get(uid) || null,
      setContext: (uid, value) => contexts.set(uid, value),
    },
    deepseek: {
      async createResponse(request) {
        if (request.purpose !== 'generation') {
          return {
            text: '{"allowed":true,"safeText":""}',
            functionCalls: [],
            usage: {},
          };
        }
        inputs.push(String(request.input));
        return {
          text: String(request.input).includes('北京') ? '你在北京' : '你在上海',
          functionCalls: [],
          usage: {},
        };
      },
    },
    sendReply: async (value) => deliveries.push(value),
  });
  t.after(() => service.shutdown());
  service.handleDanmaku({
    uid: 'alice',
    userName: '甲',
    message: '小米 我在哪个城市？',
  });
  await waitUntil(() => deliveries.length === 1);
  service.handleDanmaku({
    uid: 'bob',
    userName: '乙',
    message: '小米 我在哪个城市？',
  });
  await waitUntil(() => deliveries.length === 2);
  assert.equal(inputs.length, 2);
  assert.match(inputs[1], /上海/);
  assert.equal(deliveries[1].message, '你在上海');
});

test('reply cache reuses identical input but invalidates the old policy, changed context and generation config', async (t) => {
  let context = null;
  const config = {
    ...AI_CONFIG_DEFAULTS,
    enabled: true,
    trigger: '小米',
    deepseekResponsesUrl: 'https://example.test/responses',
    deepseekApiKey: 'test-key',
    model: 'test-model',
  };
  let generated = 0;
  const deliveries = [];
  const cache = new Map();
  const service = createTestService({
    store: {
      getConfig: () => ({ ...config }), getContext: () => context,
      getCache: key => ['reply-v4', 'reply-v5'].includes(JSON.parse(key)[0]) ? { text: '旧策略缓存回答' } : cache.get(key),
      setCache: (key, value) => cache.set(key, value),
    },
    deepseek: {
      async createResponse(request) {
        if (request.purpose !== 'generation') {
          return {
            text: '{"allowed":true,"safeText":""}',
            functionCalls: [],
            usage: {},
          };
        }
        generated += 1;
        return { text: `回答${generated}`, functionCalls: [], usage: {} };
      },
    },
    sendReply: async (value) => deliveries.push(value),
  });
  t.after(() => service.shutdown());
  const ask = async () => {
    const expected = deliveries.length + 1;
    assert.equal(
      service.handleDanmaku({
        uid: 'alice',
        userName: '甲',
        message: '小米 继续说说',
      }).accepted,
      true,
    );
    await waitUntil(() => deliveries.length === expected);
  };
  await ask();
  assert.equal(deliveries[0].message, '回答1');
  await ask();
  assert.equal(generated, 1);
  context = { question: '换到上海', answer: '好的' };
  await ask();
  assert.equal(generated, 2);
  config.systemPrompt += '\n请使用简短回答。';
  await ask();
  assert.equal(generated, 3);
  config.deepseekResponsesUrl = 'https://second.example.test/responses';
  await ask();
  assert.equal(generated, 4);
});
