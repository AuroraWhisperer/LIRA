'use strict';

function migrateGiftRetention(db) {
  if (!db.prepare('PRAGMA table_info(gift_events)').all().some((column) => column.name === 'remote_final_cursor')) {
    db.exec('ALTER TABLE gift_events ADD COLUMN remote_final_cursor INTEGER');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS gift_retention_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL REFERENCES gift_sources(id) ON DELETE CASCADE,
      projection_generation INTEGER NOT NULL,
      sync_epoch TEXT NOT NULL,
      revision INTEGER NOT NULL,
      base_revision INTEGER NOT NULL,
      summarized_before TEXT,
      covered_cursor INTEGER NOT NULL,
      detail_start TEXT,
      recovery_cursor INTEGER,
      member_snapshot_id INTEGER,
      phase TEXT NOT NULL,
      summary_page_token TEXT,
      history_page_token TEXT,
      last_summary_key TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gift_retention_state (
      source_id INTEGER PRIMARY KEY REFERENCES gift_sources(id) ON DELETE CASCADE,
      active_snapshot_id INTEGER,
      staging_snapshot_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS gift_retention_members (
      snapshot_id INTEGER NOT NULL REFERENCES gift_retention_snapshots(id) ON DELETE CASCADE,
      event_id INTEGER NOT NULL REFERENCES gift_events(id) ON DELETE CASCADE,
      PRIMARY KEY(snapshot_id,event_id)
    );
    CREATE INDEX IF NOT EXISTS idx_gift_retention_members_event ON gift_retention_members(event_id);
    CREATE TABLE IF NOT EXISTS gift_retention_pending_finals (
      snapshot_id INTEGER NOT NULL REFERENCES gift_retention_snapshots(id) ON DELETE CASCADE,
      event_id INTEGER NOT NULL REFERENCES gift_events(id) ON DELETE CASCADE,
      record_json TEXT NOT NULL,
      PRIMARY KEY(snapshot_id,event_id)
    );
    CREATE TABLE IF NOT EXISTS gift_retention_days (
      source_id INTEGER NOT NULL REFERENCES gift_sources(id) ON DELETE CASCADE,
      sync_epoch TEXT NOT NULL, day_start TEXT NOT NULL, revision INTEGER NOT NULL,
      group_key TEXT NOT NULL, dimensions_json TEXT NOT NULL, metrics_json TEXT NOT NULL,
      PRIMARY KEY(source_id,sync_epoch,day_start,revision,group_key)
    );
    CREATE TABLE IF NOT EXISTS gift_retention_receipts (
      source_id INTEGER NOT NULL REFERENCES gift_sources(id) ON DELETE CASCADE,
      platform_id TEXT NOT NULL,
      PRIMARY KEY(source_id,platform_id)
    );
    CREATE TABLE IF NOT EXISTS gift_local_archives (
      source_id INTEGER NOT NULL REFERENCES gift_sources(id) ON DELETE CASCADE,
      day_start TEXT NOT NULL, group_key TEXT NOT NULL, dimensions_json TEXT NOT NULL,
      event_count INTEGER NOT NULL, item_count INTEGER NOT NULL, value_cents INTEGER NOT NULL,
      cost_cents INTEGER, last_opened_at TEXT NOT NULL,
      PRIMARY KEY(source_id,day_start,group_key)
    );
    CREATE TABLE IF NOT EXISTS gift_sprint_carry (
      source_id INTEGER PRIMARY KEY REFERENCES gift_sources(id) ON DELETE CASCADE,
      value_cents INTEGER NOT NULL DEFAULT 0, event_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TRIGGER IF NOT EXISTS gift_retention_live_member AFTER INSERT ON gift_events
      WHEN NEW.source_id IS NOT NULL AND NEW.cmd='LIRA_SERVER_GIFT'
    BEGIN
      INSERT INTO gift_retention_members(snapshot_id,event_id)
        SELECT s.member_snapshot_id,NEW.id FROM gift_retention_state r
          JOIN gift_retention_snapshots s ON s.id=r.active_snapshot_id
        WHERE r.source_id=NEW.source_id AND s.member_snapshot_id IS NOT NULL;
    END;
  `);
}

module.exports = { migrateGiftRetention };
