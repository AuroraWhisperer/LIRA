'use strict';

const { resetGiftProjectionMetadataInTransaction } = require('./gift-projection-reset');

const { createCloudSongSyncStore } = require('./cloud-song-sync-store');

// All operations run inside transactions owned by the clear coordinator.
// counts records attempted deletions, including progress before a SQL failure.
const CLEAR_ALL_MATRIX = {
  preserve: [
    'settings',
    'ai_configuration',
    'theme_presets',
    'overtime_machine_state',
    'overtime_gift_rules',
    'favorites',
    'playlists',
    'playlist_tracks',
    'fan_profiles',
    'fan_records',
    'fan_reminder_states',
    'fan_scopes',
    'fan_suppressions',
    'fan_restore_snapshots',
  ],
  delete: [
    'songs',
    'song_categories',
    'queue',
    'requests',
    'import_batches',
    'user_cooldowns',
    'ai_request_logs',
    'ai_api_usage',
    'ai_viewer_context',
    'ai_query_cache',
    'ai_blacklist',
    'super_chats',
    'gift_events',
    'overtime_settlements',
    'play_history',
    'play_queue_state',
    'checkin_users',
  ],
  recreate: [
    {
      table: 'song_categories',
      row: { name: '默认', sort_order: 0, is_enabled: 1 },
    },
    {
      table: 'overtime_machine_state',
      row: {
        id: 1,
        enabled: 0,
        enable_epoch: 0,
        initial_seconds: 0,
        remaining_ms: 0,
        anchor_at_ms: 0,
        status: 'paused',
        background_path: '',
        background_fit: 'cover',
        revision: 0, // Missing singleton default; an existing revision advances on clear-all.
      },
    },
  ],
};

function clearSongDataInTransaction(songDb, counts) {
  counts.songs = countRows(songDb, 'songs');
  counts.categories = countRows(songDb, 'song_categories');
  counts.queue = countRows(songDb, 'queue');
  counts.requests = countRows(songDb, 'requests');
  counts.importBatches = countRows(songDb, 'import_batches');
  counts.userCooldowns = countRows(songDb, 'user_cooldowns');
  counts.aiRequestLogs = countRows(songDb, 'ai_request_logs');
  counts.aiApiUsage = countRows(songDb, 'ai_api_usage');
  counts.aiViewerContext = countRows(songDb, 'ai_viewer_context');
  counts.aiQueryCache = countRows(songDb, 'ai_query_cache');
  counts.aiBlacklist = countRows(songDb, 'ai_blacklist');

  songDb.prepare('DELETE FROM requests').run();
  songDb.prepare('DELETE FROM queue').run();
  songDb.prepare('DELETE FROM songs').run();
  songDb.prepare('DELETE FROM song_categories').run();
  songDb.prepare('DELETE FROM import_batches').run();
  songDb.prepare('DELETE FROM user_cooldowns').run();
  songDb.prepare('DELETE FROM ai_request_logs').run();
  songDb.prepare('DELETE FROM ai_api_usage').run();
  songDb.prepare('DELETE FROM ai_viewer_context').run();
  songDb.prepare('DELETE FROM ai_query_cache').run();
  songDb.prepare('DELETE FROM ai_blacklist').run();
  songDb
    .prepare(
      `
  DELETE FROM sqlite_sequence
  WHERE name IN ('songs', 'song_categories', 'import_batches', 'queue', 'requests', 'ai_request_logs')
`,
    )
    .run();
  createCloudSongSyncStore(songDb).capturePending();
}

function clearSuperChatInTransaction(superChatDb, counts) {
  counts.sc = countRows(superChatDb, 'super_chats');
  superChatDb.prepare('DELETE FROM super_chats').run();
  superChatDb.prepare("DELETE FROM sqlite_sequence WHERE name = 'super_chats'").run();
}

function clearMusicInTransaction(musicDb, counts) {
  counts.playHistory = countRows(musicDb, 'play_history');
  counts.playQueueState = countRows(musicDb, 'play_queue_state');
  musicDb.prepare('DELETE FROM play_history').run();
  musicDb.prepare('DELETE FROM play_queue_state').run();
  musicDb.prepare("DELETE FROM sqlite_sequence WHERE name = 'play_history'").run();
}

function clearCheckinInTransaction(checkinDb, counts) {
  counts.checkins = countRows(checkinDb, 'checkin_users');
  checkinDb.prepare('DELETE FROM checkin_users').run();
}

function restoreSongDefaults(songDb, timestamp) {
  songDb
    .prepare(
      `
    INSERT INTO song_categories (name, sort_order, is_enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `,
    )
    .run('默认', 0, 1, timestamp, timestamp);
}

function restoreGiftDefaults(giftDb, timestamp) {
  giftDb
    .prepare(
      `
    INSERT OR REPLACE INTO overtime_machine_state (
      id, enabled, enable_epoch, initial_seconds, remaining_ms,
      anchor_at_ms, status, background_path, background_fit, revision, updated_at
    ) VALUES (1, 0, 0, 0, 0, 0, 'paused', '', 'cover',
      COALESCE((SELECT revision + 1 FROM overtime_machine_state WHERE id = 1), 0), ?)
  `,
    )
    .run(timestamp);
}

function clearGiftScopeInTransaction(giftDb, sourceId, timestamp) {
  if (sourceId === null) {
    return { gifts: 0, overtimeSettlements: 0, projectionReset: null };
  }
  const targetSql = 'source_id = ?';
  const targetParams = [sourceId];
  const projectionGeneration = resetGiftProjectionMetadataInTransaction(giftDb, sourceId, timestamp);
  const projectionReset = Object.freeze({
    sourceId,
    projectionGeneration,
  });
  const giftCount = Number(
    giftDb.prepare(`SELECT COUNT(*) AS count FROM gift_events WHERE ${targetSql}`).get(...targetParams)?.count || 0,
  );
  const settlementCount = Number(
    giftDb
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM overtime_settlements
        WHERE gift_event_id IN (
          SELECT id FROM gift_events WHERE ${targetSql}
        )
      `,
      )
      .get(...targetParams)?.count || 0,
  );

  giftDb
    .prepare(
      `
      DELETE FROM overtime_settlements
      WHERE gift_event_id IN (
        SELECT id FROM gift_events WHERE ${targetSql}
      )
    `,
    )
    .run(...targetParams);
  giftDb.prepare(`DELETE FROM gift_events WHERE ${targetSql}`).run(...targetParams);

  if (countRows(giftDb, 'gift_events') === 0) {
    giftDb.prepare("DELETE FROM sqlite_sequence WHERE name = 'gift_events'").run();
  }
  if (countRows(giftDb, 'overtime_settlements') === 0) {
    giftDb.prepare("DELETE FROM sqlite_sequence WHERE name = 'overtime_settlements'").run();
  }

  return {
    gifts: giftCount,
    overtimeSettlements: settlementCount,
    projectionReset,
  };
}

function countRows(db, tableName) {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() || {}).count || 0;
}

module.exports = {
  CLEAR_ALL_MATRIX,
  clearSongDataInTransaction,
  clearSuperChatInTransaction,
  clearMusicInTransaction,
  clearCheckinInTransaction,
  restoreSongDefaults,
  restoreGiftDefaults,
  clearGiftScopeInTransaction,
  countRows,
};
