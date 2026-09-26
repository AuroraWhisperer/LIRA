'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const { redactCredentials } = require('../src/shared/log-redaction');
const { BilibiliApiClient } = require('../src/bilibili/danmaku/api-client');

test('deep upstream error data preserves the original Bilibili error boundary', async (t) => {
  const data = '{"child":'.repeat(20000) + '{"token":"synthetic-secret"}' + '}'.repeat(20000);
  const payload = `{"code":-352,"message":"verification failed","data":${data}}`;
  t.mock.method(globalThis, 'fetch', async () => new Response(payload, { status: 403 }));
  await assert.rejects(
    new BilibiliApiClient('123').fetchJson('gethistory', 'https://api.example.test/fixture'),
    (error) => {
      assert.equal(error.name, 'Error');
      assert.match(error.message, /http=403 code=-352 message=verification failed/);
      assert.doesNotMatch(error.message, /synthetic-secret|call stack/);
      return true;
    },
  );
});

test('redaction bounds nested arrays and produces serializable safe diagnostics', () => {
  const nested = JSON.parse('['.repeat(20000) + '{"SESSDATA":"synthetic-session"}' + ']'.repeat(20000));
  const encoded = JSON.stringify(redactCredentials(nested));
  assert.ok(encoded.length < 256);
  assert.doesNotMatch(encoded, /synthetic-session/);
});

test('redaction handles cyclic Error details without discarding sibling diagnostics', () => {
  const error = new Error('upstream failed');
  error.details = { error, token: 'synthetic-secret', attempts: 2 };
  const result = redactCredentials(error);
  assert.ok(result instanceof Error);
  assert.equal(result.message, 'upstream failed');
  assert.equal(result.details.error, '[Circular]');
  assert.equal(result.details.token, '[REDACTED]');
  assert.equal(result.details.attempts, 2);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-secret/);
});

test('redaction preserves repeated noncyclic references in separate branches', () => {
  const shared = { token: 'synthetic-secret', state: 'retry' };
  assert.deepEqual(redactCredentials({ first: shared, second: shared }), {
    first: { token: '[REDACTED]', state: 'retry' },
    second: { token: '[REDACTED]', state: 'retry' },
  });
  assert.equal(shared.token, 'synthetic-secret');
});

test('malformed URL text cannot stall the Bilibili error diagnostic path', (t) => {
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const { BilibiliApiClient } = require('./src/bilibili/danmaku/api-client');
    (async () => {
      const samples = [];
      for (const pattern of ['?', 'a', 'a-', 'https://']) {
        const reason = pattern.repeat(128 * 1024);
        globalThis.fetch = async () => new Response(JSON.stringify({
          code: -352, message: 'upstream rejected', data: { reason },
        }), { status: 403 });
        const start = performance.now();
        await assert.rejects(
          new BilibiliApiClient('123').fetchJson('gethistory', 'https://api.example.test/fixture'),
          /http=403 code=-352 message=upstream rejected/,
        );
        samples.push({ bytes: reason.length, milliseconds: Math.ceil(performance.now() - start) });
      }
      console.log(JSON.stringify(samples));
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  t.diagnostic(result.stdout.trim());
});

test('URL string redaction retains hosts, ports and noncredential path text', () => {
  assert.equal(
    redactCredentials('GET https://user:pass@example.test:443/path?access_token=synthetic&state=ok'),
    'GET https://[REDACTED]@example.test:443/path?access_token=[REDACTED]&state=ok',
  );
  assert.equal(
    redactCredentials('https://name:@[::1]:8080/ https://name@example.test/'),
    'https://[REDACTED]@[::1]:8080/ https://[REDACTED]@example.test/',
  );
  const publicUrl = 'https://example.test:443/path/contact:user@example.test?state=ok';
  assert.equal(redactCredentials(publicUrl), publicUrl);
});
