'use strict';
const { CLEAR_ALL_MATRIX } = require('./database-clear-operations');

function createDeletedCounts() {
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
  return counts;
}

function preCommitFailure({
  errors,
  rolledBack,
  rollbackFailed,
  counts,
  giftProjectionReset,
}) {
  const error = new Error(
    `Clear-all pre-commit failed: ${errors.map((e) => `${e.db} ${e.phase}`).join(', ')}`,
  );
  error.details = errors;
  if (rollbackFailed.length === 0) throw error;
  return {
    ok: false,
    cleared: false,
    partial: true,
    phase: 'pre-commit',
    committed: [],
    failed: errors.map((entry) => entry.db),
    rolledBack,
    rollbackFailed,
    error: error.message,
    deletedCounts: counts,
    giftProjectionReset,
    results: errors.map((entry) => ({ ...entry, status: 'failed' })),
  };
}

function committedResult({
  committed,
  failed,
  rolledBack,
  rollbackFailed,
  results,
  counts,
  giftProjectionReset,
}) {
  if (failed.length > 0) {
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
      results,
    };
  }
  return {
    cleared: true,
    scope: 'all',
    committed,
    preserved: CLEAR_ALL_MATRIX.preserve,
    deletedCounts: counts,
    totalDeleted: Object.values(counts).reduce((a, b) => a + b, 0),
    giftProjectionReset,
    recreated: ['song_categories', 'overtime_machine_state'],
  };
}

module.exports = { createDeletedCounts, preCommitFailure, committedResult };
