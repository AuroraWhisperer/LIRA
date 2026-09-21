'use strict';

const { now } = require('../shared/utils');
const { createCloudSongSyncStore } = require('./cloud-song-sync-store');

const {
  CLEAR_ALL_MATRIX,
  clearGiftScopeInTransaction,
  countRows,
} = require('./database-clear-operations');
const { coordinateClearAll } = require('./database-clear-coordinator');

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
    createCloudSongSyncStore(db).capturePending();
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

/** Preserve the database facade's positional API. */
function clearAllData(
  songDb,
  superChatDb,
  giftDb,
  musicDb,
  checkinDb,
  options = {},
) {
  return coordinateClearAll({
    songDb,
    superChatDb,
    giftDb,
    musicDb,
    checkinDb,
    giftSourceId: normalizeOptionalSourceId(options.sourceId),
  });
}

function normalizeOptionalSourceId(value) {
  if (value === undefined || value === null || value === '') return null;
  const sourceId = Number(value);
  if (!Number.isSafeInteger(sourceId) || sourceId < 1) {
    throw new Error('INVALID_GIFT_SOURCE');
  }
  return sourceId;
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
