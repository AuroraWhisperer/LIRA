'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAiRequestLogger } = require('../src/ai/request-logger');

test('AI request logger appends JSON lines and redacts secrets recursively', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-request-log-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'ai.log');
  const logger = createAiRequestLogger({ filePath, now: () => new Date('2026-08-06T12:00:00.000Z') });

  await logger.log({
    type: 'request',
    requestId: 'request-1',
    headers: { Authorization: 'Bearer secret-key' },
    body: { input: '小米你好', apiKey: 'secret-key', nested: ['prefix secret-key suffix'] }
  }, { secrets: ['secret-key'] });
  await logger.log({ type: 'response', requestId: 'request-1', payload: { output_text: '你好喵～' } });

  const lines = (await fs.readFile(filePath, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].timestamp, '2026-08-06T12:00:00.000Z');
  assert.equal(lines[0].headers.Authorization, '[redacted]');
  assert.equal(lines[0].body.apiKey, '[redacted]');
  assert.equal(lines[0].body.nested[0], 'prefix [redacted] suffix');
  assert.equal(lines[1].payload.output_text, '你好喵～');
});
