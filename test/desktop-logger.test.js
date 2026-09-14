'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createDesktopLogger } = require('../src/electron/desktop-logger');

test('desktop logger bounds normal and error entries after UTF-8 encoding', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-log-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'desktop.log');
  const logger = createDesktopLogger({
    getLogFile: () => filePath,
    loggingState: { runId: 'run-test', sequence: 0 },
  });

  logger.writeLog('status', '常'.repeat(10000));
  const error = new Error('错'.repeat(10000));
  logger.writeLog('provider-error', error);

  const lines = fs.readFileSync(filePath, 'utf8').trimEnd().split('\n');
  assert.equal(lines.length, 2);
  assert.ok(Buffer.byteLength(`${lines[0]}\n`, 'utf8') <= 2 * 1024);
  assert.ok(Buffer.byteLength(`${lines[1]}\n`, 'utf8') <= 16 * 1024);
  assert.match(lines[0], /\[truncated\]/);
  assert.match(lines[1], /\[truncated\]/);
});

test('desktop logger never grows a full compatibility file', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-log-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'desktop.log');
  fs.writeFileSync(filePath, 'x'.repeat(128), 'utf8');
  const logger = createDesktopLogger({
    getLogFile: () => filePath,
    loggingState: { runId: 'run-test', sequence: 0 },
    maxFileBytes: 128,
  });

  logger.writeLog('status', 'must not be appended');

  assert.equal(fs.statSync(filePath).size, 128);
});

test('desktop logger does not throw for an unserializable value', () => {
  const value = {};
  value.self = value;
  const logger = createDesktopLogger({
    getLogFile: () => path.join(os.tmpdir(), 'unused-desktop-log.log'),
    loggingState: { runId: 'run-test', sequence: 0 },
  });

  assert.doesNotThrow(() => logger.writeLog('status', value));
});
