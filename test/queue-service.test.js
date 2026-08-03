'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { addQueueItem } = require('../src/music/queue-service');
const { closeDatabases, createDatabases } = require('../src/storage/database');

test('queue and request inserts roll back together when request persistence fails', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-queue-atomic-'));
  const db = createDatabases({ dataDir });
  const defaults = {
    queueLimit: '50',
    allowDuplicate: 'true',
    onlyFromLibrary: 'false'
  };

  try {
    db.songDb.exec(`
      CREATE TRIGGER fail_request_insert
      BEFORE INSERT ON requests
      BEGIN
        SELECT RAISE(ABORT, 'forced request failure');
      END
    `);

    assert.throws(() => addQueueItem({
      db,
      settings: () => defaults,
      settingsStore: { getDefaultSettings: () => defaults }
    }, {
      songName: 'Atomic Song',
      requesterName: 'Tester',
      message: 'request Atomic Song'
    }), /forced request failure/);

    assert.equal(db.songDb.prepare('SELECT COUNT(*) AS count FROM queue').get().count, 0);
    assert.equal(db.songDb.prepare('SELECT COUNT(*) AS count FROM requests').get().count, 0);
  } finally {
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
