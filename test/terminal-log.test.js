'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const util = require('node:util');
const { installTerminalLog } = require('../src/electron/terminal-log');

test('console and file receive the same redacted formatted message', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-console-redact-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = [];
  for (const method of ['info', 'warn', 'error']) {
    t.mock.method(console, method, (...args) => output.push(util.format(...args)));
  }
  const restore = installTerminalLog(path.join(directory, 'terminal.log'));
  t.after(restore);
  console.warn('Authorization: %s', 'Bearer fake-format-secret');
  const details = { accessToken: 'fake-object-secret', reason: 'useful diagnosis' };
  console.error('Request failed %o', details);
  console.info('[Bilibili][Diagnostic] /api/test?token=fake-info-secret');
  console.info('ordinary /api/test?token=fake-unpersisted-secret');
  const error = new Error('/api/test?token=fake-stack-secret');
  console.error(error);
  const persisted = fs.readFileSync(path.join(directory, 'terminal.log'), 'utf8');
  for (const channel of [output.join('\n'), persisted]) {
    assert.doesNotMatch(channel, /fake-(?:format|object|info|unpersisted|stack)-secret/);
    assert.match(channel, /\[REDACTED\]/);
    assert.match(channel, /useful diagnosis/);
  }
  assert.doesNotMatch(persisted, /ordinary/);
  assert.equal(details.accessToken, 'fake-object-secret', 'logging must not mutate caller data');
});

test('redaction or disk failures never fall back to raw console arguments', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-log-fallback-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = [];
  t.mock.method(console, 'error', (...args) => output.push(util.format(...args)));
  const restore = installTerminalLog(directory); // Cannot append a file over a directory.
  t.after(restore);
  console.error('Authorization: Bearer fake-disk-secret');
  const cyclic = { token: 'fake-cycle-secret' };
  cyclic.self = cyclic;
  assert.doesNotThrow(() => console.error(cyclic));
  assert.doesNotMatch(output.join('\n'), /fake-(?:disk|cycle)-secret/);
  assert.match(output.join('\n'), /\[REDACTED\]/);
});

test('preserves prior content and excludes ordinary info/debug output', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-terminal-log-'));
  const filePath = path.join(directory, 'terminal.log');
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalDebug = console.debug;
  const originalWarn = console.warn;
  const originalError = console.error;
  let restore;

  try {
    fs.writeFileSync(filePath, 'old session\n', 'utf8');
    restore = installTerminalLog(filePath, {
      runId: 'run-test',
      pid: 1234,
      processType: 'browser',
      now: () => '2026-08-03T15:07:34.288Z',
      nextSequence: (() => {
        let sequence = 0;
        return () => {
          sequence += 1;
          return sequence;
        };
      })(),
    });
    console.log('hello %s', 'world');
    console.info({ ready: true });
    console.debug('debug line');
    console.warn('warning line');
    console.error('error line');

    assert.equal(
      fs.readFileSync(filePath, 'utf8'),
      'old session\n' +
        '[2026-08-03T15:07:34.288Z] [run=run-test seq=1 pid=1234 type=browser] [terminal:warn] warning line\n' +
        '[2026-08-03T15:07:34.288Z] [run=run-test seq=2 pid=1234 type=browser] [terminal:error] error line\n',
    );
  } finally {
    restore?.();
    console.log = originalLog;
    console.info = originalInfo;
    console.debug = originalDebug;
    console.warn = originalWarn;
    console.error = originalError;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('persists selected Bilibili diagnostics and restores the info console', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-diagnostics-'));
  const filePath = path.join(directory, 'terminal.log');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  t.mock.method(console, 'info', () => {});
  const originalInfo = console.info;
  const restore = installTerminalLog(filePath, { runId: 'diagnostic-test' });
  t.after(restore);
  console.info('ordinary info');
  console.info('[Bilibili][Diagnostic] auth-result code=0');
  console.info('[Bilibili][Diagnostic] Authorization: Bearer synthetic-secret');
  const content = fs.readFileSync(filePath, 'utf8');
  assert.match(content, /terminal:info.*auth-result code=0/);
  assert.match(content, /\[REDACTED\]/);
  assert.doesNotMatch(content, /ordinary info|synthetic-secret/);
  restore();
  assert.equal(console.info, originalInfo);
});

test('redacts credentials from terminal output', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-terminal-log-'));
  const filePath = path.join(directory, 'terminal.log');
  const originalLog = console.log;
  let restore;

  try {
    restore = installTerminalLog(filePath, {
      runId: 'run-test',
      pid: 1234,
      processType: 'browser',
      now: () => '2026-08-03T15:07:34.288Z',
      nextSequence: (() => {
        let sequence = 0;
        return () => {
          sequence += 1;
          return sequence;
        };
      })(),
    });

    console.warn('Authorization: Bearer secret-token-12345');
    console.warn('Cookie: session=abc123; user=john');
    console.error('API URL: https://api.example.com/data?key=secret123&other=value');
    console.error('Connecting to https://user:password@example.com/resource');

    const content = fs.readFileSync(filePath, 'utf8');

    // Verify credentials are redacted
    assert.ok(!content.includes('secret-token-12345'), 'Bearer token should be redacted');
    assert.ok(!content.includes('session=abc123'), 'Cookie values should be redacted');
    assert.ok(!content.includes('key=secret123'), 'Query param secrets should be redacted');
    assert.ok(!content.includes('user:password@'), 'URL userinfo should be redacted');
    assert.ok(content.includes('[REDACTED]'), 'Should contain redaction placeholder');
  } finally {
    restore?.();
    console.log = originalLog;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('bounds multibyte terminal errors after final UTF-8 encoding', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-terminal-log-'));
  const filePath = path.join(directory, 'terminal.log');
  const originalError = console.error;
  let restore;

  try {
    console.error = () => {};
    restore = installTerminalLog(filePath, {
      runId: 'run-test',
      pid: 1234,
      processType: 'browser',
      now: () => '2026-08-03T15:07:34.288Z',
    });
    console.error('错'.repeat(10000));

    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(Buffer.byteLength(content, 'utf8') <= 16 * 1024);
    assert.match(content, /\[truncated\]/);
  } finally {
    restore?.();
    console.error = originalError;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
