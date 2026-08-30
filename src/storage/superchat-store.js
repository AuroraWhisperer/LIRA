'use strict';

const {
  cleanText,
  normalizeGuardLevel,
  normalizePositiveInteger,
  normalizeSuperChatPrice,
} = require('../shared/utils');

function createSuperChatStore(superChatDb) {
  return {
    findByPlatformId(platformId) {
      return normalizeSuperChatRow(
        superChatDb
          .prepare(
            `
        SELECT * FROM super_chats WHERE platform_id = ? LIMIT 1
      `,
          )
          .get(platformId),
      );
    },

    insert(input) {
      const result = superChatDb
        .prepare(
          `
        INSERT INTO super_chats (
          platform_id, uid, user_name, price, message,
          requester_guard_level, requester_medal_name, requester_medal_level,
          status, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 'superchat', ?, ?)
      `,
        )
        .run(
          input.platformId,
          input.uid,
          input.userName,
          input.price,
          input.message,
          input.requesterGuardLevel,
          input.requesterMedalName,
          input.requesterMedalLevel,
          input.createdAt,
          input.createdAt,
        );
      return normalizeSuperChatRow(
        superChatDb
          .prepare('SELECT * FROM super_chats WHERE id = ?')
          .get(Number(result.lastInsertRowid)),
      );
    },

    setStatus(id, status, updatedAt) {
      superChatDb
        .prepare(
          'UPDATE super_chats SET status = ?, updated_at = ? WHERE id = ?',
        )
        .run(status, updatedAt, id);
    },

    listActive() {
      return superChatDb
        .prepare(
          `
        SELECT * FROM super_chats
        WHERE status IN ('active', 'assisted')
        ORDER BY price DESC, datetime(created_at) ASC, id ASC
      `,
        )
        .all()
        .map(normalizeSuperChatRow);
    },
  };
}

function normalizeSuperChatRow(row) {
  if (!row) return null;
  return {
    ...row,
    price: normalizeSuperChatPrice(row.price),
    requester_guard_level: normalizeGuardLevel(row.requester_guard_level),
    requester_medal_name: cleanText(row.requester_medal_name),
    requester_medal_level: normalizePositiveInteger(row.requester_medal_level),
  };
}

module.exports = { createSuperChatStore };
