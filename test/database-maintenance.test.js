'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  clearAllData,
  closeDatabases,
  createDatabases
} = require('../src/storage/database');

test('clearAllData counts deleted and active queue rows', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-clear-all-'));
  const databases = createDatabases({ dataDir });
  try {
    const insertQueue = databases.songDb.prepare(`
      INSERT INTO queue (song_name, created_at, updated_at, status)
      VALUES (?, ?, ?, ?)
    `);
    insertQueue.run('Active', '2026-08-15T00:00:00.000Z', '2026-08-15T00:00:00.000Z', 'waiting');
    insertQueue.run('Deleted', '2026-08-15T00:00:01.000Z', '2026-08-15T00:00:01.000Z', 'deleted');

    const result = clearAllData(
      databases.songDb,
      databases.superChatDb,
      databases.giftDb,
      databases.musicDb,
      databases.checkinDb
    );

    assert.equal(result.deletedCounts.queue, 2);
    assert.equal(result.totalDeleted, Object.values(result.deletedCounts)
      .reduce((total, count) => total + count, 0));
    assert.equal(databases.songDb.prepare('SELECT COUNT(*) AS count FROM queue').get().count, 0);
  } finally {
    closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
