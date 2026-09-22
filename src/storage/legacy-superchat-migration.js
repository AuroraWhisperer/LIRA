'use strict';

const {
  now,
  cleanText,
  normalizeSuperChatPrice,
  normalizeGuardLevel,
  normalizePositiveInteger,
} = require('../shared/utils');

// ── 数据迁移 ──

function migrateLegacySuperChatsToDedicatedDatabase(songDb, superChatDb) {
  const legacyTable = songDb
    .prepare(
      `
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = 'super_chats'
  `,
    )
    .get();
  if (!legacyTable) return;

  const rows = songDb.prepare('SELECT * FROM super_chats ORDER BY id ASC').all();
  if (rows.length === 0) {
    dropLegacySuperChatTable(songDb, 0);
    return;
  }

  let migrated = 0;
  superChatDb.exec('BEGIN');
  try {
    for (const row of rows) {
      const fingerprint = legacySuperChatFingerprint(row);
      const existing = superChatDb
        .prepare(
          `
        SELECT id
        FROM super_chats
        WHERE (platform_id != '' AND platform_id = ?)
           OR (platform_id = '' AND ? != '' AND uid = ? AND message = ? AND created_at = ?)
        LIMIT 1
      `,
        )
        .get(
          cleanText(row.platform_id),
          fingerprint,
          cleanText(row.uid),
          cleanText(row.message),
          cleanText(row.created_at),
        );
      if (existing) continue;

      superChatDb
        .prepare(
          `
        INSERT INTO super_chats (
          platform_id, uid, user_name, price, message,
          requester_guard_level, requester_medal_name, requester_medal_level,
          status, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          cleanText(row.platform_id),
          cleanText(row.uid),
          cleanText(row.user_name) || '观众',
          normalizeSuperChatPrice(row.price),
          cleanText(row.message),
          normalizeGuardLevel(row.requester_guard_level),
          cleanText(row.requester_medal_name),
          normalizePositiveInteger(row.requester_medal_level),
          cleanText(row.status) || 'active',
          cleanText(row.source) || 'superchat',
          cleanText(row.created_at) || now(),
          cleanText(row.updated_at) || cleanText(row.created_at) || now(),
        );
      migrated += 1;
    }
    superChatDb.exec('COMMIT');
  } catch (error) {
    superChatDb.exec('ROLLBACK');
    throw error;
  }

  if (migrated > 0) {
    console.log(`[Startup] migrated ${migrated} legacy super chat record(s).`);
  }
  dropLegacySuperChatTable(songDb, migrated);
}

function dropLegacySuperChatTable(songDb, migrated) {
  try {
    songDb.exec('DROP TABLE IF EXISTS super_chats');
    if (migrated > 0) {
      console.log('[Startup] dropped legacy super_chats table from song database.');
    }
  } catch (error) {
    console.warn('[Startup] failed to drop legacy super_chats table:', error.message);
  }
}

function legacySuperChatFingerprint(row) {
  if (!row) return '';
  return [cleanText(row.uid), cleanText(row.message), cleanText(row.created_at)].join('|');
}

module.exports = {
  migrateLegacySuperChatsToDedicatedDatabase,
  dropLegacySuperChatTable,
  legacySuperChatFingerprint,
};
