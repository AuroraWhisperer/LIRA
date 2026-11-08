'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createScratchDirectory } = require('../helpers/scratch-directory');
const { pruneManagedFiles } = require('../../src/shared/file-retention');

test('file retention removes only old unprotected managed files and keeps recent files above the budget', t => {
  const root = createScratchDirectory('file-retention-', t);
  const directory = path.join(root, 'cache'); fs.mkdirSync(directory);
  for (const name of ['expired.bin', 'kept.bin', 'budget.bin', 'recent.bin', 'unknown.txt']) {
    fs.writeFileSync(path.join(directory, name), '12345');
    fs.utimesSync(path.join(directory, name), 1, name === 'recent.bin' ? 99 : name === 'budget.bin' ? 80 : 1);
  }
  const result = pruneManagedFiles(root, directory, { matches: name => name.endsWith('.bin'),
    keep: new Set(['kept.bin']), now: 100000, minAgeMs: 10000, maxAgeMs: 50000, maxBytes: 5 });
  assert.equal(result.files, 2);
  assert.equal(result.bytes, 10);
  assert.deepEqual(fs.readdirSync(directory).sort(), ['kept.bin', 'recent.bin', 'unknown.txt']);
});

test('file retention refuses linked directories and files, and tolerates locked files without touching unrelated data', t => {
  const root = createScratchDirectory('file-retention-path-', t);
  const outside = createScratchDirectory('file-retention-outside-', t);
  fs.writeFileSync(path.join(outside, 'old.tmp'), 'keep');
  fs.symlinkSync(outside, path.join(root, 'linked'), 'junction');
  const policy = { matches: name => name.endsWith('.tmp'), maxAgeMs: 0 };
  assert.equal(pruneManagedFiles(root, path.join(root, 'linked'), policy).files, 0);
  assert.equal(pruneManagedFiles(root, outside, policy).files, 0);
  fs.symlinkSync(outside, path.join(root, 'link.tmp'), 'junction');
  fs.writeFileSync(path.join(root, 'locked.tmp'), 'locked');
  t.mock.method(fs, 'unlinkSync', () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); });
  assert.equal(pruneManagedFiles(root, root, policy).files, 0);
  assert.equal(fs.readFileSync(path.join(outside, 'old.tmp'), 'utf8'), 'keep');
});
