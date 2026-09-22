'use strict';

function migrateGiftDisplay(db) {
  const columns = new Set(
    db
      .prepare('PRAGMA table_info(gift_events)')
      .all()
      .map((row) => row.name),
  );
  if (!columns.has('avatar_url')) db.exec('ALTER TABLE gift_events ADD COLUMN avatar_url TEXT');
  if (!columns.has('guard_level'))
    db.exec('ALTER TABLE gift_events ADD COLUMN guard_level INTEGER CHECK (guard_level BETWEEN 0 AND 3)');
}

module.exports = { migrateGiftDisplay };
