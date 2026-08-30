'use strict';

const {
  cleanText,
  normalizeGuardLevel,
  normalizePositiveInteger,
} = require('../shared/utils');

function createQueueStore(songDb) {
  return {
    countActive() {
      return songDb
        .prepare(
          `
        SELECT COUNT(*) AS count FROM queue
        WHERE status IN ('current', 'waiting')
      `,
        )
        .get().count;
    },

    findActiveBySongName(songName) {
      return (
        songDb
          .prepare(
            `
        SELECT id FROM queue
        WHERE status IN ('current', 'waiting') AND song_name = ?
        LIMIT 1
      `,
          )
          .get(songName) || null
      );
    },

    insertRequest(input) {
      songDb.exec('BEGIN');
      try {
        const result = songDb
          .prepare(
            `
          INSERT INTO queue (
            song_id, song_name, artist, category_name,
            requester_uid, requester_name,
            requester_guard_level, requester_medal_name, requester_medal_level,
            source, status, is_pinned, pinned_at,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          )
          .run(
            input.songId,
            input.songName,
            input.artist,
            input.categoryName,
            input.requesterUid,
            input.requesterName,
            input.requesterGuardLevel,
            input.requesterMedalName,
            input.requesterMedalLevel,
            input.source,
            input.status,
            input.isPinned,
            input.pinnedAt,
            input.createdAt,
            input.createdAt,
          );

        const queueId = Number(result.lastInsertRowid);
        songDb
          .prepare(
            `
          INSERT INTO requests (
            queue_id, song_id, song_name, artist, category_name,
            requester_uid, requester_name,
            requester_guard_level, requester_medal_name, requester_medal_level,
            message, source, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          )
          .run(
            queueId,
            input.songId,
            input.songName,
            input.artist,
            input.categoryName,
            input.requesterUid,
            input.requesterName,
            input.requesterGuardLevel,
            input.requesterMedalName,
            input.requesterMedalLevel,
            input.message,
            input.source,
            input.createdAt,
          );

        const item = normalizeQueueRow(
          songDb.prepare('SELECT * FROM queue WHERE id = ?').get(queueId),
        );
        songDb.exec('COMMIT');
        return item;
      } catch (error) {
        songDb.exec('ROLLBACK');
        throw error;
      }
    },

    completeNext(updatedAt) {
      const first = songDb
        .prepare(
          `
        SELECT id FROM queue
        WHERE status IN ('current', 'waiting')
        ORDER BY is_pinned DESC, datetime(NULLIF(pinned_at, '')) ASC, datetime(created_at) ASC, id ASC
        LIMIT 1
      `,
        )
        .get();
      if (!first) return false;
      songDb
        .prepare('UPDATE queue SET status = ?, updated_at = ? WHERE id = ?')
        .run('done', updatedAt, first.id);
      return true;
    },

    clearActive(updatedAt) {
      return songDb
        .prepare(
          `
        UPDATE queue SET status = 'deleted', updated_at = ?
        WHERE status IN ('current', 'waiting')
      `,
        )
        .run(updatedAt).changes;
    },

    setPinned(id, pinned, updatedAt) {
      songDb
        .prepare(
          'UPDATE queue SET is_pinned = ?, pinned_at = ?, updated_at = ? WHERE id = ?',
        )
        .run(pinned ? 1 : 0, pinned ? updatedAt : '', updatedAt, id);
    },

    setStatus(id, status, updatedAt) {
      songDb
        .prepare('UPDATE queue SET status = ?, updated_at = ? WHERE id = ?')
        .run(status, updatedAt, id);
    },

    listActive() {
      return songDb
        .prepare(
          `
        SELECT queue.*, requests.message AS request_message
        FROM queue
        LEFT JOIN requests ON requests.queue_id = queue.id
        WHERE status IN ('current', 'waiting')
        ORDER BY queue.is_pinned DESC, datetime(NULLIF(queue.pinned_at, '')) ASC, datetime(queue.created_at) ASC, queue.id ASC
      `,
        )
        .all()
        .map(normalizeQueueRow);
    },

    normalizeCurrentToWaiting(updatedAt) {
      songDb
        .prepare(
          `
        UPDATE queue SET status = 'waiting', updated_at = ?
        WHERE status = 'current'
      `,
        )
        .run(updatedAt);
    },
  };
}

function normalizeQueueRow(row) {
  if (!row) return null;
  return {
    ...row,
    is_pinned: Boolean(row.is_pinned),
    requester_guard_level: normalizeGuardLevel(row.requester_guard_level),
    requester_medal_name: cleanText(row.requester_medal_name),
    requester_medal_level: normalizePositiveInteger(row.requester_medal_level),
  };
}

module.exports = { createQueueStore };
