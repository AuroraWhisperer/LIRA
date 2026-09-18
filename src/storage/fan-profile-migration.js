'use strict';

function migrateFanProfiles(db) {
  db.exec(`
    CREATE TABLE fan_profiles (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, identity_key TEXT,
      data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      UNIQUE(scope, identity_key)
    );
    CREATE INDEX idx_fan_profiles_scope ON fan_profiles(scope);
    CREATE TABLE fan_records (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, profile_id TEXT NOT NULL,
      kind TEXT NOT NULL, source_key TEXT, occurred_at TEXT NOT NULL,
      data TEXT NOT NULL, original TEXT NOT NULL, revisions TEXT NOT NULL DEFAULT '[]',
      revision INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY(profile_id) REFERENCES fan_profiles(id) ON DELETE CASCADE,
      UNIQUE(scope, source_key)
    );
    CREATE INDEX idx_fan_records_profile ON fan_records(scope, profile_id, occurred_at);
    CREATE TABLE fan_reminder_states (
      scope TEXT NOT NULL, profile_id TEXT NOT NULL, item_key TEXT NOT NULL,
      data TEXT NOT NULL, PRIMARY KEY(scope, profile_id, item_key),
      FOREIGN KEY(profile_id) REFERENCES fan_profiles(id) ON DELETE CASCADE
    );
    CREATE TABLE fan_scopes (scope TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE fan_suppressions (
      scope TEXT NOT NULL, identity_key TEXT NOT NULL, PRIMARY KEY(scope, identity_key)
    );
    CREATE TABLE fan_restore_snapshots (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL
    );
    ALTER TABLE requests ADD COLUMN stable_id TEXT;
    ALTER TABLE requests ADD COLUMN owner_scope TEXT;
    ALTER TABLE requests ADD COLUMN identity_type TEXT;
    CREATE UNIQUE INDEX idx_requests_stable_id ON requests(stable_id);
  `);
}

module.exports = { migrateFanProfiles };
