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

function migrateComponentOutputSizes(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS component_output_sizes (
      owner_scope TEXT NOT NULL,
      component_type TEXT NOT NULL CHECK (component_type IN ('clock', 'queue', 'overtime', 'danmaku')),
      width REAL NOT NULL CHECK (width BETWEEN 32 AND 7680),
      height REAL NOT NULL CHECK (height BETWEEN 32 AND 7680),
      PRIMARY KEY (owner_scope, component_type)
    );
  `);
}

function migrateCanvasPresets(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS component_canvas (
      owner_scope TEXT PRIMARY KEY,
      output_scene_id TEXT NOT NULL REFERENCES component_scenes(id),
      active_scene_id TEXT NOT NULL REFERENCES component_scenes(id)
    );
    INSERT INTO component_canvas (owner_scope, output_scene_id, active_scene_id)
      SELECT owner_scope, MIN(id), MIN(id) FROM component_scenes GROUP BY owner_scope
      ON CONFLICT (owner_scope) DO NOTHING;
  `);
}

module.exports = { migrateScenes, migrateComponentOutputSizes, migrateCanvasPresets };
