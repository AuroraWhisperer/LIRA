'use strict';

const { now } = require('../shared/utils');

// ── 清空操作矩阵 ──

/**
 * Clear-all matrix: 定义哪些表保留、删除、重建默认行。
 * 保留：配置类（settings、ai_configuration、theme_presets、favorites、playlists）
 *       加班机状态（overtime_machine_state、overtime_gift_rules）
 * 删除：所有业务数据（歌曲、队列、礼物、SC、播放历史、签到等）
 * 重建：默认分类、禁用加班机初始状态
 */
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
        revision: 0,
      },
    },
  ],
};

// ── 清空操作 ──

function clearSongLibraryData(db) {
  db.exec('BEGIN');
  try {
    db.prepare(
      'UPDATE queue SET song_id = NULL WHERE song_id IS NOT NULL',
    ).run();
    db.prepare(
      'UPDATE requests SET song_id = NULL WHERE song_id IS NOT NULL',
    ).run();
    db.prepare('DELETE FROM songs').run();
    db.prepare('DELETE FROM song_categories').run();
    db.prepare('DELETE FROM import_batches').run();
    db.prepare(
      `
      DELETE FROM sqlite_sequence
      WHERE name IN ('songs', 'song_categories', 'import_batches')
    `,
    ).run();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return {
    cleared: true,
    scope: 'song-library',
    preserved: ['settings', 'theme', 'roomId', 'queue', 'requestHistory'],
  };
}

function clearSuperChatData(db) {
  db.exec('BEGIN');
  try {
    const result = db
      .prepare('SELECT COUNT(*) AS count FROM super_chats')
      .get();
    const cleared = result ? result.count : 0;
    db.prepare('DELETE FROM super_chats').run();
    db.prepare("DELETE FROM sqlite_sequence WHERE name = 'super_chats'").run();
    db.exec('COMMIT');
    return {
      cleared: true,
      scope: 'super-chats',
      deletedCount: cleared,
    };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** 清空播放器数据；主题预设留在 songDb，不受影响 */
function clearPlaybackData(musicDb) {
  musicDb.exec('BEGIN');
  try {
    const history =
      (
        musicDb.prepare('SELECT COUNT(*) AS count FROM play_history').get() ||
        {}
      ).count || 0;
    musicDb.prepare('DELETE FROM play_history').run();
    musicDb.prepare('DELETE FROM play_queue_state').run();
    musicDb
      .prepare("DELETE FROM sqlite_sequence WHERE name = 'play_history'")
      .run();
    musicDb.exec('COMMIT');
    return { cleared: true, scope: 'playback', deletedCount: history };
  } catch (error) {
    musicDb.exec('ROLLBACK');
    throw error;
  }
}

function clearGiftData(giftDb, options = {}) {
  const timestamp = now();
  const sourceId = normalizeOptionalSourceId(options.sourceId);

  giftDb.exec('BEGIN IMMEDIATE');
  try {
    const result = clearGiftScopeInTransaction(giftDb, sourceId, timestamp);

    giftDb.exec('COMMIT');
    return result;
  } catch (error) {
    giftDb.exec('ROLLBACK');
    throw error;
  }
}

/**
 * 清空全部业务数据，保留配置。使用两阶段提交确保原子性。
 * Phase 1: 开启所有事务并执行 DELETE，但不提交
 * Phase 2: 依次提交所有事务；如有失败则返回部分失败状态
 */
function clearAllData(
  songDb,
  superChatDb,
  giftDb,
  musicDb,
  checkinDb,
  options = {},
) {
  const giftSourceId = normalizeOptionalSourceId(options.sourceId);
  const counts = {
    songs: 0,
    categories: 0,
    queue: 0,
    requests: 0,
    importBatches: 0,
    userCooldowns: 0,
    aiRequestLogs: 0,
    aiApiUsage: 0,
    aiViewerContext: 0,
    aiQueryCache: 0,
    aiBlacklist: 0,
    sc: 0,
    gifts: 0,
    overtimeSettlements: 0,
    playHistory: 0,
    playQueueState: 0,
    checkins: 0,
  };
  let giftProjectionReset = null;

  const databases = [
    { name: 'songDb', db: songDb },
    { name: 'superChatDb', db: superChatDb },
    { name: 'giftDb', db: giftDb },
    { name: 'musicDb', db: musicDb },
    { name: 'checkinDb', db: checkinDb },
  ];

  // Phase 1: 开启所有事务并执行 DELETE，统计行数
  const beginErrors = [];
  const rollbackAll = () => {
    for (const { name, db } of databases) {
      if (db) {
        try {
          db.exec('ROLLBACK');
        } catch (rollbackError) {
          console.warn(
            `[Database] Failed to rollback ${name}:`,
            rollbackError.message,
          );
        }
      }
    }
  };

  try {
    // songDb: 清空业务数据，保留 settings, ai_configuration, theme_presets
    songDb.exec('BEGIN');
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
  } catch (error) {
    beginErrors.push({ db: 'songDb', phase: 'delete', error: error.message });
    rollbackAll();
  }

  if (beginErrors.length === 0) {
    try {
      superChatDb.exec('BEGIN');
      counts.sc = countRows(superChatDb, 'super_chats');
      superChatDb.prepare('DELETE FROM super_chats').run();
      superChatDb
        .prepare("DELETE FROM sqlite_sequence WHERE name = 'super_chats'")
        .run();
    } catch (error) {
      beginErrors.push({
        db: 'superChatDb',
        phase: 'delete',
        error: error.message,
      });
      rollbackAll();
    }
  }

  if (beginErrors.length === 0) {
    try {
      giftDb.exec('BEGIN IMMEDIATE');
      const timestamp = now();
      const giftResult = clearGiftScopeInTransaction(
        giftDb,
        giftSourceId,
        timestamp,
      );
      counts.gifts = giftResult.gifts;
      counts.overtimeSettlements = giftResult.overtimeSettlements;
      giftProjectionReset = giftResult.projectionReset;
    } catch (error) {
      beginErrors.push({ db: 'giftDb', phase: 'delete', error: error.message });
      rollbackAll();
    }
  }

  if (beginErrors.length === 0 && musicDb) {
    try {
      musicDb.exec('BEGIN');
      counts.playHistory = countRows(musicDb, 'play_history');
      counts.playQueueState = countRows(musicDb, 'play_queue_state');
      musicDb.prepare('DELETE FROM play_history').run();
      musicDb.prepare('DELETE FROM play_queue_state').run();
      musicDb
        .prepare("DELETE FROM sqlite_sequence WHERE name = 'play_history'")
        .run();
    } catch (error) {
      beginErrors.push({
        db: 'musicDb',
        phase: 'delete',
        error: error.message,
      });
      rollbackAll();
    }
  }

  if (beginErrors.length === 0 && checkinDb) {
    try {
      checkinDb.exec('BEGIN');
      counts.checkins = countRows(checkinDb, 'checkin_users');
      checkinDb.prepare('DELETE FROM checkin_users').run();
    } catch (error) {
      beginErrors.push({
        db: 'checkinDb',
        phase: 'delete',
        error: error.message,
      });
      rollbackAll();
    }
  }

  // 如果 Phase 1 有任何失败，返回错误
  if (beginErrors.length > 0) {
    const error = new Error(
      `Clear-all pre-commit failed: ${beginErrors.map((e) => `${e.db} ${e.phase}`).join(', ')}`,
    );
    error.details = beginErrors;
    throw error;
  }

  // Phase 2: 依次提交所有事务
  const commitResults = [];
  const committed = [];
  const failed = [];

  for (const { name, db } of databases) {
    if (!db) continue;
    try {
      db.exec('COMMIT');
      committed.push(name);
      commitResults.push({ db: name, status: 'committed' });
    } catch (error) {
      failed.push(name);
      commitResults.push({ db: name, status: 'failed', error: error.message });
      // 首次提交失败后立即停止，不再尝试后续提交
      break;
    }
  }

  // 如果有提交失败，返回部分失败状态
  if (failed.length > 0) {
    const committedSet = new Set(committed);
    const rolledBack = [];
    const rollbackFailed = [];
    for (const { name, db } of databases) {
      if (!db || committedSet.has(name)) continue;
      try {
        db.exec('ROLLBACK');
        rolledBack.push(name);
      } catch (error) {
        rollbackFailed.push(name);
      }
    }

    return {
      ok: false,
      partial: true,
      committed,
      failed,
      rolledBack,
      rollbackFailed,
      error: `Commit failed at ${failed[0]}`,
      deletedCounts: counts,
      giftProjectionReset,
      results: commitResults,
    };
  }

  // Phase 3: 所有提交成功，重建默认行
  try {
    // 重建默认分类
    const timestamp = now();
    songDb
      .prepare(
        `
      INSERT INTO song_categories (name, sort_order, is_enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `,
      )
      .run('默认', 0, 1, timestamp, timestamp);

    // 确保加班机状态行存在且为禁用状态
    giftDb
      .prepare(
        `
      INSERT OR REPLACE INTO overtime_machine_state (
        id, enabled, enable_epoch, initial_seconds, remaining_ms,
        anchor_at_ms, status, background_path, background_fit, revision, updated_at
      ) VALUES (1, 0, 0, 0, 0, 0, 'paused', '', 'cover', 0, ?)
    `,
      )
      .run(timestamp);
  } catch (error) {
    console.warn(
      '[Database] Failed to recreate defaults after clear-all:',
      error.message,
    );
  }

  return {
    cleared: true,
    scope: 'all',
    preserved: CLEAR_ALL_MATRIX.preserve,
    deletedCounts: counts,
    totalDeleted: Object.values(counts).reduce((a, b) => a + b, 0),
    giftProjectionReset,
    recreated: ['song_categories', 'overtime_machine_state'],
  };
}

function clearGiftScopeInTransaction(giftDb, sourceId, timestamp) {
  if (sourceId === null) {
    return { gifts: 0, overtimeSettlements: 0, projectionReset: null };
  }
  const targetSql = 'source_id = ?';
  const targetParams = [sourceId];
  const reset = giftDb
    .prepare(
      `
        UPDATE gift_sync_state
        SET sync_epoch = NULL, final_cursor = NULL,
            bootstrap_complete = 0, bootstrap_page_token = NULL,
            bootstrap_recovery_cursor = NULL,
            bootstrap_sync_epoch = NULL,
            projection_generation = projection_generation + 1,
            last_validated_at = NULL, updated_at = ?
        WHERE source_id = ?
      `,
    )
    .run(timestamp, sourceId);
  if (Number(reset.changes) !== 1) throw new Error('GIFT_SOURCE_NOT_FOUND');
  const state = giftDb
    .prepare(
      `
        SELECT projection_generation
        FROM gift_sync_state
        WHERE source_id = ?
      `,
    )
    .get(sourceId);
  const projectionReset = Object.freeze({
    sourceId,
    projectionGeneration: Number(state.projection_generation),
  });
  const giftCount = Number(
    giftDb
      .prepare(
        `SELECT COUNT(*) AS count FROM gift_events WHERE ${targetSql}`,
      )
      .get(...targetParams)?.count || 0,
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
  giftDb
    .prepare(`DELETE FROM gift_events WHERE ${targetSql}`)
    .run(...targetParams);

  if (countRows(giftDb, 'gift_events') === 0) {
    giftDb
      .prepare("DELETE FROM sqlite_sequence WHERE name = 'gift_events'")
      .run();
  }
  if (countRows(giftDb, 'overtime_settlements') === 0) {
    giftDb
      .prepare(
        "DELETE FROM sqlite_sequence WHERE name = 'overtime_settlements'",
      )
      .run();
  }

  return {
    gifts: giftCount,
    overtimeSettlements: settlementCount,
    projectionReset,
  };
}

function normalizeOptionalSourceId(value) {
  if (value === undefined || value === null || value === '') return null;
  const sourceId = Number(value);
  if (!Number.isSafeInteger(sourceId) || sourceId < 1) {
    throw new Error('INVALID_GIFT_SOURCE');
  }
  return sourceId;
}

function countRows(db, tableName) {
  return (
    (db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() || {})
      .count || 0
  );
}

// ── 数据库关闭与优化 ──

/** 关闭所有数据库连接；由 server.js shutdown 统一调用，不在各处散写 .close() */
function closeDatabases(...databases) {
  for (const db of flattenDatabases(databases)) {
    try {
      db.close();
    } catch (error) {
      console.warn('[Shutdown] database close failed:', error.message);
    }
  }
}

function optimizeDatabases(...databases) {
  for (const db of flattenDatabases(databases)) {
    try {
      db.exec('PRAGMA optimize');
    } catch (error) {
      console.warn('[Shutdown] database optimize failed:', error.message);
    }
  }
}

// 同时接受 (songDb, superChatDb, ...) 和 ({ songDb, superChatDb, ... }) 两种传法
function flattenDatabases(args) {
  const list = [];
  for (const entry of args) {
    if (!entry) continue;
    if (typeof entry.close === 'function' || typeof entry.exec === 'function') {
      list.push(entry);
    } else if (typeof entry === 'object') {
      for (const value of Object.values(entry)) {
        if (value && typeof value.exec === 'function') list.push(value);
      }
    }
  }
  return list;
}

module.exports = {
  CLEAR_ALL_MATRIX,
  clearSongLibraryData,
  clearSuperChatData,
  clearPlaybackData,
  clearGiftData,
  clearAllData,
  countRows,
  closeDatabases,
  optimizeDatabases,
};
