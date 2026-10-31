'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const test = require('node:test');
const { createScratchDirectory, removeScratchDirectory } = require('../helpers/scratch-directory');
const { getMusicDir } = require('../../src/server/opening-media-store');
const { resolveOpeningMediaSlot, saveOpeningMedia, clearOpeningMedia } = require('../../src/server/opening-service');
const { serveOpeningMedia } = require('../../src/server/opening-media-http');
const { createDatabases, closeDatabases } = require('../../src/storage/database');
const { createSettingsStore } = require('../../src/storage/settings-store');

test('failed opening media publication removes the temporary file before any settings write', t => {
  const dataDir = createScratchDirectory('opening-failed-save-', t);
  const failure = new Error('rename failed');
  t.mock.method(fs, 'renameSync', () => { throw failure; });
  const context = {
    system: { dataDir },
    settings: { setMany() { assert.fail('Failed media must not be selected'); } },
    broadcastSnapshot() { assert.fail('Failed media must not be published'); },
  };
  assert.throws(() => saveOpeningMedia(context, resolveOpeningMediaSlot('music', 'classic'), {
    name: 'opening.mp3', extension: '.mp3', content: Buffer.from('music'),
  }), error => error === failure);
  assert.deepEqual(fs.readdirSync(getMusicDir(dataDir)), []);
});

test('failed selection or clear preserves both media settings and the current media URL', { timeout: 15000 }, async t => {
  const dataDir = createScratchDirectory('opening-settings-failure-');
  const databases = createDatabases({ dataDir });
  let server;
  t.after(async () => {
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    closeDatabases(databases);
    removeScratchDirectory(dataDir);
  });
  const store = createSettingsStore(databases.songDb);
  const notifications = [];
  const context = {
    system: { dataDir },
    settings: { get: store.getSettings, setMany: store.setSettings },
    broadcastSnapshot: reason => notifications.push(reason),
  };
  const slot = resolveOpeningMediaSlot('music', 'classic');
  const upload = name => ({ name, extension: '.mp3', content: Buffer.from(name) });
  const original = saveOpeningMedia(context, slot, upload('original.mp3'));
  const originalFile = store.getSettings().openingAudioFile;
  notifications.length = 0;
  databases.songDb.exec(`CREATE TEMP TRIGGER reject_media_name BEFORE UPDATE ON settings
    WHEN NEW.key = 'openingAudioName' BEGIN SELECT RAISE(ABORT, 'name write failed'); END`);
  assert.throws(() => saveOpeningMedia(context, slot, upload('replacement.mp3')), /name write failed/);
  assert.throws(() => clearOpeningMedia(context, slot), /name write failed/);
  for (const values of [store.getSettings(), createSettingsStore(databases.songDb).getSettings()]) {
    assert.equal(values.openingAudioFile, originalFile);
    assert.equal(values.openingAudioName, 'original.mp3');
  }
  assert.deepEqual(notifications, []);
  server = http.createServer((req, res) => serveOpeningMedia(dataDir, req, res,
    new URL(req.url, 'http://127.0.0.1'), () => store.getSettings().openingAudioFile));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(origin + original.audioUrl);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'original.mp3');
  databases.songDb.exec('DROP TRIGGER reject_media_name');
  const replacement = saveOpeningMedia(context, slot, upload('replacement.mp3'));
  assert.equal(replacement.audioName, 'replacement.mp3');
  assert.notEqual(replacement.audioUrl, original.audioUrl);
  assert.equal((await fetch(origin + original.audioUrl)).status, 404);
  assert.deepEqual(notifications, ['settings']);
  clearOpeningMedia(context, slot);
  assert.equal(store.getSettings().openingAudioFile, '');
  assert.equal(store.getSettings().openingAudioName, '');
});
