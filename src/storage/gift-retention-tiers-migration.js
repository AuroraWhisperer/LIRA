'use strict';

const { resetGiftProjectionMetadataInTransaction } = require('./gift-projection-reset');

function migrateGiftRetentionTiers(db) {
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='gift_local_detail_coverage'").get()) return;
  db.exec(`CREATE TABLE gift_local_detail_coverage (
      source_id INTEGER NOT NULL REFERENCES gift_sources(id) ON DELETE CASCADE,
      sync_epoch TEXT NOT NULL, start_at TEXT NOT NULL, end_at TEXT NOT NULL,
      PRIMARY KEY(source_id,sync_epoch,start_at));
    CREATE TABLE gift_retention_work (
      source_id INTEGER PRIMARY KEY REFERENCES gift_sources(id) ON DELETE CASCADE,
      sync_epoch TEXT NOT NULL, generation INTEGER NOT NULL, revision INTEGER NOT NULL,
      cutoff TEXT NOT NULL, upper_id INTEGER NOT NULL, after_id INTEGER NOT NULL DEFAULT 0,
      phase TEXT NOT NULL DEFAULT 'events', skipped INTEGER NOT NULL DEFAULT 0,
      archive_timezone TEXT NOT NULL);
    CREATE INDEX idx_gift_retention_scan ON gift_events(source_id,id);
    CREATE INDEX idx_gift_retention_staged_scan ON gift_events(source_id,id) WHERE status='retention-staged';
    CREATE INDEX idx_gift_retention_days_scan ON gift_retention_days(source_id);
    ALTER TABLE gift_retention_state ADD COLUMN cleanup_event_id INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE gift_retention_state ADD COLUMN cleanup_day_rowid INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE gift_retention_state ADD COLUMN cleanup_event_upper_id INTEGER;
    ALTER TABLE gift_retention_state ADD COLUMN cleanup_day_upper_rowid INTEGER;
    ALTER TABLE gift_local_archives ADD COLUMN archive_timezone TEXT;
    CREATE TABLE gift_wish_boundary_totals (
      wish_id TEXT NOT NULL REFERENCES gift_wishes(id) ON DELETE CASCADE,
      source_id INTEGER NOT NULL REFERENCES gift_sources(id) ON DELETE CASCADE,
      sync_epoch TEXT NOT NULL, boundary_start TEXT NOT NULL, boundary_end TEXT NOT NULL,
      num INTEGER NOT NULL,
      PRIMARY KEY(wish_id,source_id,sync_epoch,boundary_start,boundary_end));`);
  // The pre-release baseline is explicitly disposable. Never repeat this reset
  // during ordinary startup or a same-epoch synchronization rebuild.
  const timestamp = new Date().toISOString();
  for (const { source_id: sourceId } of db.prepare('SELECT source_id FROM gift_sync_state').all()) {
    db.prepare(`DELETE FROM overtime_settlements WHERE gift_event_id IN
      (SELECT id FROM gift_events WHERE source_id=? AND cmd='LIRA_SERVER_GIFT')`).run(sourceId);
    db.prepare("DELETE FROM gift_events WHERE source_id=? AND cmd='LIRA_SERVER_GIFT'").run(sourceId);
    resetGiftProjectionMetadataInTransaction(db, sourceId, timestamp);
  }
}

module.exports = { migrateGiftRetentionTiers };
