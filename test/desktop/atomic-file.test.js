'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { writeAtomicFile, writeAtomicFileAsync, renameWithRetry } = require('../../src/electron/atomic-file');

test('atomic write cleanup preserves the original failure and skips cleanup after rename', async t => {
  const original = new Error('synthetic rename failure');
  let failRename = true;
  let cleaned = 0;
  t.mock.method(fs, 'writeFileSync', () => {});
  t.mock.method(fs, 'renameSync', () => { if (failRename) throw original; });
  t.mock.method(fs, 'rmSync', () => { cleaned++; throw new Error('synthetic cleanup failure'); });
  assert.throws(() => writeAtomicFile('synthetic', 'value'), error => error === original);
  failRename = false;
  writeAtomicFile('synthetic', 'value');
  assert.equal(cleaned, 1);

  const fileSystem = {
    writeFile: async () => {},
    rename: async () => { if (failRename) throw original; },
    unlink: () => { cleaned++; throw new Error('synthetic cleanup failure'); },
  };
  failRename = true;
  await assert.rejects(writeAtomicFileAsync('synthetic', 'value', fileSystem), error => error === original);
  failRename = false;
  await writeAtomicFileAsync('synthetic', 'value', fileSystem);
  assert.equal(cleaned, 2);
});

test('rename retry preserves a non-Error rejection', async () => {
  let caught = false;
  await renameWithRetry('synthetic', 'target', { fileSystem: { rename: async () => { throw null; } } })
    .catch(error => { caught = true; assert.equal(error, null); });
  assert.equal(caught, true);
});
