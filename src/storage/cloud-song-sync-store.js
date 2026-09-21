'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { now } = require('../shared/utils');

const CLOUD_SONG_SYNC_PENDING_PREFIX = 'cloudSongSyncPending:';

function pendingKey(accountKey) {
  return CLOUD_SONG_SYNC_PENDING_PREFIX + createHash('sha256').update(accountKey).digest('hex');
}

function createCloudSongSyncStore(db) {
  return {
    // The song mutation owns this transaction, so neither write can commit alone.
    capturePending() {
      const accountKey = db.prepare('SELECT value FROM settings WHERE key = ?')
        .get('cloudRoomAccountKey')?.value;
      if (!accountKey) return;
      const songs = db.prepare(`
        SELECT songs.*, COALESCE(song_categories.name, '默认') AS category_name
        FROM songs
        LEFT JOIN song_categories ON song_categories.id = songs.category_id
        ORDER BY songs.name_initial ASC, songs.name COLLATE NOCASE ASC, songs.artist COLLATE NOCASE ASC
      `).all();
      db.prepare(`
        INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(pendingKey(accountKey), JSON.stringify({ mutationId: randomUUID(), songs }), now());
    },

    readPending(accountKey) {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(pendingKey(accountKey));
      return row ? JSON.parse(row.value) : null;
    },

    acknowledge(accountKey, mutationId) {
      const result = db.prepare(`
        DELETE FROM settings WHERE key = ? AND json_extract(value, '$.mutationId') = ?
      `).run(pendingKey(accountKey), mutationId);
      return Number(result.changes) === 1;
    },
  };
}

module.exports = { CLOUD_SONG_SYNC_PENDING_PREFIX, createCloudSongSyncStore };
