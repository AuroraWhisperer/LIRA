'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { syncDanmakuSource } = require('../../scripts/sync-danmaku-source.cjs');
const { createScratchDirectory } = require('../helpers/scratch-directory');

test('the shipped renderer matches its pinned source without a server checkout', () => {
  assert.equal(syncDanmakuSource().sourceRepository, 'lira-server');
});

test('explicit import normalizes line endings; verification rejects drift without writing', t => {
  const scratch = createScratchDirectory('danmaku-source-');
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const root = path.join(scratch, 'desktop');
  const serverRoot = path.join(scratch, 'server');
  const sourcePath = path.join(serverRoot, 'public/overlay/danmaku-renderer-core.js');
  const targetPath = path.join(root, 'public/js/overlays/danmaku-renderer-core.js');
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, 'export const value = 1;\r\n');
  assert.throws(() => syncDanmakuSource({ root, write: true }), /explicit/);
  assert.equal(fs.existsSync(root), false);
  syncDanmakuSource({ root, serverRoot, write: true });
  assert.equal(fs.readFileSync(targetPath, 'utf8'), 'export const value = 1;\n');
  syncDanmakuSource({ root, serverRoot });
  fs.writeFileSync(sourcePath, 'export const value = 2;\n');
  syncDanmakuSource({ root });
  assert.throws(() => syncDanmakuSource({ root, serverRoot }), /selected server source differs/);
  assert.equal(fs.readFileSync(targetPath, 'utf8'), 'export const value = 1;\n');
  fs.writeFileSync(targetPath, 'corrupted');
  assert.throws(() => syncDanmakuSource({ root }), /pinned snapshot/);
  assert.equal(fs.readFileSync(targetPath, 'utf8'), 'corrupted');
});
