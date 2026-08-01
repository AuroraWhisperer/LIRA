'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLocalMediaAccess, hasExactOrigin } = require('../src/electron/local-media-access');

test('explicit local media access survives a cold start and remains path-specific', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'song-request-local-media-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const dataDir = path.join(tempRoot, 'data');
  const selectedPath = path.join(tempRoot, 'music', 'selected.mp3');
  const siblingPath = path.join(tempRoot, 'music', 'not-selected.mp3');
  fs.mkdirSync(dataDir, { recursive: true });

  const firstRun = createLocalMediaAccess(dataDir);
  assert.equal(firstRun.isAllowed(selectedPath), false);
  firstRun.allowPath(selectedPath);
  assert.equal(firstRun.isAllowed(selectedPath), true);
  assert.equal(firstRun.isAllowed(siblingPath), false);

  const coldStart = createLocalMediaAccess(dataDir);
  assert.equal(coldStart.isAllowed(selectedPath), true);
  assert.equal(coldStart.isAllowed(siblingPath), false);
});

test('files under the application data directory remain allowed', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'song-request-local-media-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const dataDir = path.join(tempRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const access = createLocalMediaAccess(dataDir);
  assert.equal(access.isAllowed(path.join(dataDir, 'cache', 'track.mp3')), true);
});

test('IPC sender validation compares exact origins', () => {
  const expected = 'http://127.0.0.1:3000';
  assert.equal(hasExactOrigin('http://127.0.0.1:3000/admin?desktop=1', expected), true);
  assert.equal(hasExactOrigin('http://127.0.0.1:3000@evil.example/admin', expected), false);
  assert.equal(hasExactOrigin('http://127.0.0.1:3001/admin', expected), false);
});
