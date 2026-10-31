'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLocalMediaAccess, hasExactOrigin } = require('../../src/electron/local-media-access');
const { registerLocalMediaProtocol } = require('../../src/electron/local-media-protocol');

test('explicit local media access survives a cold start and remains path-specific', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'song-request-local-media-'));
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

test('failed allowlist persistence keeps memory unchanged and retries the same file', (t) => {
  const { createScratchDirectory, removeScratchDirectory } = require('../helpers/scratch-directory');
  const root = createScratchDirectory('local-media-retry-');
  t.after(() => removeScratchDirectory(root));
  const selected = path.join(root, 'selected.mp3');
  const existing = path.join(root, 'existing.mp3');
  fs.writeFileSync(selected, 'audio');
  fs.writeFileSync(existing, 'audio');
  const access = createLocalMediaAccess(root);
  access.allowPath(existing);
  const write = fs.writeFileSync;
  let fail = true;
  t.mock.method(fs, 'writeFileSync', (...args) => {
    if (fail && args[0] === path.join(root, 'local-media-access.json')) {
      fail = false;
      throw new Error('temporary write failure');
    }
    return write(...args);
  });
  assert.throws(() => access.allowPath(selected), /temporary write failure/);
  assert.equal(access.isAllowed(selected), false);
  assert.equal(access.isAllowed(existing), true);
  access.allowPath(selected);
  const cold = createLocalMediaAccess(root);
  assert.equal(cold.isAllowed(selected), true);
  assert.equal(cold.isAllowed(existing), true);
});
test('dataDir files are not implicitly allowed (security: no privilege escalation)', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'song-request-local-media-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const dataDir = path.join(tempRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, '.session-token'), 'secret-token', 'utf8');
  fs.writeFileSync(path.join(dataDir, 'database.db'), 'db-content', 'utf8');
  fs.writeFileSync(path.join(dataDir, 'config.json'), '{}', 'utf8');

  const access = createLocalMediaAccess(dataDir);
  // Verify sensitive files are rejected even though they're in dataDir
  assert.equal(access.isAllowed(path.join(dataDir, '.session-token')), false);
  assert.equal(access.isAllowed(path.join(dataDir, 'database.db')), false);
  assert.equal(access.isAllowed(path.join(dataDir, 'config.json')), false);
  assert.equal(access.isAllowed(path.join(dataDir, 'local-media-access.json')), false);
});

test('IPC sender validation compares exact origins', () => {
  const expected = 'http://127.0.0.1:3000';
  assert.equal(hasExactOrigin('http://127.0.0.1:3000/admin?desktop=1', expected), true);
  assert.equal(hasExactOrigin('http://127.0.0.1:3000@evil.example/admin', expected), false);
  assert.equal(hasExactOrigin('http://127.0.0.1:3001/admin', expected), false);
});

test('only audio extensions are allowed in the whitelist', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'song-request-local-media-'));
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
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'song-request-local-media-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const dataDir = path.join(tempRoot, 'data');
  const musicDir = path.join(tempRoot, 'music');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(musicDir, { recursive: true });

  const realFile = path.join(musicDir, 'track.mp3');
  const symlinkFile = path.join(tempRoot, 'link-to-track.mp3');
  const junctionDir = path.join(tempRoot, 'link-to-music');
  fs.writeFileSync(realFile, 'fake-audio', 'utf8');

  const linkedFile = process.platform === 'win32' ? path.join(junctionDir, 'track.mp3') : symlinkFile;
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

test('local media protocol enforces authorization and serves byte ranges', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-local-media-'));
  const allowedPath = path.join(tempDir, 'allowed.mp3');
  const blockedPath = path.join(tempDir, 'blocked.mp3');
  fs.writeFileSync(allowedPath, Buffer.from('abcdef'));
  fs.writeFileSync(blockedPath, Buffer.from('blocked'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  let handler = null;
  registerLocalMediaProtocol(
    {
      handle(scheme, nextHandler) {
        assert.equal(scheme, 'local-media');
        handler = nextHandler;
      },
    },
    (filePath) => filePath === allowedPath,
    () => 'http://127.0.0.1:3000',
  );

  const allowedUrl = `local-media://media/${Buffer.from(allowedPath).toString('base64url')}`;
  const partial = await handler({
    url: allowedUrl,
    headers: new Headers({ range: 'bytes=1-3', origin: 'http://127.0.0.1:3000' }),
  });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('access-control-allow-origin'), 'http://127.0.0.1:3000');
  assert.equal(partial.headers.get('content-range'), 'bytes 1-3/6');
  assert.equal(Buffer.from(await partial.arrayBuffer()).toString('utf8'), 'bcd');

  const inverted = await handler({
    url: allowedUrl,
    headers: new Headers({ range: 'bytes=4-2', origin: 'http://127.0.0.1:3000.evil.example' }),
  });
  assert.equal(inverted.status, 200);
  assert.equal(inverted.headers.get('access-control-allow-origin'), null);
  assert.equal(inverted.headers.get('content-range'), null);
  assert.equal(Buffer.from(await inverted.arrayBuffer()).toString('utf8'), 'abcdef');

  const blockedUrl = `local-media://media/${Buffer.from(blockedPath).toString('base64url')}`;
  const blocked = await handler({ url: blockedUrl, headers: new Headers() });
  assert.equal(blocked.status, 403);
});
