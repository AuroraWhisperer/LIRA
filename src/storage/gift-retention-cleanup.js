'use strict';

const { activeSnapshot, transaction } = require('./gift-retention-store');

function cleanupGiftRetentionBatch(db, sourceId, limit = 100) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new RangeError('Invalid gift cleanup batch');
  return transaction(db, () => {
    const state = db.prepare('SELECT * FROM gift_retention_state WHERE source_id=?').get(sourceId);
    // A paused download owns its checkpoints until it is resumed or abandoned.
    if (!state || state.staging_snapshot_id !== null) return 0;
    const active = activeSnapshot(db, sourceId);
    let remaining = limit;
    const unused = db.prepare(`SELECT * FROM gift_retention_snapshots WHERE source_id=? AND id<>? AND id<>? ORDER BY id LIMIT 1`)
      .get(sourceId,active?.id || 0,active?.member_snapshot_id || 0);
    if (unused) {
      for (const table of ['gift_retention_members', 'gift_retention_pending_finals']) {
        const rows = db.prepare(`SELECT event_id FROM ${table} WHERE snapshot_id=? LIMIT ?`).all(unused.id,remaining);
        for (const row of rows) {
          // Move the proof before retiring its snapshot. The row itself stays
          // in the one ledger, and EXISTS readers never duplicate it.
          if (table === 'gift_retention_members' && unused.phase === 'active' && unused.sync_epoch === active?.sync_epoch) {
            db.prepare('INSERT OR IGNORE INTO gift_retention_members VALUES (?,?)').run(active.member_snapshot_id,row.event_id);
          }
          db.prepare(`DELETE FROM ${table} WHERE snapshot_id=? AND event_id=?`).run(unused.id,row.event_id);
        }
        remaining -= rows.length;
        if (!remaining) break;
      }
      if (remaining) { db.prepare('DELETE FROM gift_retention_snapshots WHERE id=?').run(unused.id); remaining--; }
    }
    if (remaining) {
      const upperId = state.cleanup_event_upper_id ?? db.prepare('SELECT COALESCE(MAX(id),0) id FROM gift_events WHERE source_id=?').get(sourceId).id;
      const candidates = db.prepare(`SELECT g.id,
        EXISTS (SELECT 1 FROM gift_retention_members m WHERE m.event_id=g.id) AS member,
        EXISTS (SELECT 1 FROM overtime_settlements o WHERE o.gift_event_id=g.id AND o.status='pending') AS pending
        FROM gift_events g INDEXED BY idx_gift_retention_staged_scan
        WHERE source_id=? AND status='retention-staged' AND id>? AND id<=? ORDER BY id LIMIT ?`)
        .all(sourceId,state.cleanup_event_id,upperId,remaining);
      const remove = db.prepare('DELETE FROM gift_events WHERE id=?');
      for (const row of candidates) if (!row.member && !row.pending) remove.run(row.id);
      db.prepare('UPDATE gift_retention_state SET cleanup_event_id=?,cleanup_event_upper_id=? WHERE source_id=?')
        .run(candidates.at(-1)?.id || upperId,upperId,sourceId);
      remaining -= candidates.length;
    }
    if (remaining && active) {
      const upperId = state.cleanup_day_upper_rowid ?? db.prepare(`SELECT COALESCE(MAX(rowid),0) id
        FROM gift_retention_days INDEXED BY idx_gift_retention_days_scan WHERE source_id=?`).get(sourceId).id;
      const candidates = db.prepare(`SELECT s.rowid AS row_id,
        (s.sync_epoch<>? OR s.revision>? OR s.revision<(SELECT MAX(d.revision) FROM gift_retention_days d
          WHERE d.source_id=s.source_id AND d.sync_epoch=s.sync_epoch AND d.day_start=s.day_start AND d.revision<=?)) AS obsolete
        FROM gift_retention_days s INDEXED BY idx_gift_retention_days_scan
        WHERE s.source_id=? AND s.rowid>? AND s.rowid<=? ORDER BY s.rowid LIMIT ?`)
        .all(active.sync_epoch,active.revision,active.revision,sourceId,state.cleanup_day_rowid,upperId,remaining);
      const remove = db.prepare('DELETE FROM gift_retention_days WHERE rowid=?');
      for (const row of candidates) if (row.obsolete) remove.run(row.row_id);
      db.prepare('UPDATE gift_retention_state SET cleanup_day_rowid=?,cleanup_day_upper_rowid=? WHERE source_id=?')
        .run(candidates.at(-1)?.row_id || upperId,upperId,sourceId);
      remaining -= candidates.length;
    }
    if (remaining === limit) db.prepare("UPDATE gift_retention_work SET phase=CASE WHEN skipped>0 THEN 'waiting' ELSE 'done' END WHERE source_id=?")
      .run(sourceId);
    return limit-remaining;
  });
}

module.exports = { cleanupGiftRetentionBatch };
