'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createScratchDirectory, removeScratchDirectory } = require('../helpers/scratch-directory');
const { appendBoundedFileSync, appendBoundedLinesSync } = require('../../src/shared/log-size-limit');

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

test('a batch fills the current file and rotates on individually bounded UTF-8 entry boundaries', (t) => {
  const { file } = fixture(t);
  fs.writeFileSync(file, 'old\n');
  const first = '12345678\n';
  const half = '123456789abcdef\n';
  const lines = [first, '错'.repeat(24) + '\n', '!', half, half, 'last'];
  const result = appendBoundedLinesSync(file, lines, { maxEntryBytes: 20, maxFileBytes: 32 });
  assert.equal(result.count, lines.length);
  assert.equal(fs.readFileSync(`${file}.2`, 'utf8'), `old\n${first}错...[truncated]\n!`);
  assert.equal(fs.readFileSync(`${file}.1`, 'utf8'), half + half);
  assert.equal(fs.readFileSync(file, 'utf8'), 'last');
});

test('a locked active log preserves both archives across retries and rotates once after release', (t) => {
  const { file } = fixture(t);
  const options = { maxEntryBytes: 4, maxFileBytes: 4 };
  const line = '错\n';
  const contents = ['old\n', 'one\n', 'two\n'];
  const paths = [file, `${file}.1`, `${file}.2`];
  paths.forEach((name, index) => fs.writeFileSync(name, contents[index]));
  const rename = fs.renameSync;
  const lock = t.mock.method(fs, 'renameSync', (from, to) => {
    if (from === file) throw Object.assign(new Error('locked'), { code: 'EPERM' });
    return rename(from, to);
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const failed = appendBoundedFileSync(file, line, options);
    assert.equal(failed.written, false);
    assert.equal(failed.reason, 'write-failed');
    assert.equal(failed.bytes, 0);
    assert.deepEqual(paths.map((name) => fs.existsSync(name) && fs.readFileSync(name, 'utf8')), contents);
  }
  lock.mock.restore();

  const write = fs.writeSync;
  t.mock.method(fs, 'writeSync', (fd, buffer, offset) => write(fd, buffer, offset, 1), { times: 1 });
  const retried = appendBoundedFileSync(file, line, options);
  assert.equal(retried.written, true);
  assert.equal(retried.bytes, Buffer.byteLength(line));
  assert.equal(fs.readFileSync(file, 'utf8'), line);
  assert.equal(fs.readFileSync(`${file}.1`, 'utf8'), 'old\n');
  assert.equal(fs.readFileSync(`${file}.2`, 'utf8'), 'one\n');
});

test('a lock acquired after the archive advances preserves the batch prefix and the advanced archive', (t) => {
  const { file } = fixture(t);
  const options = { maxEntryBytes: 4, maxFileBytes: 8 };
  fs.writeFileSync(file, 'old\n');
  fs.writeFileSync(`${file}.1`, 'one\n');
  fs.writeFileSync(`${file}.2`, 'two\n');
  const rename = fs.renameSync;
  const lateLock = t.mock.method(fs, 'renameSync', (from, to) => {
    if (from === file && to === `${file}.1`) throw Object.assign(new Error('locked'), { code: 'EPERM' });
    return rename(from, to);
  });

  const partial = appendBoundedLinesSync(file, ['新\n', '错\n'], options);
  assert.equal(partial.count, 1);
  assert.equal(partial.bytes, 4);
  assert.equal(partial.reason, 'write-failed');
  assert.equal(appendBoundedFileSync(file, '错\n', options).written, false);
  assert.equal(fs.readFileSync(file, 'utf8'), 'old\n新\n');
  assert.equal(fs.readFileSync(`${file}.2`, 'utf8'), 'one\n');

  lateLock.mock.restore();
  assert.equal(appendBoundedFileSync(file, '错\n', options).written, true);
  assert.equal(fs.readFileSync(file, 'utf8'), '错\n');
  assert.equal(fs.readFileSync(`${file}.1`, 'utf8'), 'old\n新\n');
  assert.equal(fs.readFileSync(`${file}.2`, 'utf8'), 'one\n');
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

test('a newly unsafe archive stops the rest of a batch before it rotates', (t) => {
  const { directory, file } = fixture(t);
  const target = path.join(directory, 'target');
  fs.mkdirSync(target);
  const write = fs.writeSync;
  t.mock.method(fs, 'writeSync', (...args) => {
    const bytes = write(...args);
    fs.symlinkSync(target, `${file}.2`, 'junction');
    return bytes;
  }, { times: 1 });
  const result = appendBoundedLinesSync(file, ['old\n', 'new\n'], { maxEntryBytes: 4, maxFileBytes: 4 });
  assert.equal(result.reason, 'unsafe-target');
  assert.equal(result.count, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), 'old\n');
  assert.ok(fs.lstatSync(`${file}.2`).isSymbolicLink());
});
