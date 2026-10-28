'use strict';

function migrateDanmakuAppearance(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS danmaku_appearances (
    owner_scope TEXT PRIMARY KEY,
    config_json TEXT NOT NULL CHECK (json_valid(config_json) AND length(CAST(config_json AS BLOB)) <= 262144)
  )`);
}

function createDanmakuAppearanceStore(db) {
  return {
    get(scope) {
      const row = db.prepare('SELECT config_json FROM danmaku_appearances WHERE owner_scope = ?').get(scope);
      return row ? JSON.parse(row.config_json) : null;
    },
    set(scope, config) {
      db.prepare(`INSERT INTO danmaku_appearances (owner_scope, config_json) VALUES (?, ?)
        ON CONFLICT(owner_scope) DO UPDATE SET config_json = excluded.config_json`).run(scope, JSON.stringify(config));
    },
  };
}

module.exports = { createDanmakuAppearanceStore, migrateDanmakuAppearance };
