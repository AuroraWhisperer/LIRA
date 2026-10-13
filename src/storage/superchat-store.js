'use strict';

const {
  cleanText,
  normalizePositiveInteger,
} = require('../shared/utils');
const { normalizeGuardLevel, normalizeSuperChatPrice } = require('../shared/bilibili-value-contract');

function createSuperChatStore(superChatDb) {
  return {
    findById(id) {
      return normalizeSuperChatRow(superChatDb.prepare('SELECT * FROM super_chats WHERE id = ?').get(id));
    },

    restoreDeleted(rows) {
      superChatDb.exec('SAVEPOINT restore_super_chats');
      try {
        const insert = superChatDb.prepare(`INSERT INTO super_chats
          (id, platform_id, uid, user_name, price, message, requester_guard_level,
           requester_medal_name, requester_medal_level, status, source, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        const removeReceipt = superChatDb.prepare('DELETE FROM super_chat_receipts WHERE platform_id = ?');
        for (const row of rows) {
          insert.run(row.id, row.platform_id, row.uid, row.user_name, row.price, row.message,
            row.requester_guard_level, row.requester_medal_name, row.requester_medal_level,
            row.status, row.source, row.created_at, row.updated_at);
          removeReceipt.run(row.platform_id);
        }
        superChatDb.exec('RELEASE restore_super_chats');
      } catch (error) {
        superChatDb.exec('ROLLBACK TO restore_super_chats');
        superChatDb.exec('RELEASE restore_super_chats');
        throw error;
      }
    },

    findByPlatformId(platformId) {
      if (superChatDb.prepare('SELECT 1 FROM super_chat_receipts WHERE platform_id = ?').get(platformId)) {
        return { platform_id: platformId, status: 'deleted' };
      }
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
        superChatDb.prepare('SELECT * FROM super_chats WHERE id = ?').get(Number(result.lastInsertRowid)),
      );
    },

    setStatus(id, status, updatedAt) {
      if (status === 'deleted') {
        superChatDb.prepare('DELETE FROM super_chats WHERE id = ?').run(id);
        return;
      }
      superChatDb.prepare("UPDATE super_chats SET status = ?, updated_at = ? WHERE id = ? AND status <> 'deleted'")
        .run(status, updatedAt, id);
    },

    markDeletedByPlatformIds(platformIds) {
      const ids = JSON.stringify(platformIds);
      superChatDb.exec('SAVEPOINT retract_super_chats');
      try {
        // Retractions can arrive before the original SC packet.
        superChatDb.prepare(`INSERT OR IGNORE INTO super_chat_receipts (platform_id)
          SELECT value FROM json_each(?) WHERE type = 'text' AND value <> ''`).run(ids);
        const result = superChatDb.prepare(`DELETE FROM super_chats
          WHERE platform_id IN (SELECT value FROM json_each(?))`).run(ids);
        superChatDb.exec('RELEASE retract_super_chats');
        return Number(result.changes);
      } catch (error) {
        superChatDb.exec('ROLLBACK TO retract_super_chats');
        superChatDb.exec('RELEASE retract_super_chats');
        throw error;
      }
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
