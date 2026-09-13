'use strict';

function migrateGiftIdentities(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(gift_events)').all().map(column => column.name));
  for (const column of ['gift_variant_id', 'blind_box_variant_id']) {
    if (!columns.has(column)) db.exec(`ALTER TABLE gift_events ADD COLUMN ${column} TEXT`);
  }
  if (db.prepare('PRAGMA table_info(overtime_gift_rules)').all()
    .some(column => column.name === 'gift_identity_key')) return;
  db.exec(`
    ALTER TABLE overtime_gift_rules RENAME TO overtime_gift_rules_v9;
    CREATE TABLE overtime_gift_rules (
      gift_id TEXT NOT NULL,
      gift_identity_key TEXT NOT NULL DEFAULT '',
      gift_identity_json TEXT,
      gift_name TEXT NOT NULL DEFAULT '',
      image_path TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL CHECK (mode IN ('fixed', 'random', 'display')),
      fixed_seconds INTEGER,
      outcomes_json TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (gift_id, gift_identity_key)
    );
    INSERT INTO overtime_gift_rules (
      gift_id, gift_name, image_path, mode, fixed_seconds,
      outcomes_json, enabled, sort_order, updated_at
    ) SELECT gift_id, gift_name, image_path, mode, fixed_seconds,
      outcomes_json, enabled, sort_order, updated_at FROM overtime_gift_rules_v9;
    DROP TABLE overtime_gift_rules_v9;
    CREATE INDEX idx_overtime_gift_rules_order
      ON overtime_gift_rules(enabled DESC, sort_order, gift_id);
  `);
}

module.exports = { migrateGiftIdentities };
