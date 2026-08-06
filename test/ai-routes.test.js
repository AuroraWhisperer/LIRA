'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { routes } = require('../src/server/routes/ai-routes');

function createResponseRecorder() {
  return {
    statusCode: 0, body: '',
    writeHead(statusCode) { this.statusCode = statusCode; },
    end(body) { this.body = body; }
  };
}

test('AI config route allowlists fields, keeps blank secrets, and supports explicit clearing', async () => {
  let saved;
  const context = {
    ai: {
      updateConfig(changes) { saved = changes; return { model: 'ds-v4-flash', hasDeepSeekApiKey: true }; }
    }
  };
  const res = createResponseRecorder();
  await routes['PUT /api/ai/config'](context, {
    body: async () => ({
      model: 'ds-v4-flash', deepseekApiKey: '', qweatherApiKey: null,
      unknownSecret: 'must-not-pass'
    })
  }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(saved, { model: 'ds-v4-flash', qweatherApiKey: '' });
  assert.doesNotMatch(res.body, /must-not-pass/);
});

test('AI config route returns a validation error without exposing request internals', async () => {
  const context = { ai: { updateConfig() { throw new Error('发送间隔无效。'); } } };
  const res = createResponseRecorder();
  await routes['PUT /api/ai/config'](context, { body: async () => ({ sendIntervalMs: 1 }) }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, '发送间隔无效。');
});

test('AI models route passes an optional temporary key without exposing it', async () => {
  let received;
  const context = {
    ai: {
      async listModels(input) {
        received = input;
        return { models: ['deepseek-v4-flash', 'deepseek-v4-pro'] };
      }
    }
  };
  const res = createResponseRecorder();
  await routes['POST /api/ai/models'](context, {
    body: async () => ({ apiKey: 'temporary-key' })
  }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(received, { apiKey: 'temporary-key' });
  assert.deepEqual(JSON.parse(res.body).data.models, ['deepseek-v4-flash', 'deepseek-v4-pro']);
  assert.doesNotMatch(res.body, /temporary-key/);
});

test('AI models route rejects an invalid temporary key before calling the service', async () => {
  let called = false;
  const context = { ai: { async listModels() { called = true; } } };
  const res = createResponseRecorder();
  await routes['POST /api/ai/models'](context, {
    body: async () => ({ apiKey: 'x'.repeat(513) })
  }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(called, false);
  assert.doesNotMatch(res.body, /xxxxxxxx/);
});
