'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { SONG_SCHEMA } = require('../../src/storage/schema');
const { buildAiRuntime } = require('../../src/server/ai-runtime');

test('runtime cleans expired idle records without new messages and stops maintenance on shutdown', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const db = new DatabaseSync(':memory:');
  db.exec(SONG_SCHEMA);
  const runtime = buildAiRuntime({ songDb: db, aiLogPath: 'unused', danmakuSender: {},
    runtimeOptions: { aiSecretCodec: {}, aiRequestLogger: { log() {}, flush() {} } } });
  t.after(async () => { await runtime.shutdown(); db.close(); });
  const insert = () => db.prepare('INSERT INTO ai_viewer_context (uid, payload, expires_at) VALUES (?, ?, ?)').run('expired', '{}', 1);
  const count = () => db.prepare('SELECT COUNT(*) AS count FROM ai_viewer_context').get().count;
  insert();
  t.mock.timers.tick(60000);
  assert.equal(count(), 0);
  await runtime.shutdown();
  insert();
  t.mock.timers.tick(60000);
  assert.equal(count(), 1);
});

test('runtime notifies configuration changes only after a successful update', async t => {
  const db = new DatabaseSync(':memory:');
  db.exec(SONG_SCHEMA);
  const changedTriggers = [];
  const runtime = buildAiRuntime({ songDb: db, aiLogPath: 'unused', danmakuSender: {},
    runtimeOptions: { aiSecretCodec: {}, aiRequestLogger: { log() {}, flush() {} } },
    onConfigUpdated: () => changedTriggers.push(runtime.configStore.getConfig().trigger),
  });
  t.after(async () => { await runtime.shutdown(); db.close(); });
  assert.equal(runtime.updateConfig({ trigger: '小梨' }).trigger, '小梨');
  assert.deepEqual(changedTriggers, ['小梨']);
  assert.throws(() => runtime.updateConfig({ trigger: 'x'.repeat(13) }));
  assert.deepEqual(changedTriggers, ['小梨']);
  assert.equal(runtime.configStore.getConfig().trigger, '小梨');
});

test('reopened configuration uses the same refreshed model capabilities as requests', async t => {
  const db = new DatabaseSync(':memory:');
  db.exec(SONG_SCHEMA);
  let sentEffort;
  let effort = { supported_levels: ['low', 'max'], default_level: 'max' };
  let catalogRequests = 0;
  const runtime = buildAiRuntime({ songDb: db, aiLogPath: 'unused', danmakuSender: {},
    runtimeOptions: {
      aiSecretCodec: { encrypt: value => value, decrypt: value => value, isAvailable: () => true },
      aiRequestLogger: { log() {}, flush() {} },
      fetchImpl: async (_url, options) => {
        if (!options.body) {
          catalogRequests += 1;
          return new Response(JSON.stringify({ data: [{ id: 'deepseek-flash', effort }] }));
        }
        sentEffort = JSON.parse(options.body).reasoning_effort;
        return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
      },
    },
  });
  t.after(async () => { await runtime.shutdown(); db.close(); });
  runtime.updateConfig({ modelProvider: 'deepseek', model: 'deepseek-flash', deepseekApiKey: 'fixture-key',
    reasoningEnabled: true, reasoningEffort: 'auto' });
  await runtime.service.listModels();
  assert.equal(runtime.configStore.getPublicConfig().modelEndpoint.defaultReasoningEffort, 'max');
  effort = { supported_levels: ['low'], default_level: 'low' };
  await runtime.service.listModels();
  const reopened = runtime.configStore.getPublicConfig();
  await runtime.service.testConfiguration();
  assert.equal(reopened.modelEndpoint.defaultReasoningEffort, 'low');
  assert.equal(sentEffort, reopened.modelEndpoint.defaultReasoningEffort);
  assert.equal(catalogRequests, 2);
});
