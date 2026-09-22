'use strict';

const { randomUUID } = require('node:crypto');

const { cleanText, normalizeGuardLevel, normalizePositiveInteger } = require('../shared/utils');

function createQueueStore(
  songDb,
  { getFanScope = () => null, archiveAccepted = () => {}, archiveQueueState = () => {} } = {},
) {
  function updateStatus(where, values, status, updatedAt) {
    songDb.exec('SAVEPOINT queue_status');
    try {
      const requests = songDb
        .prepare(`SELECT requests.* FROM requests JOIN queue ON queue.id = requests.queue_id WHERE ${where}`)
        .all(...values);
      const result = songDb
        .prepare(`UPDATE queue SET status = ?, updated_at = ? WHERE ${where}`)
        .run(status, updatedAt, ...values);
      for (const request of requests) {
        if (request.owner_scope === getFanScope() && request.stable_id) {
          archiveQueueState(request.owner_scope, request.stable_id, status, updatedAt);
        }
      }
      songDb.exec('RELEASE queue_status');
      return result.changes;
    } catch (error) {
      songDb.exec('ROLLBACK TO queue_status');
      songDb.exec('RELEASE queue_status');
      throw error;
    }
  }
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
      const currentScope = getFanScope();
      const ownerScope = input.fanScope === undefined || input.fanScope === currentScope ? currentScope : null;
      const stableId = randomUUID();
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
        const request = songDb
          .prepare(
            `
          INSERT INTO requests (
            queue_id, song_id, song_name, artist, category_name,
            requester_uid, requester_name,
            requester_guard_level, requester_medal_name, requester_medal_level,
            message, source, created_at, stable_id, owner_scope, identity_type
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            stableId,
            ownerScope,
            input.identityType || null,
          );

        archiveAccepted(ownerScope, { ...input, stableId, queueId, requestId: Number(request.lastInsertRowid) });

        const item = normalizeQueueRow(songDb.prepare('SELECT * FROM queue WHERE id = ?').get(queueId));
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
      updateStatus('queue.id = ?', [first.id], 'done', updatedAt);
      return true;
    },

    clearActive(updatedAt) {
      return updateStatus("queue.status IN ('current', 'waiting')", [], 'deleted', updatedAt);
    },

    setPinned(id, pinned, updatedAt) {
      songDb
        .prepare('UPDATE queue SET is_pinned = ?, pinned_at = ?, updated_at = ? WHERE id = ?')
        .run(pinned ? 1 : 0, pinned ? updatedAt : '', updatedAt, id);
    },

    setStatus(id, status, updatedAt) {
      updateStatus('queue.id = ?', [id], status, updatedAt);
    },

    listActive() {
      return songDb
        .prepare(
          `
        SELECT queue.*, requests.message AS request_message,
          requests.identity_type AS requester_identity_type
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
