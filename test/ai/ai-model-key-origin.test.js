'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { SONG_SCHEMA } = require('../../src/storage/schema');
const { createAiConfigStore } = require('../../src/ai/config-store');
const { createAiAssistantService } = require('../../src/ai/ai-assistant-service');
const { createDeepSeekClient } = require('../../src/ai/deepseek-client');
const { routes } = require('../../src/server/routes/ai-routes');

function fixture(t, config = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(SONG_SCHEMA);
  const store = createAiConfigStore(db, {
    isAvailable: () => true,
    encrypt: (value) => Buffer.from(value).toString('base64'),
    decrypt: (value) => Buffer.from(value, 'base64').toString(),
  });
  store.updateConfig({
    modelProvider: 'custom',
    modelApiProtocol: 'responses',
    deepseekResponsesUrl: 'https://saved.example/v1',
    deepseekApiKey: 'fake-saved-key',
    model: 'fixture-model',
    ...config,
  });
  const requests = [];
  const service = createAiAssistantService({
    store,
    deepseek: createDeepSeekClient({
      fetchImpl: async (url, options) => {
        requests.push({ url: String(url), headers: options.headers });
        return new Response(
          JSON.stringify({
            id: 'fixture-response',
            data: [{ id: 'fixture-model' }],
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'ok' }],
              },
            ],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      },
    }),
    tools: {},
    sendReply: async () => {},
  });
  t.after(async () => {
    await service.shutdown();
    db.close();
  });
  return { db, store, service, requests };
}

test('Doubao preserves an official key origin across reload without replacing the saved custom endpoint', async (t) => {
  const { db, store } = fixture(t);
  store.updateConfig({ modelProvider: 'openai', deepseekApiKey: 'openai-test-key' });
  store.updateConfig({ modelProvider: 'doubao' });
  assert.equal(store.getPublicConfig().doubaoPreviousKeyOrigin, undefined);
  const reloaded = createAiConfigStore(db, { isAvailable: () => true,
    encrypt: value => Buffer.from(value).toString('base64'), decrypt: value => Buffer.from(value, 'base64').toString() });
  assert.throws(() => reloaded.updateConfig({ modelProvider: 'custom' }), { code: 'AI_KEY_ORIGIN_CHANGED' });
  assert.equal(reloaded.getConfig().modelProvider, 'doubao');
  reloaded.updateConfig({ modelProvider: 'openai' });
  assert.equal(reloaded.getConfig().deepseekApiKey, 'openai-test-key');
  reloaded.updateConfig({ modelProvider: 'custom', deepseekApiKey: 'custom-test-key' });
  assert.equal(reloaded.getConfig().deepseekResponsesUrl, 'https://saved.example/v1');
});

test('model listing rejects saved-key reuse across scheme, host or port before fetching', async (t) => {
  const { service, requests, store } = fixture(t);
  for (const apiUrl of ['https://different.example/v1', 'http://saved.example/v1', 'https://saved.example:444/v1']) {
    await assert.rejects(service.listModels({ apiUrl }), /API Key/);
  }
  assert.equal(requests.length, 0);
  assert.equal(store.getConfig().deepseekApiKey, 'fake-saved-key');
});

test('account mode cannot send the saved API key to a temporary model-list destination', async t => {
  const { store, service, requests } = fixture(t);
  store.updateConfig({ modelProvider: 'openai', deepseekApiKey: 'openai-test-key' });
  store.updateConfig({ modelProvider: 'doubao' });
  await assert.rejects(service.listModels({ modelProvider: 'custom', apiUrl: 'https://saved.example/v1' }), { code: 'AI_KEY_ORIGIN_CHANGED' });
  await assert.rejects(service.listModels({ modelProvider: 'openai' }), { code: 'AI_KEY_ORIGIN_CHANGED' });
  assert.deepEqual(await service.listModels(), { models: ['doubao'] });
  assert.equal(requests.length, 0);
  await service.listModels({ modelProvider: 'custom', apiUrl: 'https://saved.example/v1', apiKey: 'explicit-test-key' });
  assert.equal(requests[0].headers.Authorization, 'Bearer explicit-test-key');
});

test('a key first stored in account mode has no reusable API origin', t => {
  const { store } = fixture(t, { deepseekApiKey: '' });
  store.updateConfig({ modelProvider: 'doubao' });
  store.updateConfig({ deepseekApiKey: 'unbound-test-key' });
  assert.throws(() => store.updateConfig({ modelProvider: 'custom' }), { code: 'AI_KEY_ORIGIN_CHANGED' });
});

test('same-origin model listing preserves saved keys and accepts explicit replacement keys', async (t) => {
  const { service, requests, store } = fixture(t);
  await service.listModels({ apiUrl: 'https://SAVED.example:443/other/responses' });
  assert.equal(requests[0].url, 'https://saved.example/other/models');
  assert.equal(requests[0].headers.Authorization, 'Bearer fake-saved-key');
  await service.listModels({ apiUrl: 'https://different.example/v1', apiKey: 'fake-new-key' });
  assert.equal(requests[1].headers.Authorization, 'Bearer fake-new-key');
  assert.equal(new URL(requests[1].url).origin, 'https://different.example');
  assert.equal(store.getConfig().deepseekApiKey, 'fake-saved-key');
  assert.equal(store.getConfig().deepseekResponsesUrl, 'https://saved.example/v1');
});

test('model key checks use the effective preset destination', async (t) => {
  const { service, requests } = fixture(t, { modelProvider: 'deepseek' });
  await service.listModels({ apiUrl: 'https://ignored.example/v1' });
  assert.equal(new URL(requests[0].url).origin, 'https://api.deepseek.com');
  await assert.rejects(service.listModels({ modelProvider: 'openai' }), /API Key/);
  assert.equal(requests.length, 1);
});

test('configuration changes cannot rebind a saved model key or leave partial writes', (t) => {
  const { store, db } = fixture(t);
  const original = store.getConfig();
  assert.throws(
    () =>
      store.updateConfig({
        deepseekResponsesUrl: 'https://different.example/v1',
        model: 'changed-model',
      }),
    /API Key/,
  );
  assert.deepEqual(store.getConfig(), original);
  assert.equal(db.prepare("SELECT value FROM ai_configuration WHERE key = 'model'").get().value, 'fixture-model');
  assert.throws(() => store.updateConfig({ modelProvider: 'deepseek' }), /API Key/);
  store.updateConfig({ deepseekResponsesUrl: 'https://saved.example/v2' });
  assert.equal(store.getConfig().deepseekApiKey, 'fake-saved-key');
});

test('preset-to-custom restoration validates the stored custom origin before commit', (t) => {
  const { store } = fixture(t);
  store.updateConfig({ modelProvider: 'deepseek', deepseekApiKey: 'fake-preset-key' });
  assert.throws(() => store.updateConfig({ modelProvider: 'custom' }), /API Key/);
  assert.equal(store.getConfig().modelProvider, 'deepseek');
  assert.equal(store.getConfig().deepseekApiKey, 'fake-preset-key');
  store.updateConfig({ modelProvider: 'custom', deepseekApiKey: '' });
  assert.equal(store.getConfig().deepseekResponsesUrl, 'https://saved.example/v1');
  assert.equal(store.getConfig().deepseekApiKey, '');
});

test('config and models routes reject implicit rebinding while connection tests retain the saved origin', async (t) => {
  const { store, service, requests } = fixture(t);
  const context = {
    ai: {
      updateConfig: store.updateConfig,
      listModels: service.listModels,
      test: service.testConfiguration,
      testProvider: service.testProvider,
    },
  };
  async function invoke(name, body) {
    const response = {
      writeHead(status) {
        this.status = status;
      },
      end(value) {
        this.body = JSON.parse(value);
      },
    };
    await routes[name](context, { body: async () => body }, response);
    return response;
  }
  assert.equal(
    (
      await invoke('PUT /api/ai/config', {
        deepseekResponsesUrl: 'https://different.example/v1',
        deepseekApiKey: '',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await invoke('POST /api/ai/models', {
        apiUrl: 'https://different.example/v1',
      })
    ).status,
    400,
  );
  assert.equal(requests.length, 0);
  for (const name of ['POST /api/ai/test', 'POST /api/ai/test/deepseek']) {
    assert.equal((await invoke(name)).status, 200);
  }
  assert.ok(requests.length >= 2);
  assert.ok(requests.every((request) => new URL(request.url).origin === 'https://saved.example'));
  assert.equal(
    (
      await invoke('PUT /api/ai/config', {
        deepseekResponsesUrl: 'https://different.example/v1',
        deepseekApiKey: null,
      })
    ).status,
    200,
  );
  assert.equal(store.getConfig().deepseekApiKey, '');
});
