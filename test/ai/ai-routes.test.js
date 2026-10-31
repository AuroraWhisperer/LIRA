'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AI_CONFIG_DEFAULTS } = require('../../src/ai/config');
const { ALLOWED_KEYS, routes } = require('../../src/server/routes/ai-routes');
const { DatabaseSync } = require('node:sqlite');
const { SONG_SCHEMA } = require('../../src/storage/schema');
const { createAiStateStore } = require('../../src/storage/ai-state-store');
const { createAiConfigStore } = require('../../src/ai/config-store');
const { buildAiRuntime } = require('../../src/server/ai-runtime');
const { createRuntimeApiContextFactory } = require('../../src/server/runtime-api-context');
const { createTestService, waitUntil } = require('../helpers/ai-assistant-service-fixture');
const { listenHttpServer } = require('../helpers/transport-fixtures');

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
  assert.deepEqual([...ALLOWED_KEYS].sort(), Object.keys(AI_CONFIG_DEFAULTS).sort());
});

test('ChatGPT routes pass only account selections and reject invalid inputs before side effects', async () => {
  let received;
  const context = { ai: { openChatGptLogin: async input => { received = input; return { pending: true }; },
    selectChatGptAccount: () => assert.fail('invalid selection must not reach the session') } };
  const res = createResponseRecorder();
  await routes['POST /api/ai/chatgpt/login'](context, { body: async () => ({ newAccount: true, url: 'https://attacker.test', token: 'do-not-accept' }) }, res);
  assert.deepEqual(received, { profileId: undefined, newAccount: true });
  assert.equal(JSON.parse(res.body).data.pending, true);
  for (const profileId of [null, {}, 'x'.repeat(81)]) {
    await routes['POST /api/ai/chatgpt/select'](context, { body: async () => ({ profileId }) }, res);
    assert.equal(res.statusCode, 400);
  }
});

test('Doubao account routes accept no credentials or navigation inputs and report desktop unavailability safely', async () => {
  const { createDoubaoClient } = require('../../src/ai/doubao-client');
  const client = createDoubaoClient();
  const context = { ai: { getDoubaoStatus: client.getStatus, openDoubaoLogin: client.openLogin, logoutDoubao: client.logout } };
  for (const route of ['GET /api/ai/doubao/status', 'POST /api/ai/doubao/login', 'POST /api/ai/doubao/logout']) {
    const res = createResponseRecorder();
    await routes[route](context, { body: () => assert.fail('account routes must not consume arbitrary credentials or URLs') }, res);
    const body = JSON.parse(res.body);
    if (route.startsWith('GET')) {
      assert.equal(res.statusCode, 200);
      assert.deepEqual(body.data, { available: false, loggedIn: false, needsVerification: false, encryptionAvailable: false });
    } else {
      assert.equal(res.statusCode, 503);
      assert.equal(body.code, 'DOUBAO_DESKTOP_REQUIRED');
    }
  }
});

test('AI account HTTP routes use runtime composition and require admin authorization', async (t) => {
  const db = new DatabaseSync(':memory:');
  db.exec(SONG_SCHEMA);
  let loggedIn = false;
  const getStatus = () => ({ available: true, loggedIn, needsVerification: false, encryptionAvailable: true });
  const openLogin = t.mock.fn(async () => { loggedIn = true; });
  const logout = t.mock.fn(async () => { loggedIn = false; });
  const aiRuntime = buildAiRuntime({
    songDb: db,
    runtimeOptions: {
      doubaoSession: { getStatus, openLogin, logout },
      aiSecretCodec: { encrypt: value => value, decrypt: value => value },
      aiRequestLogger: { log() {} },
    },
  });
  t.after(async () => { await aiRuntime.shutdown(); db.close(); });
  const sessionToken = 'synthetic-doubao-admin';
  const createApiContext = createRuntimeApiContextFactory({
    maxBodyBytes: 1024,
    getSessionToken: () => sessionToken,
    getDomainServices: () => ({ songs: {}, queue: {}, superChats: {}, gifts: {}, overtime: {}, data: {} }),
    getSettingsStore: () => ({}),
    getMusicRuntime: () => ({ getMusicRegistry: () => ({}), weSingCapture: {} }),
    getBilibiliRuntime: () => ({ getAuthProvider: () => null }),
    getAiRuntime: () => aiRuntime,
    getLiveStatus: () => ({}),
    getDanmakuSender: () => ({}),
    getGameSessionService: () => undefined,
    getWheelSessionService: () => undefined,
  });
  const { origin } = await listenHttpServer(t, {
    inflightTracker: { run: operation => operation() },
    createApiContext,
  });

  for (const [method, operation, expectedLoggedIn] of [
    ['GET', 'status', false],
    ['POST', 'login', true],
    ['GET', 'status', true],
    ['POST', 'logout', false],
    ['GET', 'status', false],
  ]) {
    const response = await fetch(`${origin}/api/ai/doubao/${operation}`, {
      method,
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const body = await response.json();
    assert.equal(response.status, 200, `${operation}: ${body.error || ''}`);
    assert.deepEqual(body, {
      ok: true,
      data: { available: true, loggedIn: expectedLoggedIn, needsVerification: false, encryptionAvailable: true },
    });
  }
  assert.equal(openLogin.mock.callCount(), 1);
  assert.equal(logout.mock.callCount(), 1);
  for (const route of Object.keys(routes).filter(key => key.includes('/chatgpt/'))) {
    const [method, pathname] = route.split(' ');
    const anonymous = await fetch(`${origin}${pathname}`, { method });
    assert.equal(anonymous.status, 401, route);
    await anonymous.arrayBuffer();
  }
  const headers = { Authorization: `Bearer ${sessionToken}` };
  const status = await fetch(`${origin}/api/ai/chatgpt/status`, { headers });
  assert.equal(status.status, 200);
  assert.deepEqual((await status.json()).data, { available: false, pending: false, activeId: '', loggedIn: false,
    ready: false, profiles: [], lastError: '' });
  const login = await fetch(`${origin}/api/ai/chatgpt/login`, { method: 'POST', headers });
  assert.equal(login.status, 400);
  assert.equal((await login.json()).code, 'CHATGPT_UNAVAILABLE');
});

test('saving disabled through the config route aborts accepted work after committing the setting', async (t) => {
  const db = new DatabaseSync(':memory:');
  db.exec(SONG_SCHEMA);
  const store = createAiConfigStore(createAiStateStore(db), { encrypt: value => value, decrypt: value => value });
  store.updateConfig({
    enabled: true,
    trigger: '小米',
    deepseekResponsesUrl: 'https://example.test/responses',
    deepseekApiKey: 'synthetic-key',
    model: 'test-model',
  });
  let signal;
  const service = createTestService({ store, modelClient: { createResponse(request) {
    signal = request.signal;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } }, sendReply() { assert.fail('disabled work must never send'); } });
  t.after(async () => { await service.shutdown(); db.close(); });
  assert.equal(service.handleDanmaku({ uid: 'one', userName: '观众', message: '小米 问题' }).accepted, true);
  await waitUntil(() => signal);
  const res = createResponseRecorder();
  await routes['PUT /api/ai/config']({ ai: service }, { body: async () => ({ enabled: false }) }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(store.getConfig().enabled, false);
  assert.equal(JSON.parse(res.body).data.enabled, false);
  assert.equal(signal.aborted, true);
  assert.equal(service.getStatus().queued, 0);
});

test('persona routes persist validated roles and return safe errors without changing the library', async (t) => {
  const db = new DatabaseSync(':memory:');
  db.exec(SONG_SCHEMA);
  t.after(() => db.close());
  const store = createAiConfigStore(createAiStateStore(db), { encrypt: (value) => value, decrypt: (value) => value });
  store.updateConfig({ deepseekApiKey: 'private-model-key' });
  const context = { ai: store };
  async function request(route, body) {
    const res = createResponseRecorder();
    await routes[route](context, { body: async () => body }, res);
    assert.doesNotMatch(res.body, /private-model-key/);
    return { status: res.statusCode, ...JSON.parse(res.body) };
  }
  const created = await request('POST /api/ai/personas/create', {
    name: '温柔的朋友', prompt: '你是友善的直播间朋友，认真、简洁地回答问题，不使用固定的口头禅。',
  });
  assert.equal(created.status, 200);
  const updated = await request('POST /api/ai/personas/update', {
    id: created.data.personaId, name: '温柔的朋友', description: '自然陪聊',
    prompt: '你是友善的直播间朋友，认真、简洁地回答问题，不使用固定的口头禅。',
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.personaId, created.data.personaId);
  assert.equal((await request('POST /api/ai/personas/update', { id: 'missing', reset: true })).status, 400);
  const exported = await request('GET /api/ai/personas/export');
  assert.equal(exported.data.name, '温柔的朋友');
  const duplicate = await request('POST /api/ai/personas/import', exported.data);
  assert.equal(duplicate.status, 400);
  assert.match(duplicate.error, /已存在/);
  const unsafe = await request('POST /api/ai/personas/import', { ...exported.data, apiKey: 'injected' });
  assert.equal(unsafe.status, 400);
  assert.equal(store.getConfig().personaPacks.length, 1);
  assert.equal(store.getConfig().personaId, created.data.personaId);
  const deleted = await request('POST /api/ai/personas/delete', { id: created.data.personaId });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.data.personaId, 'general');
  const imported = await request('POST /api/ai/personas/import', exported.data);
  assert.equal(imported.status, 200);
  assert.equal(imported.data.personaId, created.data.personaId);
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
        deepseekApiKeyPreview: 'sk-new********',
        providerPersonaIds: { deepseek: 'general' },
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
  await routes['PUT /api/ai/config'](context, { body: async () => ({ sendIntervalMs: 1 }) }, res);
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
  assert.deepEqual(JSON.parse(res.body).data.models, ['deepseek-v4-flash', 'deepseek-v4-pro']);
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

test('AI models route rejects invalid provider, protocol and authentication mode values', async () => {
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
  for (const modelAuthMode of ['unknown', false, 0, {}, 'x'.repeat(33)]) {
    const authRes = createResponseRecorder();
    await routes['POST /api/ai/models'](context, { body: async () => ({ modelAuthMode }) }, authRes);
    assert.equal(authRes.statusCode, 400);
  }
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
