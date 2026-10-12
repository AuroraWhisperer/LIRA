'use strict';

const { compactRosterObservation } = require('./fan-roster-observation-storage');

// The migration runner owns the transaction, including the original JSON removal.
function migrateFanRosterObservations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS fan_roster_templates (
    id TEXT PRIMARY KEY, scope TEXT NOT NULL, data TEXT NOT NULL, original TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_fan_roster_templates_scope ON fan_roster_templates(scope)`);
  if (!db.prepare('PRAGMA table_info(fan_records)').all().some((column) => column.name === 'roster_template_id')) {
    db.exec('ALTER TABLE fan_records ADD COLUMN roster_template_id TEXT REFERENCES fan_roster_templates(id)');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_fan_records_roster_template ON fan_records(roster_template_id)');
  for (const row of db.prepare("SELECT * FROM fan_records WHERE kind = 'membership' AND roster_template_id IS NULL").all()) {
    compactRosterObservation(db, row.scope, {
      id: row.id, kind: row.kind, sourceKey: row.source_key, occurredAt: row.occurred_at,
      data: JSON.parse(row.data), original: JSON.parse(row.original),
      revisions: JSON.parse(row.revisions), revision: row.revision,
    });
  }
}

module.exports = { migrateFanRosterObservations };
