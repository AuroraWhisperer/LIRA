'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createScratchDirectory } = require('../helpers/scratch-directory');
const { maintainDesktopLogs } = require('../../src/electron/log-maintenance');
const { appendBoundedFileSync, NORMAL_FILE_BYTES, NORMAL_ENTRY_BYTES } = require('../../src/shared/log-size-limit');

test('the first desktop append reuses successful retention work on the active log and both archives', (t) => {
  const directory = createScratchDirectory('log-retention-', t);
  const file = path.join(directory, 'desktop.log');
  const now = Date.parse('2026-10-13T00:00:00Z');
  const line = '[2026-10-10T00:10:00Z] [desktop:info] near expiry\n';
  for (const suffix of ['', '.1', '.2']) fs.writeFileSync(file + suffix, line);
  maintainDesktopLogs(directory, now);
  const reads = t.mock.method(fs, 'readFileSync');
  const options = { maxFileBytes: NORMAL_FILE_BYTES, maxEntryBytes: NORMAL_ENTRY_BYTES, now };
  const start = '[2026-10-13T00:00:00Z] [desktop:info] START\n';
  assert.equal(appendBoundedFileSync(file, start, options).written, true);
  assert.equal(reads.mock.callCount(), 0);
  reads.mock.restore();
  assert.equal(appendBoundedFileSync(file, start, { ...options, now: now + 3600_000 }).written, true);
  assert.equal(fs.readFileSync(file, 'utf8'), start + start);
  assert.equal(fs.existsSync(file + '.1'), false);
  assert.equal(fs.existsSync(file + '.2'), false);
});

test('expiring ordinary desktop entries does not require a third full read', t => {
  const directory = createScratchDirectory('ordinary-retention-', t);
  const normal = path.join(directory, 'desktop.log');
  const today = '[2026-11-25T00:00:00Z] [desktop:info] today\n';
  fs.writeFileSync(normal, '[2026-11-21T00:00:00Z] [desktop:info] expired\n' + today);
  const read = t.mock.method(fs, 'readFileSync');
  const write = t.mock.method(fs, 'writeFileSync');
  maintainDesktopLogs(directory, Date.parse('2026-11-25T00:00:00Z'));
  const reads = read.mock.calls.filter(call => call.arguments[0] === normal).length;
  const writes = write.mock.calls.filter(call => call.arguments[0] === normal).length;
  assert.equal(fs.readFileSync(normal, 'utf8'), today);
  assert.equal(writes, 1);
  assert.ok(reads <= 2, `full reads: ${reads}`);
});

test('old mixed logs keep recent failures separately while ordinary records expire after three days', (t) => {
  const directory = createScratchDirectory('log-retention-', t);
  const normal = path.join(directory, 'terminal.log');
  fs.writeFileSync(normal, [
    '[2026-10-01T00:00:00Z] [terminal:error] useful old failure\n',
    '[2026-10-01T00:00:00Z] [terminal:info] old success\n',
    '[2026-09-01T00:00:00Z] [terminal:error] expired failure\n',
    '[2026-10-12T00:00:00Z] [terminal:info] recent success\n',
  ].join(''));
  const now = Date.parse('2026-10-13T00:00:00Z');
  maintainDesktopLogs(directory, now);
  const failures = path.join(directory, 'errors', 'terminal.log');
  assert.equal(fs.readFileSync(normal, 'utf8'), '[2026-10-12T00:00:00Z] [terminal:info] recent success\n');
  assert.equal(fs.readFileSync(failures, 'utf8'), '[2026-10-01T00:00:00Z] [terminal:error] useful old failure\n');
  maintainDesktopLogs(directory, now);
  assert.equal(fs.readFileSync(failures, 'utf8').trim().split('\n').length, 1);
  maintainDesktopLogs(directory, now + 15 * 86400_000);
  assert.equal(fs.existsSync(normal), false);
  assert.equal(fs.existsSync(failures), false);
});

test('an extraction failure preserves the original diagnostic for the next maintenance pass', (t) => {
  const directory = createScratchDirectory('log-retention-', t);
  const normal = path.join(directory, 'desktop.log');
  const error = '[2026-10-01T00:00:00Z] [desktop:startup-error] still useful\n';
  const oldInfo = '[2026-10-01T00:00:00Z] [desktop:info] expired\n';
  const target = path.join(directory, 'errors', 'desktop.log');
  const now = Date.parse('2026-10-13T00:00:00Z');
  fs.writeFileSync(normal, error + oldInfo);
  fs.mkdirSync(target, { recursive: true });
  maintainDesktopLogs(directory, now);
  assert.equal(fs.readFileSync(normal, 'utf8'), error + oldInfo);
  const start = '[2026-10-13T00:00:00Z] [desktop:info] START\n';
  appendBoundedFileSync(normal, start, { maxFileBytes: NORMAL_FILE_BYTES, maxEntryBytes: NORMAL_ENTRY_BYTES, now });
  assert.equal(fs.readFileSync(normal, 'utf8'), error + start);
  fs.rmdirSync(target);
  maintainDesktopLogs(directory, now);
  assert.equal(fs.readFileSync(target, 'utf8'), error);
  assert.equal(fs.readFileSync(normal, 'utf8'), start);
});

test('a short write followed by disk failure retires only complete errors and retries the original suffix', (t) => {
  const directory = createScratchDirectory('log-retention-', t);
  const source = path.join(directory, 'terminal.log');
  const target = path.join(directory, 'errors', 'terminal.log');
  const now = Date.parse('2026-10-13T00:00:00Z');
  const prefix = '[2026-10-01T00:00:00Z] [terminal:error] ';
  const first = `${prefix}first Authorization: Bearer fixture-token\n`;
  const safeFirst = `${prefix}first Authorization: Bearer [REDACTED]\n`;
  const second = `${prefix}错误二\n`;
  const third = `${prefix}third\n`;
  const oldInfo = '[2026-10-01T00:00:00Z] [terminal:info] old success\n';
  fs.writeFileSync(source, first + oldInfo + second + third);

  // Stop inside the first multi-byte character of the second error.
  const write = fs.writeSync;
  let remaining = Buffer.byteLength(safeFirst + prefix) + 1;
  const fault = t.mock.method(fs, 'writeSync', (fd, buffer, offset, length) => {
    if (!remaining) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    const written = write(fd, buffer, offset, Math.min(length, remaining));
    remaining -= written;
    return written;
  });
  maintainDesktopLogs(directory, now);
  fault.mock.restore();
  assert.equal(fs.readFileSync(target, 'utf8'), safeFirst);
  assert.equal(fs.readFileSync(source, 'utf8'), oldInfo + second + third);

  maintainDesktopLogs(directory, now);
  assert.equal(fs.readFileSync(target, 'utf8'), safeFirst + second + third);
  assert.equal(fs.existsSync(source), false);
});

test('legacy AI failures keep only their error core before the mixed legacy file is retired', (t) => {
  const directory = createScratchDirectory('log-retention-', t);
  fs.writeFileSync(path.join(directory, 'ai.log'), JSON.stringify({
    timestamp: '2026-10-01T00:00:00Z', type: 'request_failed', prompt: 'private prompt', response: 'private response',
    error: { code: 'FAILED', message: 'failed Authorization: Bearer private-token', stack: 'Error at fixture.js:1:1' },
  }) + '\n');
  maintainDesktopLogs(directory, Date.parse('2026-10-13T00:00:00Z'));
  assert.equal(fs.existsSync(path.join(directory, 'ai.log')), false);
  const error = fs.readFileSync(path.join(directory, 'errors', 'ai.jsonl'), 'utf8');
  assert.equal(JSON.parse(error).error.code, 'FAILED');
  assert.doesNotMatch(error, /private prompt|private response|private-token/);
});

test('oversized legacy files retain recent errors without keeping unbounded input', (t) => {
  const directory = createScratchDirectory('log-retention-', t);
  for (const [name, entry] of [
    ['desktop.log', '[2026-10-01T00:00:00Z] [desktop:startup-warning] latest warning\n'],
    ['ai.log', JSON.stringify({ timestamp: '2026-10-01T00:00:00Z', type: 'request_failed', error: { message: 'latest AI failure' } }) + '\n'],
  ]) {
    const file = path.join(directory, name);
    const descriptor = fs.openSync(file, 'w');
    fs.ftruncateSync(descriptor, 33 * 1024 * 1024);
    fs.closeSync(descriptor);
    fs.appendFileSync(file, `\n${entry}`);
  }
  maintainDesktopLogs(directory, Date.parse('2026-10-13T00:00:00Z'));
  assert.match(fs.readFileSync(path.join(directory, 'errors', 'desktop.log'), 'utf8'), /latest warning/);
  assert.match(fs.readFileSync(path.join(directory, 'errors', 'ai.jsonl'), 'utf8'), /latest AI failure/);
  assert.equal(fs.existsSync(path.join(directory, 'desktop.log')), false);
  assert.equal(fs.existsSync(path.join(directory, 'ai.log')), false);
});
