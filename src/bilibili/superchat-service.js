// 编写人：Aurora
// SuperChat 醒目留言 — 增删改查。
'use strict';

const {
  cleanText,
  now,
  timestampToIso,
  normalizeSuperChatPrice,
  normalizeGuardLevel,
  normalizePositiveInteger
} = require('../shared/utils');

const SUPER_CHAT_PIN_THRESHOLD = 2;
const SUPER_CHAT_DISPLAY_THRESHOLD = 2;

function addSuperChatItem(context, input) {
  const price = normalizeSuperChatPrice(input && input.price);
  if (price < SUPER_CHAT_DISPLAY_THRESHOLD) {
    return null;
  }

  const superChatDb = context.db.superChatDb;
  const platformId = cleanText(input && input.platformId);
  if (platformId) {
    const existing = superChatDb.prepare(`
      SELECT * FROM super_chats WHERE platform_id = ? LIMIT 1
    `).get(platformId);
    if (existing) {
      return existing.status === 'deleted' ? null : normalizeSuperChatRow(existing);
    }
  }

  const createdAt = timestampToIso(input && input.messageTimestamp) || now();
  const result = superChatDb.prepare(`
    INSERT INTO super_chats (
      platform_id, uid, user_name, price, message,
      requester_guard_level, requester_medal_name, requester_medal_level,
      status, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 'superchat', ?, ?)
  `).run(
    platformId,
    cleanText(input && input.uid),
    cleanText(input && input.userName) || '观众',
    price,
    cleanText(input && input.message),
    normalizeGuardLevel(input && input.requesterGuardLevel),
    cleanText(input && input.requesterMedalName),
    normalizePositiveInteger(input && input.requesterMedalLevel),
    createdAt,
    createdAt
  );

  return normalizeSuperChatRow(superChatDb.prepare('SELECT * FROM super_chats WHERE id = ?').get(Number(result.lastInsertRowid)));
}

function handleSuperChatAction(context, action, rawId) {
  const id = Number(rawId);
  if (!Number.isFinite(id)) throw new Error('缺少 SC ID。');

  const superChatDb = context.db.superChatDb;
  const updatedAt = now();

  if (action === 'delete') {
    superChatDb.prepare('UPDATE super_chats SET status = ?, updated_at = ? WHERE id = ?')
      .run('deleted', updatedAt, id);
    return getSuperChatSnapshot(context);
  }

  if (action === 'assist' || action === 'unassist') {
    superChatDb.prepare('UPDATE super_chats SET status = ?, updated_at = ? WHERE id = ?')
      .run(action === 'assist' ? 'assisted' : 'active', updatedAt, id);
    return getSuperChatSnapshot(context);
  }

  throw new Error('未知 SC 操作。');
}

function getSuperChatSnapshot(context) {
  return context.db.superChatDb.prepare(`
    SELECT * FROM super_chats
    WHERE status IN ('active', 'assisted')
    ORDER BY price DESC, datetime(created_at) ASC, id ASC
  `).all().map(normalizeSuperChatRow);
}

function normalizeSuperChatRow(row) {
  if (!row) return null;
  return {
    ...row,
    price: normalizeSuperChatPrice(row.price),
    requester_guard_level: normalizeGuardLevel(row.requester_guard_level),
    requester_medal_name: cleanText(row.requester_medal_name),
    requester_medal_level: normalizePositiveInteger(row.requester_medal_level)
  };
}

module.exports = {
  SUPER_CHAT_PIN_THRESHOLD,
  SUPER_CHAT_DISPLAY_THRESHOLD,
  addSuperChatItem,
  handleSuperChatAction,
  getSuperChatSnapshot,
  normalizeSuperChatRow
};
