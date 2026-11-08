'use strict';

const database = require('../storage/database');
const retention = require('../storage/retention');

function createDataMaintenanceRuntime({ db, getSettings, ensureSongCategory, ensureUnifiedQueue,
  clearSuperChatUndo, getActiveGiftSource, reloadOvertimeState, resetUserCooldowns }) {
  // Schema versions only change during startup migration.
  let schemaVersionsCache = null;

  function activeGiftSourceId() {
    const source = getActiveGiftSource?.();
    if (source?.syncState === 'SOURCE_SWITCHING') return null;
    const sourceId = Number(source?.sourceId);
    return Number.isSafeInteger(sourceId) && sourceId >= 1 ? sourceId : null;
  }

  return {
    clearSongLibrary() {
      const result = database.clearSongLibraryData(db.songDb);
      ensureSongCategory('默认');
      ensureUnifiedQueue();
      return result;
    },
    clearSuperChats() {
      clearSuperChatUndo();
      return database.clearSuperChatData(db.superChatDb);
    },
    clearPlayback: () => database.clearPlaybackData(db.musicDb),
    clearGifts() {
      return database.clearGiftData(db.giftDb, { sourceId: activeGiftSourceId() });
    },
    clearAll() {
      clearSuperChatUndo();
      const result = database.clearAllData(db.songDb, db.superChatDb, db.giftDb, db.musicDb, db.checkinDb, {
        sourceId: activeGiftSourceId(),
      });

      // Only reset live state after all databases have committed successfully.
      if (result.cleared === true && !result.partial) {
        try {
          reloadOvertimeState();
          resetUserCooldowns();
          ensureSongCategory('默认');
          ensureUnifiedQueue();
        } catch (error) {
          return {
            ...result,
            ok: false,
            cleared: false,
            partial: true,
            phase: 'runtime-reset',
            failed: [],
            error: `数据已清空，但运行状态重载失败：${error.message}`,
          };
        }
      }
      return result;
    },
    getSchemaVersions() {
      if (!schemaVersionsCache) schemaVersionsCache = database.getSchemaVersions(db);
      return schemaVersionsCache;
    },
    getRetentionStats: () => retention.getRetentionStats(db),
    runRetention(options = {}) {
      if (options.dryRun !== true && options.giftEventsOnly !== true) clearSuperChatUndo();
      const policy = options.policy || retention.readRetentionPolicy(getSettings());
      return retention.applyRetentionPolicies(db, {
        policy,
        dryRun: options.dryRun === true,
        ranAt: options.ranAt,
        giftEventsOnly: options.giftEventsOnly === true,
      });
    },
  };
}

function runClearAll({ clearAll, pauseGifts, resumeGifts, pauseOvertime, resumeOvertime,
  clearMusicCache, rebuildGiftProjection }) {
  function resumeWriters({ gifts = true, overtime = true } = {}) {
    try {
      // Prepare the settlement consumer before the detector can deliver gifts.
      if (overtime) resumeOvertime();
      if (gifts) resumeGifts();
    } catch (error) {
      pauseGifts();
      pauseOvertime();
      throw error;
    }
  }

  // Keep quiescing, database work and recovery in the same synchronous turn.
  const acquired = { gifts: false, overtime: false };
  let result;
  try {
    acquired.gifts = pauseGifts() !== false;
    acquired.overtime = pauseOvertime() !== false;
    result = clearAll();
  } catch (error) {
    try {
      resumeWriters(acquired);
    } catch (resumeError) {
      error.cause = resumeError;
    }
    throw error;
  }

  try {
    clearMusicCache?.();
  } catch (_) {
    /* cache cleanup is best-effort */
  }

  if (result.cleared && !result.partial) {
    try {
      resumeWriters();
    } catch (error) {
      result = {
        ...result,
        ok: false,
        cleared: false,
        partial: true,
        phase: 'resume',
        failed: [],
        error: `数据已清空，但写入恢复失败：${error.message}`,
      };
    }
  }

  const rebuild = result.partial === true
    ? result.giftProjectionReset && result.committed?.includes('giftDb')
    : result.cleared && result.giftProjectionReset;
  if (rebuild) {
    try {
      const pending = rebuildGiftProjection?.();
      pending?.catch?.(() => false);
    } catch (_) {
      /* projection recovery is best-effort and does not delay the result */
      return result;
    }
  }
  return result;
}

module.exports = { createDataMaintenanceRuntime, runClearAll };
