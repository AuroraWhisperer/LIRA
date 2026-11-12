'use strict';

function migrateHeartBoxCollectionAdjustments(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS heart_box_collection_adjustments (
    source_id INTEGER PRIMARY KEY REFERENCES gift_sources(id) ON DELETE CASCADE,
    starts_at TEXT NOT NULL,
    adjustment INTEGER NOT NULL
  );`);
}

module.exports = { migrateHeartBoxCollectionAdjustments };
