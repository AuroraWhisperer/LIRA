'use strict';

const { normalizeGiftSummaryPage } = require('../shared/gift-summary-contract');
const { normalizeProcessedGiftHistoryPage } = require('../shared/processed-gift-contract');
const { archiveWishContributions } = require('./gift-wish-retention');

function transaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = operation(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
function mismatch() { return Object.assign(new Error('GIFT_RETENTION_SNAPSHOT_MISMATCH'), { code: 'REBUILD_REQUIRED' }); }
function activeSnapshot(db, sourceId) {
  return db.prepare(`SELECT s.* FROM gift_retention_state r JOIN gift_retention_snapshots s
    ON s.id=r.active_snapshot_id WHERE r.source_id=?`).get(sourceId) || null;
}
function createGiftRetentionStore({ giftDb: db, importHistoryRecord, importLiveEvent, now = () => new Date().toISOString() }) {
  function fence(sourceId, generation) {
    const state = db.prepare('SELECT * FROM gift_sync_state WHERE source_id=?').get(sourceId);
    if (!state || state.projection_generation !== generation) throw new Error('STALE_GIFT_PROJECTION');
    return state;
  }
  function progress(sourceId) {
    const staging = db.prepare(`SELECT s.* FROM gift_retention_state r JOIN gift_retention_snapshots s
      ON s.id=r.staging_snapshot_id WHERE r.source_id=?`).get(sourceId) || null;
    return { active: activeSnapshot(db, sourceId), staging };
  }
  function restart({ sourceId, projectionGeneration }) {
    return transaction(db, () => {
      fence(sourceId, projectionGeneration);
      db.prepare('UPDATE gift_retention_state SET staging_snapshot_id=NULL WHERE source_id=?').run(sourceId);
      return progress(sourceId);
    });
  }
  function summaryPage({ sourceId, projectionGeneration, page: supplied, pageToken = null, full = false }) {
    const page = normalizeGiftSummaryPage(supplied);
    return transaction(db, () => {
      fence(sourceId, projectionGeneration);
      let { active, staging } = progress(sourceId);
      if (!staging) {
        if (pageToken !== null || page.baseRevision !== (full ? 0 : active?.revision ?? 0) ||
          (!full && active && active.sync_epoch !== page.syncEpoch)) throw mismatch();
        const result = db.prepare(`INSERT INTO gift_retention_snapshots
          (source_id,projection_generation,sync_epoch,revision,base_revision,summarized_before,covered_cursor,
            detail_start,phase,member_snapshot_id,updated_at) VALUES (?,?,?,?,?,?,?,?,'summaries',?,?)`)
          .run(sourceId, projectionGeneration, page.syncEpoch, page.revision, page.baseRevision,
            page.summarizedBefore, page.coveredThroughCursor, page.detailStart, full ? null : active?.member_snapshot_id ?? null, now());
        const id = Number(result.lastInsertRowid);
        if (full || !active) db.prepare('UPDATE gift_retention_snapshots SET member_snapshot_id=? WHERE id=?').run(id, id);
        db.prepare(`INSERT INTO gift_retention_state(source_id,staging_snapshot_id) VALUES (?,?)
          ON CONFLICT(source_id) DO UPDATE SET staging_snapshot_id=excluded.staging_snapshot_id`).run(sourceId, id);
        staging = progress(sourceId).staging;
      }
      if (staging.phase !== 'summaries' || staging.projection_generation !== projectionGeneration ||
        staging.summary_page_token !== pageToken || staging.sync_epoch !== page.syncEpoch ||
        staging.revision !== page.revision || staging.base_revision !== page.baseRevision ||
        staging.covered_cursor !== page.coveredThroughCursor || staging.summarized_before !== page.summarizedBefore ||
        staging.detail_start !== page.detailStart) throw mismatch();
      let lastKey = staging.last_summary_key;
      for (const row of page.rows) {
        const key = `${row.dayStart}:${row.groupKey}`;
        if (lastKey !== null && key <= lastKey) throw mismatch();
        const values = [sourceId, page.syncEpoch, row.dayStart, page.revision, row.groupKey];
        const dimensions = JSON.stringify(row.dimensions), metrics = JSON.stringify(row.metrics);
        const existing = db.prepare(`SELECT dimensions_json,metrics_json FROM gift_retention_days
          WHERE source_id=? AND sync_epoch=? AND day_start=? AND revision=? AND group_key=?`).get(...values);
        if (existing && (existing.dimensions_json !== dimensions || existing.metrics_json !== metrics)) throw mismatch();
        db.prepare('INSERT OR IGNORE INTO gift_retention_days VALUES (?,?,?,?,?,?,?)').run(...values, dimensions, metrics);
        lastKey = key;
      }
      const phase = page.hasMore ? 'summaries' : staging.member_snapshot_id === staging.id ? 'history' : 'catchup';
      db.prepare(`UPDATE gift_retention_snapshots SET summary_page_token=?,history_page_token=?,phase=?,last_summary_key=?,updated_at=? WHERE id=?`)
        .run(page.nextPageToken, page.historyPageToken, phase, lastKey, now(), staging.id);
      return progress(sourceId);
    });
  }
  function importMember(record, sourceId, snapshotId) {
    const platformId = `lira-server:${record.eventId}`;
    const previous = db.prepare("SELECT id,detection_status FROM gift_events WHERE source_id=? AND platform_id=? AND cmd='LIRA_SERVER_GIFT'").get(sourceId, platformId);
    // A disconnected client may have accepted a progress group before its final
    // cursor expired. Stage its final until activation; the existing live importer
    // then finishes that group with its original eligibility and after-commit work.
    if (previous?.detection_status === 'progress') {
      db.prepare('INSERT INTO gift_retention_pending_finals VALUES (?,?,?)').run(snapshotId, previous.id, JSON.stringify(record));
      db.prepare('INSERT OR IGNORE INTO gift_retention_members VALUES (?,?)').run(snapshotId, previous.id);
      return;
    }
    const { finalCursor, ...history } = record;
    importHistoryRecord(history, sourceId);
    const row = db.prepare("SELECT id FROM gift_events WHERE source_id=? AND platform_id=? AND cmd='LIRA_SERVER_GIFT'").get(sourceId, platformId);
    if (!row) throw mismatch();
    if (!previous) {
      db.prepare("UPDATE gift_events SET status='retention-staged' WHERE id=?").run(row.id);
      db.prepare('DELETE FROM gift_retention_members WHERE event_id=?').run(row.id);
    }
    db.prepare('UPDATE gift_events SET remote_final_cursor=? WHERE id=?').run(finalCursor, row.id);
    db.prepare('INSERT OR IGNORE INTO gift_retention_members VALUES (?,?)').run(snapshotId, row.id);
  }
  function historyPage({ sourceId, projectionGeneration, page: supplied, pageToken }) {
    const page = normalizeProcessedGiftHistoryPage(supplied);
    if (page.giftRetentionVersion !== 1) throw mismatch();
    return transaction(db, () => {
      fence(sourceId, projectionGeneration);
      const { staging } = progress(sourceId);
      if (!staging || staging.phase !== 'history' || staging.history_page_token !== pageToken ||
        staging.sync_epoch !== page.syncEpoch || staging.revision !== page.summaryRevision ||
        staging.detail_start !== page.detailStart || page.recoveryCursor < staging.covered_cursor ||
        (staging.recovery_cursor !== null && staging.recovery_cursor !== page.recoveryCursor)) throw mismatch();
      for (const record of page.events) importMember(record, sourceId, staging.member_snapshot_id);
      db.prepare(`UPDATE gift_retention_snapshots SET history_page_token=?,recovery_cursor=?,phase=?,updated_at=? WHERE id=?`)
        .run(page.nextPageToken, page.recoveryCursor, page.hasMore ? 'history' : 'catchup', now(), staging.id);
      return progress(sourceId);
    });
  }
  function activate({ sourceId, projectionGeneration }) {
    const effects = [];
    const result = transaction(db, () => {
      const state = fence(sourceId, projectionGeneration);
      const { staging } = progress(sourceId);
      if (!staging || staging.phase !== 'catchup') throw mismatch();
      const full = staging.member_snapshot_id === staging.id;
      const cursor = full ? staging.recovery_cursor : state.final_cursor;
      if (!Number.isSafeInteger(cursor) || cursor < staging.covered_cursor || (!full && state.sync_epoch !== staging.sync_epoch)) throw mismatch();
      if (full) {
        if (!state.sync_epoch || state.sync_epoch === staging.sync_epoch) {
          archiveWishContributions(db, sourceId, { syncEpoch: staging.sync_epoch,
            memberSnapshotId: activeSnapshot(db, sourceId)?.member_snapshot_id,
            excludedMemberSnapshotId: staging.member_snapshot_id });
        }
        db.prepare('DELETE FROM gift_wish_contributions WHERE source_id=? AND sync_epoch<>?').run(sourceId, staging.sync_epoch);
      }
      for (const pending of db.prepare('SELECT * FROM gift_retention_pending_finals WHERE snapshot_id=?').all(staging.id)) {
        const { finalCursor, ...record } = JSON.parse(pending.record_json);
        importLiveEvent({ ...record, phase: 'final', cursor: finalCursor }, sourceId,
          { registerAfterCommit: (effect) => effects.push(effect) });
        db.prepare('UPDATE gift_events SET remote_final_cursor=? WHERE id=?').run(finalCursor, pending.event_id);
      }
      db.prepare('DELETE FROM gift_retention_pending_finals WHERE snapshot_id=?').run(staging.id);
      db.prepare(`UPDATE gift_retention_snapshots SET phase='active',recovery_cursor=?,updated_at=? WHERE id=?`).run(cursor, now(), staging.id);
      db.prepare(`UPDATE gift_retention_state SET active_snapshot_id=?,staging_snapshot_id=NULL WHERE source_id=?`).run(staging.id, sourceId);
      db.prepare(`UPDATE gift_sync_state SET sync_epoch=?,final_cursor=?,bootstrap_complete=1,
        bootstrap_page_token=NULL,bootstrap_recovery_cursor=NULL,bootstrap_sync_epoch=NULL,
        last_validated_at=?,projection_generation=projection_generation+1,updated_at=? WHERE source_id=?`)
        .run(staging.sync_epoch, cursor, now(), now(), sourceId);
      return progress(sourceId);
    });
    for (const effect of effects) effect();
    return result;
  }
  return { progress, restart, summaryPage, historyPage, activate };
}

module.exports = { createGiftRetentionStore, activeSnapshot, transaction };
