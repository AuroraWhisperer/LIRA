'use strict';

function migrateScenes(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS component_scenes (
      id TEXT PRIMARY KEY,
      owner_scope TEXT NOT NULL,
      draft_json TEXT NOT NULL CHECK (json_valid(draft_json) AND length(CAST(draft_json AS BLOB)) <= 262144),
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
      published_json TEXT CHECK (published_json IS NULL OR
        (json_valid(published_json) AND length(CAST(published_json AS BLOB)) <= 262144)),
      published_version INTEGER NOT NULL DEFAULT 0 CHECK (published_version BETWEEN 0 AND 9007199254740991),
      capability_version INTEGER NOT NULL CHECK (capability_version BETWEEN 1 AND 9007199254740991),
      capability_hash TEXT NOT NULL CHECK (length(capability_hash) = 64),
      capability_encrypted TEXT NOT NULL CHECK (length(capability_encrypted) > 0),
      CHECK ((published_version = 0 AND published_json IS NULL)
        OR (published_version > 0 AND published_json IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS idx_component_scenes_owner ON component_scenes(owner_scope);
  `);
}

module.exports = { migrateScenes };
