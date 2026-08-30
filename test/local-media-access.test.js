'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createLocalMediaAccess,
  hasExactOrigin,
} = require('../src/electron/local-media-access');

test('explicit local media access survives a cold start and remains path-specific', (t) => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-request-local-media-'),
  );
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const dataDir = path.join(tempRoot, 'data');
  const musicDir = path.join(tempRoot, 'music');
  const selectedPath = path.join(musicDir, 'selected.mp3');
  const siblingPath = path.join(musicDir, 'not-selected.mp3');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(musicDir, { recursive: true });
  fs.writeFileSync(selectedPath, 'fake-audio', 'utf8');
  fs.writeFileSync(siblingPath, 'fake-audio', 'utf8');

  const firstRun = createLocalMediaAccess(dataDir);
  assert.equal(firstRun.isAllowed(selectedPath), false);
  firstRun.allowPath(selectedPath);
  assert.equal(firstRun.isAllowed(selectedPath), true);
  assert.equal(firstRun.isAllowed(siblingPath), false);

  const coldStart = createLocalMediaAccess(dataDir);
  assert.equal(coldStart.isAllowed(selectedPath), true);
  assert.equal(coldStart.isAllowed(siblingPath), false);
});
test('dataDir files are not implicitly allowed (security: no privilege escalation)', (t) => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-request-local-media-'),
  );
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const dataDir = path.join(tempRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, '.session-token'),
    'secret-token',
    'utf8',
  );
  fs.writeFileSync(path.join(dataDir, 'database.db'), 'db-content', 'utf8');
  fs.writeFileSync(path.join(dataDir, 'config.json'), '{}', 'utf8');

  const access = createLocalMediaAccess(dataDir);
  // Verify sensitive files are rejected even though they're in dataDir
  assert.equal(access.isAllowed(path.join(dataDir, '.session-token')), false);
  assert.equal(access.isAllowed(path.join(dataDir, 'database.db')), false);
  assert.equal(access.isAllowed(path.join(dataDir, 'config.json')), false);
  assert.equal(
    access.isAllowed(path.join(dataDir, 'local-media-access.json')),
    false,
  );
});

test('IPC sender validation compares exact origins', () => {
  const expected = 'http://127.0.0.1:3000';
  assert.equal(
    hasExactOrigin('http://127.0.0.1:3000/admin?desktop=1', expected),
    true,
  );
  assert.equal(
    hasExactOrigin('http://127.0.0.1:3000@evil.example/admin', expected),
    false,
  );
  assert.equal(hasExactOrigin('http://127.0.0.1:3001/admin', expected), false);
});

test('only audio extensions are allowed in the whitelist', (t) => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-request-local-media-'),
  );
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const dataDir = path.join(tempRoot, 'data');
  const musicDir = path.join(tempRoot, 'music');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(musicDir, { recursive: true });

  const audioFile = path.join(musicDir, 'track.mp3');
  const textFile = path.join(musicDir, 'lyrics.txt');
  const jsFile = path.join(musicDir, 'malware.js');
  fs.writeFileSync(audioFile, 'fake-audio', 'utf8');
  fs.writeFileSync(textFile, 'lyrics', 'utf8');
  fs.writeFileSync(jsFile, 'alert(1)', 'utf8');

  const access = createLocalMediaAccess(dataDir);
  const allowed = access.allowPaths([audioFile, textFile, jsFile]);

  // Only the audio file should be granted
  assert.equal(allowed.length, 1);
  assert.equal(allowed[0], audioFile);
  assert.equal(access.isAllowed(audioFile), true);
  assert.equal(access.isAllowed(textFile), false);
  assert.equal(access.isAllowed(jsFile), false);
});

test('linked paths are canonicalized to prevent escape', (t) => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-request-local-media-'),
  );
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const dataDir = path.join(tempRoot, 'data');
  const musicDir = path.join(tempRoot, 'music');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(musicDir, { recursive: true });

  const realFile = path.join(musicDir, 'track.mp3');
  const symlinkFile = path.join(tempRoot, 'link-to-track.mp3');
  const junctionDir = path.join(tempRoot, 'link-to-music');
  fs.writeFileSync(realFile, 'fake-audio', 'utf8');

  const linkedFile =
    process.platform === 'win32'
      ? path.join(junctionDir, 'track.mp3')
      : symlinkFile;
  try {
    if (process.platform === 'win32') {
      // Directory junctions exercise the same realpath behavior without requiring elevation.
      fs.symlinkSync(musicDir, junctionDir, 'junction');
    } else {
      fs.symlinkSync(realFile, symlinkFile);
    }
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error?.code)) {
      t.skip(`linked path unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  const access = createLocalMediaAccess(dataDir);
  access.allowPaths([linkedFile]);

  // Both linked and real paths should resolve to the same canonical path.
  assert.equal(access.isAllowed(linkedFile), true);
  assert.equal(access.isAllowed(realFile), true);
});
