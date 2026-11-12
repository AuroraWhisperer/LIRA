'use strict';

function createHeartBoxCollectionStore(db) {
  const read = db.prepare(`SELECT adjustment FROM heart_box_collection_adjustments
    WHERE source_id = ? AND starts_at = ?`);
  const save = db.prepare(`INSERT INTO heart_box_collection_adjustments (source_id, starts_at, adjustment)
    VALUES (?, ?, ?) ON CONFLICT(source_id) DO UPDATE SET
      starts_at = excluded.starts_at, adjustment = excluded.adjustment`);
  return {
    getAdjustment: (sourceId, startsAt) => read.get(sourceId, startsAt)?.adjustment || 0,
    saveAdjustment(sourceId, startsAt, adjustment) {
      save.run(sourceId, startsAt, adjustment);
    },
  };
}

module.exports = { createHeartBoxCollectionStore };
