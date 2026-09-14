'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAiRequestLogger } = require('../src/ai/request-logger');

test('AI request logger appends one activity summary without prompt or response bodies', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-request-log-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'ai.log');
  const legacyLine = JSON.stringify({ event: 'legacy.session' });
  await fs.writeFile(filePath, `${legacyLine}\n`, 'utf8');
  let currentTime = new Date('2026-09-14T12:00:00.000Z');
  const logger = createAiRequestLogger({ filePath, now: () => currentTime });

  await logger.log({
    type: 'request_succeeded',
    requestId: 'request-1',
    provider: 'deepseek',
    model: 'deepseek-chat',
    purpose: 'generation',
    protocol: 'chat_completions',
    status: 200,
    durationMs: 120,
    inputTokens: 7,
    outputTokens: 3,
    functionCallCount: 0,
    body: { input: 'PRIVATE PROMPT' },
    result: { text: 'PRIVATE RESPONSE' },
  });
  currentTime = new Date('2026-09-14T12:02:00.000Z');
  await logger.log({
    type: 'request_succeeded',
    requestId: 'request-2',
    provider: 'deepseek',
    model: 'deepseek-chat',
    purpose: 'generation',
    protocol: 'chat_completions',
    status: 200,
    durationMs: 880,
    inputTokens: 11,
    outputTokens: 5,
    functionCallCount: 1,
  });

  assert.equal(await fs.readFile(filePath, 'utf8'), `${legacyLine}\n`);
  await logger.flush();

  const lines = (await fs.readFile(filePath, 'utf8')).trim().split('\n');
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]), { event: 'legacy.session' });
  assert.deepEqual(JSON.parse(lines[1]), {
    schemaVersion: 1,
    timestamp: '2026-09-14T12:02:00.000Z',
    level: 'info',
    category: 'runtime',
    service: 'client',
    module: 'ai',
    event: 'ai.requestSummary',
    windowStart: '2026-09-14T12:00:00.000Z',
    windowEnd: '2026-09-14T12:02:00.000Z',
    provider: 'deepseek',
    model: 'deepseek-chat',
    purpose: 'generation',
    protocol: 'chat_completions',
    requestCount: 2,
    successCount: 2,
    failureCount: 0,
    inputTokens: 18,
    outputTokens: 8,
    functionCallCount: 1,
    durationMaxMs: 880,
    durationBuckets: {
      le250: 1,
      le1000: 1,
      le5000: 0,
      le15000: 0,
      over15000: 0,
    },
  });
  assert.doesNotMatch(lines[1], /PRIVATE PROMPT|PRIVATE RESPONSE/);
  assert.ok(Buffer.byteLength(`${lines[1]}\n`, 'utf8') <= 2048);
});

test('AI request logger keeps safe failure fields within the final UTF-8 byte ceiling', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ai-request-log-error-'),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'ai.log');
  const logger = createAiRequestLogger({
    filePath,
    now: () => new Date('2026-09-14T12:00:00.000Z'),
  });

  await logger.log(
    {
      type: 'request_failed',
      requestId: 'request-error',
      provider: 'deepseek',
      model: 'deepseek-chat',
      purpose: 'generation',
      protocol: 'chat_completions',
      status: 502,
      durationMs: 1500,
      error: {
        code: 'UPSTREAM_FAILURE',
        name: 'ProviderError',
        message: `secret-key ${'错'.repeat(10000)}`,
        stack: `ProviderError: secret-key\n${'堆栈'.repeat(10000)}`,
      },
      payload: { output: 'must not be logged' },
    },
    { secrets: ['secret-key'] },
  );
  await logger.flush();

  const lines = (await fs.readFile(filePath, 'utf8')).trim().split('\n');
  const errorLine = lines.find((line) => JSON.parse(line).level === 'error');
  assert.ok(errorLine);
  assert.ok(Buffer.byteLength(`${errorLine}\n`, 'utf8') <= 16 * 1024);
  const entry = JSON.parse(errorLine);
  assert.equal(entry.event, 'ai.requestFailed');
  assert.equal(entry.error.code, 'UPSTREAM_FAILURE');
  assert.equal(entry.error.name, 'ProviderError');
  assert.match(`${entry.error.message}${entry.error.stack}`, /\[truncated\]/);
  assert.doesNotMatch(errorLine, /secret-key|must not be logged/);
});

test('AI request logger leaves legacy ai.log read-only in structured directory mode', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ai-request-log-streams-'),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const legacyPath = path.join(directory, 'ai.log');
  await fs.writeFile(legacyPath, 'legacy content\n', 'utf8');
  const logger = createAiRequestLogger({
    logDir: directory,
    now: () => new Date('2026-09-14T12:00:00.000Z'),
  });

  await logger.log({
    type: 'request_failed',
    requestId: 'request-error',
    provider: 'deepseek',
    model: 'deepseek-chat',
    purpose: 'generation',
    protocol: 'chat_completions',
    error: { code: 'FAILED', name: 'Error', message: 'failed' },
  });
  await logger.flush();

  assert.equal(await fs.readFile(legacyPath, 'utf8'), 'legacy content\n');
  const runtime = await fs.readFile(
    path.join(directory, 'runtime', 'ai.jsonl'),
    'utf8',
  );
  const errors = await fs.readFile(
    path.join(directory, 'errors', 'ai.jsonl'),
    'utf8',
  );
  assert.equal(JSON.parse(runtime).event, 'ai.requestSummary');
  assert.equal(JSON.parse(errors).event, 'ai.requestFailed');
});

test('AI request logger bounds summary cardinality and labels overflow', async () => {
  const written = [];
  const logger = createAiRequestLogger({
    filePath: path.join(os.tmpdir(), 'unused-ai-summary-log.jsonl'),
    maxSummaryGroups: 2,
    appendLine: async (_stream, line) => {
      written.push(JSON.parse(line));
      return true;
    },
  });

  for (const model of ['model-a', 'model-b', 'model-c']) {
    await logger.log({
      type: 'request_succeeded',
      provider: 'custom',
      model,
      purpose: 'generation',
      protocol: 'responses',
      durationMs: 10,
    });
  }
  await logger.flush();

  assert.equal(written.length, 2);
  assert.equal(written.find((entry) => entry.model === 'model-a').requestCount, 1);
  assert.equal(written.find((entry) => entry.model === 'other').requestCount, 2);
  assert.equal(logger.getHealth().overflowGroupEvents, 2);
});

test('AI request logger bounds its pending write queue and reports drops', async () => {
  const blocker = Promise.withResolvers();
  const written = [];
  const logger = createAiRequestLogger({
    filePath: path.join(os.tmpdir(), 'unused-ai-request-log.jsonl'),
    maxQueueEntries: 2,
    appendLine: async (_stream, line) => {
      written.push(line);
      await blocker.promise;
      return true;
    },
  });

  const writes = [1, 2, 3].map((index) =>
    logger.log({
      type: 'request_failed',
      requestId: `request-${index}`,
      provider: 'deepseek',
      model: 'deepseek-chat',
      purpose: 'generation',
      protocol: 'chat_completions',
      error: { code: `FAIL_${index}`, name: 'Error', message: 'failed' },
    }),
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(logger.getHealth().queuedEntries, 2);
  assert.equal(logger.getHealth().droppedQueueEntries, 1);
  blocker.resolve();
  await Promise.all(writes);
  await logger.flush();
  const entries = written.map((line) => JSON.parse(line));
  assert.equal(entries.filter((entry) => entry.level === 'error').length, 2);
  assert.equal(
    entries.find((entry) => entry.event === 'ai.requestSummary').failureCount,
    3,
  );
  assert.equal(logger.getHealth().queuedEntries, 0);
});
