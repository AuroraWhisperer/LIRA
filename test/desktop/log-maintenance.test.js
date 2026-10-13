'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createScratchDirectory } = require('../helpers/scratch-directory');
const { maintainDesktopLogs } = require('../../src/electron/log-maintenance');

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
  fs.writeFileSync(normal, error);
  fs.mkdirSync(path.join(directory, 'errors', 'desktop.log'), { recursive: true });
  maintainDesktopLogs(directory, Date.parse('2026-10-13T00:00:00Z'));
  assert.equal(fs.readFileSync(normal, 'utf8'), error);
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
