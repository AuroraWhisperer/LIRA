'use strict';

const { now } = require('../shared/utils');
const {
  clearSongDataInTransaction,
  clearSuperChatInTransaction,
  clearGiftScopeInTransaction,
  clearMusicInTransaction,
  clearCheckinInTransaction,
  restoreSongDefaults,
  restoreGiftDefaults,
} = require('./database-clear-operations');
const { createDeletedCounts, preCommitFailure, committedResult } = require('./database-clear-result');

function coordinateClearAll({ songDb, superChatDb, giftDb, musicDb, checkinDb, giftSourceId }) {
  const counts = createDeletedCounts();
  let giftProjectionReset = null;
  const databases = [
    { name: 'songDb', db: songDb, clear: clearSongDataInTransaction },
    {
      name: 'superChatDb',
      db: superChatDb,
      clear: clearSuperChatInTransaction,
    },
    {
      name: 'giftDb',
      db: giftDb,
      begin: 'BEGIN IMMEDIATE',
      clear(db) {
        const result = clearGiftScopeInTransaction(db, giftSourceId, now());
        counts.gifts = result.gifts;
        counts.overtimeSettlements = result.overtimeSettlements;
        giftProjectionReset = result.projectionReset;
      },
    },
    {
      name: 'musicDb',
      db: musicDb,
      clear: clearMusicInTransaction,
      optional: true,
    },
    {
      name: 'checkinDb',
      db: checkinDb,
      clear: clearCheckinInTransaction,
      optional: true,
    },
  ];
  const begun = [];
  const errors = [];
  for (const entry of databases) {
    if (entry.optional && !entry.db) continue;
    try {
      entry.db.exec(entry.begin || 'BEGIN');
      begun.push(entry);
      entry.clear(entry.db, counts);
    } catch (error) {
      errors.push({ db: entry.name, phase: 'delete', error: error.message });
      break;
    }
  }
  // Restore only after every delete has succeeded, before the first commit.
  if (errors.length === 0) {
    let defaultDb = 'songDb';
    try {
      const timestamp = now();
      restoreSongDefaults(songDb, timestamp);
      defaultDb = 'giftDb';
      restoreGiftDefaults(giftDb, timestamp);
    } catch (error) {
      errors.push({ db: defaultDb, phase: 'recreate', error: error.message });
    }
  }
  if (errors.length > 0) {
    return preCommitFailure({
      errors,
      ...rollbackDatabases(begun, true),
      counts,
      giftProjectionReset,
    });
  }
  return committedResult({
    ...commitDatabases(begun),
    counts,
    giftProjectionReset,
  });
}

function rollbackDatabases(databases, warn = false) {
  const rolledBack = [];
  const rollbackFailed = [];
  for (const { name, db } of databases) {
    try {
      db.exec('ROLLBACK');
      rolledBack.push(name);
    } catch (error) {
      rollbackFailed.push(name);
      if (warn) console.warn(`[Database] Failed to rollback ${name}:`, error.message);
    }
  }
  return { rolledBack, rollbackFailed };
}

function commitDatabases(databases) {
  const committed = [];
  const failed = [];
  const results = [];
  for (const { name, db } of databases) {
    try {
      db.exec('COMMIT');
      committed.push(name);
      results.push({ db: name, status: 'committed' });
    } catch (error) {
      failed.push(name);
      results.push({ db: name, status: 'failed', error: error.message });
      break;
    }
  }
  const rollback =
    failed.length > 0 ? rollbackDatabases(databases.slice(committed.length)) : { rolledBack: [], rollbackFailed: [] };
  return { committed, failed, results, ...rollback };
}

module.exports = { coordinateClearAll };
