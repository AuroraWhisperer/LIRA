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
