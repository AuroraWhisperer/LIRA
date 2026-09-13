'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AI_CONFIG_DEFAULTS } = require('../src/ai/config');
const {
  createAnsweringDeepseek,
  createTestService,
  waitUntil,
} = require('./helpers/ai-assistant-service-fixture');

test('model listing uses the saved key and prefers a newly entered key', async () => {
  const requests = [];
  const service = createTestService({
    deepseek: {
      async listModels(request) {
        requests.push(request);
        return { models: ['deepseek-v4-flash'] };
      },
    },
  });

  assert.deepEqual(await service.listModels(), {
    models: ['deepseek-v4-flash'],
  });
  assert.deepEqual(
    await service.listModels({
      apiKey: 'new-secret',
      apiUrl: 'https://gateway.example.test/v1/responses',
      modelApiProtocol: 'responses',
    }),
    { models: ['deepseek-v4-flash'] },
  );
  assert.equal(requests[0].apiKey, 'secret');
  assert.equal(requests[0].responsesUrl, 'https://example.test/responses');
  assert.equal(requests[0].modelProvider, 'auto');
  assert.equal(requests[0].modelApiProtocol, 'auto');
  assert.equal(requests[1].apiKey, 'new-secret');
  assert.equal(
    requests[1].responsesUrl,
    'https://gateway.example.test/v1/responses',
  );
  assert.equal(requests[1].modelProvider, 'auto');
  assert.equal(requests[1].modelApiProtocol, 'responses');
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

  assert.deepEqual(await service.testProvider('deepseek'), {
    provider: 'deepseek',
  });
  assert.deepEqual(await service.testProvider('qweather'), {
    provider: 'qweather',
  });
  assert.deepEqual(await service.testProvider('amap'), { provider: 'amap' });
  await assert.rejects(
    service.testProvider('unknown'),
    (error) => error.code === 'AI_PROVIDER_UNKNOWN',
  );
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
          request.signal.addEventListener(
            'abort',
            () => reject(request.signal.reason),
            { once: true },
          );
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
          request.signal.addEventListener(
            'abort',
            () => reject(request.signal.reason),
            { once: true },
          );
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
  await assert.rejects(
    service.testConfiguration(),
    (error) => error.code === 'AI_SHUTDOWN',
  );
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
          text: String(request.input).includes('北京')
            ? '你在北京'
            : '你在上海',
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

test('reply cache reuses identical input but invalidates changed context and generation config', async (t) => {
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
  const service = createTestService({
    store: { getConfig: () => ({ ...config }), getContext: () => context },
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
