// 编写人：Aurora
// 数据保留期清理。此前只有「全部清空」，没有按时间清理的手段，
// gift_events.raw_json 和 requests 会随开播场次无节制增长。
'use strict';

const { now } = require('../shared/utils');

// 默认保留期（天）。0 表示不清理。
const DEFAULT_POLICY = {
  giftRawJsonDays: 30,   // 原始报文只用于排障，过期后清空文本但保留解析结果
  giftEventDays: 0,      // 礼物流水默认永久保留，删行要用户显式开启
  requestDays: 0,        // 点歌流水同上
  superChatDays: 0,
  cooldownDays: 1
};

function normalizeDays(value, fallback = 0) {
  const days = Number(value);
  if (!Number.isFinite(days) || days < 0) return fallback;
  return Math.floor(days);
}

/** 生成 N 天前的 ISO 时间戳，与各表 created_at 的格式保持一致 */
function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * 按保留期清理三个库。dryRun 时只统计将要清理的行数，不实际删除。
 */
function applyRetentionPolicies(databases, options = {}) {
  const policy = { ...DEFAULT_POLICY, ...(options.policy || {}) };
  const dryRun = options.dryRun === true;
  const result = {
    ranAt: now(),
    dryRun,
    policy,
    giftRawJsonCleared: 0,
    giftEventsDeleted: 0,
    requestsDeleted: 0,
    superChatsDeleted: 0,
    cooldownsDeleted: 0
  };

  const giftRawDays = normalizeDays(policy.giftRawJsonDays);
  if (giftRawDays > 0 && databases.giftDb) {
    const threshold = isoDaysAgo(giftRawDays);
    const countRow = databases.giftDb.prepare(`
      SELECT COUNT(*) AS count FROM gift_events
      WHERE raw_json != '' AND created_at < ?
    `).get(threshold);
    result.giftRawJsonCleared = Number(countRow && countRow.count) || 0;
    if (!dryRun && result.giftRawJsonCleared > 0) {
      databases.giftDb.prepare(`
        UPDATE gift_events SET raw_json = '', updated_at = ?
        WHERE raw_json != '' AND created_at < ?
      `).run(now(), threshold);
    }
  }

  const giftEventDays = normalizeDays(policy.giftEventDays);
  if (giftEventDays > 0 && databases.giftDb) {
    result.giftEventsDeleted = deleteOlderThan(
      databases.giftDb, 'gift_events', isoDaysAgo(giftEventDays), dryRun
    );
  }

  const requestDays = normalizeDays(policy.requestDays);
  if (requestDays > 0 && databases.songDb) {
    result.requestsDeleted = deleteOlderThan(
      databases.songDb, 'requests', isoDaysAgo(requestDays), dryRun
    );
  }

  const superChatDays = normalizeDays(policy.superChatDays);
  if (superChatDays > 0 && databases.superChatDb) {
    result.superChatsDeleted = deleteOlderThan(
      databases.superChatDb, 'super_chats', isoDaysAgo(superChatDays), dryRun
    );
  }

  const cooldownDays = normalizeDays(policy.cooldownDays, 1);
  if (cooldownDays > 0 && databases.songDb) {
    const threshold = Date.now() - cooldownDays * 24 * 60 * 60 * 1000;
    const countRow = databases.songDb.prepare(`
      SELECT COUNT(*) AS count FROM user_cooldowns WHERE last_request_at < ?
    `).get(threshold);
    result.cooldownsDeleted = Number(countRow && countRow.count) || 0;
    if (!dryRun && result.cooldownsDeleted > 0) {
      databases.songDb.prepare('DELETE FROM user_cooldowns WHERE last_request_at < ?').run(threshold);
    }
  }

  return result;
}

function deleteOlderThan(db, tableName, threshold, dryRun) {
  const countRow = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName} WHERE created_at < ?`)
    .get(threshold);
  const count = Number(countRow && countRow.count) || 0;
  if (!dryRun && count > 0) {
    db.prepare(`DELETE FROM ${tableName} WHERE created_at < ?`).run(threshold);
  }
  return count;
}

/** 把 settings 里的保留期配置翻译成 policy 对象 */
function readRetentionPolicy(settings) {
  const source = settings && typeof settings === 'object' ? settings : {};
  return {
    giftRawJsonDays: normalizeDays(source.giftRawJsonRetentionDays, DEFAULT_POLICY.giftRawJsonDays),
    giftEventDays: normalizeDays(source.giftEventRetentionDays, DEFAULT_POLICY.giftEventDays),
    requestDays: normalizeDays(source.requestRetentionDays, DEFAULT_POLICY.requestDays),
    superChatDays: normalizeDays(source.superChatRetentionDays, DEFAULT_POLICY.superChatDays),
    cooldownDays: DEFAULT_POLICY.cooldownDays
  };
}

/** 各表行数与最早记录时间，供管理页展示存储占用 */
function getRetentionStats(databases) {
  return {
    gifts: tableStats(databases.giftDb, 'gift_events'),
    giftRawJson: rawJsonStats(databases.giftDb),
    requests: tableStats(databases.songDb, 'requests'),
    queue: tableStats(databases.songDb, 'queue'),
    superChats: tableStats(databases.superChatDb, 'super_chats'),
    cooldowns: tableStats(databases.songDb, 'user_cooldowns', 'updated_at'),
    playHistory: tableStats(databases.musicDb, 'play_history', 'played_at')
  };
}

function tableStats(db, tableName, timeColumn = 'created_at') {
  if (!db) return { rows: 0, oldest: '', newest: '' };
  try {
    const row = db.prepare(`
      SELECT COUNT(*) AS rows, MIN(${timeColumn}) AS oldest, MAX(${timeColumn}) AS newest
      FROM ${tableName}
    `).get();
    return {
      rows: Number(row && row.rows) || 0,
      oldest: (row && row.oldest) || '',
      newest: (row && row.newest) || ''
    };
  } catch (_) {
    return { rows: 0, oldest: '', newest: '' };
  }
}

function rawJsonStats(db) {
  if (!db) return { rows: 0, bytes: 0 };
  try {
    const row = db.prepare(`
      SELECT COUNT(*) AS rows, SUM(LENGTH(raw_json)) AS bytes
      FROM gift_events WHERE raw_json != ''
    `).get();
    return {
      rows: Number(row && row.rows) || 0,
      bytes: Number(row && row.bytes) || 0
    };
  } catch (_) {
    return { rows: 0, bytes: 0 };
  }
}

module.exports = {
  DEFAULT_POLICY,
  applyRetentionPolicies,
  readRetentionPolicy,
  getRetentionStats,
  isoDaysAgo
};
