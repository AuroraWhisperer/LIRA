'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AI_CONFIG_DEFAULTS } = require('../src/ai/config');
const { ALLOWED_KEYS, routes } = require('../src/server/routes/ai-routes');

function createResponseRecorder() {
  return {
    statusCode: 0,
    body: '',
    writeHead(statusCode) {
      this.statusCode = statusCode;
    },
    end(body) {
      this.body = body;
    },
  };
}

test('AI route allowed keys come from the config contract', () => {
  assert.deepEqual(
    [...ALLOWED_KEYS].sort(),
    Object.keys(AI_CONFIG_DEFAULTS).sort(),
  );
});

test('AI config GET/PUT never expose plaintext secrets and preserve omitted keys', async () => {
  let saved;
  const context = {
    ai: {
      getConfig() {
        return { model: 'deepseek-v4-flash', hasDeepSeekApiKey: true };
      },
      updateConfig(changes) {
        saved = changes;
        return { model: 'ds-v4-flash', hasDeepSeekApiKey: true };
      },
    },
  };

  const getRes = createResponseRecorder();
  await routes['GET /api/ai/config'](context, {}, getRes);
  assert.equal(getRes.statusCode, 200);
  const getBody = JSON.parse(getRes.body);
  assert.equal(getBody.data.hasDeepSeekApiKey, true);
  assert.equal(getBody.data.deepseekApiKey, undefined);
  assert.doesNotMatch(getRes.body, /sk-secret-123/);

  const putRes = createResponseRecorder();
  await routes['PUT /api/ai/config'](
    context,
    {
      body: async () => ({
        model: 'ds-v4-flash',
        modelProvider: 'openai',
        modelApiProtocol: 'responses',
        reasoningEffort: 'high',
        deepseekApiKey: '',
        qweatherApiKey: null,
        unknownSecret: 'must-not-pass',
      }),
    },
    putRes,
  );
  assert.equal(putRes.statusCode, 200);
  assert.deepEqual(saved, {
    model: 'ds-v4-flash',
    modelProvider: 'openai',
    modelApiProtocol: 'responses',
    reasoningEffort: 'high',
    qweatherApiKey: '',
  });
  assert.doesNotMatch(putRes.body, /must-not-pass/);
  assert.doesNotMatch(putRes.body, /sk-secret-123/);
});

test('AI config route returns a validation error without exposing request internals', async () => {
  const context = {
    ai: {
      updateConfig() {
        throw new Error('发送间隔无效。');
      },
    },
  };
  const res = createResponseRecorder();
  await routes['PUT /api/ai/config'](
    context,
    { body: async () => ({ sendIntervalMs: 1 }) },
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, '发送间隔无效。');
});

test('AI models route passes an optional temporary endpoint and key without exposing the key', async () => {
  let received;
  const context = {
    ai: {
      async listModels(input) {
        received = input;
        return { models: ['deepseek-v4-flash', 'deepseek-v4-pro'] };
      },
    },
  };
  const res = createResponseRecorder();
  await routes['POST /api/ai/models'](
    context,
    {
      body: async () => ({
        apiKey: 'temporary-key',
        apiUrl: 'https://gateway.example.test/v1/responses',
        modelProvider: 'custom',
        modelApiProtocol: 'responses',
      }),
    },
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(received, {
    apiKey: 'temporary-key',
    apiUrl: 'https://gateway.example.test/v1/responses',
    modelProvider: 'custom',
    modelApiProtocol: 'responses',
  });
  assert.deepEqual(JSON.parse(res.body).data.models, [
    'deepseek-v4-flash',
    'deepseek-v4-pro',
  ]);
  assert.doesNotMatch(res.body, /temporary-key/);
});

test('AI models route rejects an invalid temporary key before calling the service', async () => {
  let called = false;
  const context = {
    ai: {
      async listModels() {
        called = true;
      },
    },
  };
  const res = createResponseRecorder();
  await routes['POST /api/ai/models'](
    context,
    {
      body: async () => ({ apiKey: 'x'.repeat(513) }),
    },
    res,
  );

  assert.equal(res.statusCode, 400);
  assert.equal(called, false);
  assert.doesNotMatch(res.body, /xxxxxxxx/);
});

test('AI models route rejects unknown provider and protocol values', async () => {
  let called = false;
  const context = {
    ai: {
      async listModels() {
        called = true;
      },
    },
  };
  const providerRes = createResponseRecorder();
  await routes['POST /api/ai/models'](
    context,
    {
      body: async () => ({ modelProvider: 'unknown' }),
    },
    providerRes,
  );
  assert.equal(providerRes.statusCode, 400);

  const protocolRes = createResponseRecorder();
  await routes['POST /api/ai/models'](
    context,
    {
      body: async () => ({ modelApiProtocol: 'messages' }),
    },
    protocolRes,
  );
  assert.equal(protocolRes.statusCode, 400);
  assert.equal(called, false);
});

test('AI provider test routes dispatch fixed providers and expose safe error codes', async () => {
  const providers = [];
  const context = {
    ai: {
      async testProvider(provider) {
        providers.push(provider);
        if (provider === 'qweather') {
          const error = new Error('请先填写和风天气 API Key。');
          error.code = 'QWEATHER_KEY_MISSING';
          throw error;
        }
        return { provider };
      },
    },
  };
  const deepseekResponse = createResponseRecorder();
  await routes['POST /api/ai/test/deepseek'](context, {}, deepseekResponse);
  assert.equal(deepseekResponse.statusCode, 200);
  assert.equal(JSON.parse(deepseekResponse.body).data.provider, 'deepseek');

  const qweatherResponse = createResponseRecorder();
  await routes['POST /api/ai/test/qweather'](context, {}, qweatherResponse);
  assert.equal(qweatherResponse.statusCode, 502);
  assert.equal(JSON.parse(qweatherResponse.body).code, 'QWEATHER_KEY_MISSING');
  assert.deepEqual(providers, ['deepseek', 'qweather']);
});
