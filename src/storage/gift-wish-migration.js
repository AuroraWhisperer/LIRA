'use strict';

function migrateGiftWishes(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gift_wishes (
      id TEXT PRIMARY KEY,
      source_id INTEGER NOT NULL REFERENCES gift_sources(id),
      period TEXT NOT NULL CHECK (period IN ('long', 'day', 'session')),
      gift_id TEXT NOT NULL,
      variant_id TEXT,
      gift_name TEXT NOT NULL,
      gift_category TEXT NOT NULL,
      image_path TEXT NOT NULL DEFAULT '',
      target INTEGER NOT NULL CHECK (target BETWEEN 1 AND 999999999),
      label TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gift_wishes_source ON gift_wishes(source_id, created_at);
    CREATE TABLE IF NOT EXISTS gift_wish_sessions (
      source_id INTEGER PRIMARY KEY REFERENCES gift_sources(id),
      room_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      checked_at TEXT NOT NULL
    );
  `);
}

function migrateGiftWishDisplay(db) {
  const columns = new Set(
    db
      .prepare('PRAGMA table_info(gift_wishes)')
      .all()
      .map((row) => row.name),
  );
  if (!columns.has('display_style')) {
    db.exec("ALTER TABLE gift_wishes ADD COLUMN display_style TEXT NOT NULL DEFAULT 'card'");
  }
  if (!columns.has('text_template')) {
    db.exec("ALTER TABLE gift_wishes ADD COLUMN text_template TEXT NOT NULL DEFAULT ''");
  }
}

module.exports = { migrateGiftWishes, migrateGiftWishDisplay };
