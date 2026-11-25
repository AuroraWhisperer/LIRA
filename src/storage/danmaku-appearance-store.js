'use strict';

function migrateDanmakuAppearance(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS danmaku_appearances (
    owner_scope TEXT PRIMARY KEY,
    config_json TEXT NOT NULL CHECK (json_valid(config_json) AND length(CAST(config_json AS BLOB)) <= 262144)
  )`);
}

function createDanmakuAppearanceStore(db) {
  const read = db.prepare(`SELECT body_token, CASE WHEN body_token = ? THEN NULL ELSE config_json END AS config_json
    FROM danmaku_appearances WHERE owner_scope = ?`);
  let cached;
  return {
    get(scope) {
      const token = cached && cached.scope === scope ? cached.token : null;
      const row = read.get(token, scope);
      if (!row) { cached = null; return null; }
      if (row.body_token === token) return structuredClone(cached.config);
      const config = JSON.parse(row.config_json);
      if (!db.isTransaction) cached = { scope, token: row.body_token, config };
      return structuredClone(config);
    },
    set(scope, config) {
      db.prepare(`INSERT INTO danmaku_appearances (owner_scope, config_json) VALUES (?, ?)
        ON CONFLICT(owner_scope) DO UPDATE SET config_json = excluded.config_json`).run(scope, JSON.stringify(config));
    },
  };
}

module.exports = { createDanmakuAppearanceStore, migrateDanmakuAppearance };
