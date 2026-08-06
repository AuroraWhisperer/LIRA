'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAiRequestLogger } = require('../src/ai/request-logger');

test('AI request logger starts a fresh readable session and redacts secrets recursively', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-request-log-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'ai.log');
  await fs.writeFile(filePath, 'old session should be replaced\n', 'utf8');
  const logger = createAiRequestLogger({ filePath, now: () => new Date('2026-08-06T12:00:00.000Z') });

  await logger.log({
    type: 'request',
    requestId: 'request-1',
    headers: { Authorization: 'Bearer secret-key' },
    body: { input: '\u5c0f\u7c73\u4f60\u597d', apiKey: 'secret-key', nested: ['prefix secret-key suffix'] }
  }, { secrets: ['secret-key'] });
  await logger.log({ type: 'response', requestId: 'request-1', payload: { output_text: '\u4f60\u597d\u55b5\uff5e' } });
  await logger.log({ type: 'error', details: 'x'.repeat(5000) });

  const content = await fs.readFile(filePath, 'utf8');
  assert.match(content, /^===== AI 日志会话 2026-08-06T12:00:00\.000Z =====/);
  assert.doesNotMatch(content, /old session should be replaced/);
  assert.match(content, /\[2026-08-06T12:00:00\.000Z\] request requestId=request-1/);
  const blocks = content.trim().split(/\n\n+/).slice(1).map((block) => {
    const json = block.split('\n').slice(1).join('\n');
    return JSON.parse(json);
  });
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].timestamp, '2026-08-06T12:00:00.000Z');
  assert.equal(blocks[0].headers.Authorization, '[redacted]');
  assert.equal(blocks[0].body.apiKey, '[redacted]');
  assert.equal(blocks[0].body.nested[0], 'prefix [redacted] suffix');
  assert.equal(blocks[1].payload.output_text, '\u4f60\u597d\u55b5\uff5e');
  assert.equal(blocks[2].details.length, 4014);
  assert.match(blocks[2].details, /\.\.\.\[truncated\]$/);
});
