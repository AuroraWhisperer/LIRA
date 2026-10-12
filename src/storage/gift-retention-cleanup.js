'use strict';

const { activeSnapshot, transaction } = require('./gift-retention-store');

function cleanupGiftRetentionBatch(db, sourceId, limit = 500) {
  return transaction(db, () => {
    const state = db.prepare('SELECT * FROM gift_retention_state WHERE source_id=?').get(sourceId);
    // A paused download owns its checkpoints until it is resumed or abandoned.
    if (!state || state.staging_snapshot_id !== null) return 0;
    const active = activeSnapshot(db, sourceId);
    let remaining = limit;
    const unused = db.prepare(`SELECT id FROM gift_retention_snapshots WHERE source_id=? AND id<>? AND id<>? ORDER BY id LIMIT 1`)
      .get(sourceId,active?.id || 0,active?.member_snapshot_id || 0);
    if (unused) {
      for (const table of ['gift_retention_members', 'gift_retention_pending_finals']) {
        const rows = db.prepare(`SELECT event_id FROM ${table} WHERE snapshot_id=? LIMIT ?`).all(unused.id,remaining);
        for (const row of rows) db.prepare(`DELETE FROM ${table} WHERE snapshot_id=? AND event_id=?`).run(unused.id,row.event_id);
        remaining -= rows.length;
        if (!remaining) break;
      }
      if (remaining) { db.prepare('DELETE FROM gift_retention_snapshots WHERE id=?').run(unused.id); remaining--; }
    }
    if (remaining) {
      const unusedRows = db.prepare(`SELECT id FROM gift_events g WHERE source_id=? AND status='retention-staged'
        AND NOT EXISTS (SELECT 1 FROM gift_retention_members m WHERE m.event_id=g.id)
        AND NOT EXISTS (SELECT 1 FROM overtime_settlements o WHERE o.gift_event_id=g.id AND o.status='pending') LIMIT ?`).all(sourceId,remaining);
      for (const row of unusedRows) db.prepare('DELETE FROM gift_events WHERE id=?').run(row.id);
      remaining -= unusedRows.length;
    }
    if (remaining && active) {
      const old = db.prepare(`SELECT s.rowid AS row_id FROM gift_retention_days s WHERE s.source_id=? AND
        (s.sync_epoch<>? OR s.revision>? OR s.revision<(SELECT MAX(d.revision) FROM gift_retention_days d
          WHERE d.source_id=s.source_id AND d.sync_epoch=s.sync_epoch AND d.day_start=s.day_start AND d.revision<=?)) LIMIT ?`)
        .all(sourceId,active.sync_epoch,active.revision,active.revision,remaining);
      for (const row of old) db.prepare('DELETE FROM gift_retention_days WHERE rowid=?').run(row.row_id);
      remaining -= old.length;
    }
    return limit-remaining;
  });
}

module.exports = { cleanupGiftRetentionBatch };
