'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createScratchDirectory, removeScratchDirectory } = require('../helpers/scratch-directory');
const { appendBoundedFileSync } = require('../../src/shared/log-size-limit');

function fixture(t) {
  const directory = createScratchDirectory('log-rotation-');
  t.after(() => removeScratchDirectory(directory));
  return { directory, file: path.join(directory, 'test.log') };
}

test('rotation retains recent diagnostics with a fixed aggregate budget across writers/restarts', (t) => {
  const { directory, file } = fixture(t);
  fs.writeFileSync(path.join(directory, 'unrelated.log'), 'preserve');
  for (let index = 0; index < 30; index += 1) {
    assert.equal(appendBoundedFileSync(file, `${index}: ${'错'.repeat(8)}\n`, {
      maxEntryBytes: 32, maxFileBytes: 64,
    }).written, true);
  }
  assert.deepEqual(fs.readdirSync(directory).sort(), ['test.log', 'test.log.1', 'test.log.2', 'unrelated.log']);
  for (const suffix of ['', '.1', '.2']) assert.ok(fs.statSync(file + suffix).size <= 64);
  assert.match(fs.readFileSync(file, 'utf8'), /29:/);
  assert.doesNotMatch(fs.readFileSync(file + '.2', 'utf8'), /\uFFFD/);
  assert.equal(fs.readFileSync(path.join(directory, 'unrelated.log'), 'utf8'), 'preserve');
});

test('oversized legacy files and archives shrink to complete UTF-8 lines without blocking new errors', (t) => {
  const { file } = fixture(t);
  for (const suffix of ['', '.1', '.2']) fs.writeFileSync(file + suffix, '旧记录\n'.repeat(100));
  assert.equal(appendBoundedFileSync(file, '最新错误\n', { maxEntryBytes: 64, maxFileBytes: 64 }).written, true);
  for (const suffix of ['', '.1', '.2']) {
    assert.ok(fs.statSync(file + suffix).size <= 64);
    assert.doesNotMatch(fs.readFileSync(file + suffix, 'utf8'), /\uFFFD/);
  }
  assert.match(fs.readFileSync(file, 'utf8'), /最新错误/);
});

test('an unsafe archive leaves the active file and unrelated target unchanged', (t) => {
  const { file } = fixture(t);
  fs.writeFileSync(file, 'old');
  fs.mkdirSync(`${file}.1`);
  const result = appendBoundedFileSync(file, 'new\n', { maxEntryBytes: 64, maxFileBytes: 64 });
  assert.equal(result.reason, 'unsafe-target');
  assert.equal(fs.readFileSync(file, 'utf8'), 'old');
});

test('symlink archives are rejected before any rotation or deletion', (t) => {
  const { directory, file } = fixture(t);
  const target = path.join(directory, 'target');
  fs.mkdirSync(target);
  fs.writeFileSync(file, 'old');
  fs.symlinkSync(target, `${file}.2`, 'junction');
  const result = appendBoundedFileSync(file, 'new\n', { maxEntryBytes: 64, maxFileBytes: 64 });
  assert.equal(result.reason, 'unsafe-target');
  assert.equal(fs.readFileSync(file, 'utf8'), 'old');
  assert.equal(fs.existsSync(target), true);
});
