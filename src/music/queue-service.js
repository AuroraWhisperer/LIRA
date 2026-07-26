// 编写人：Aurora
// 点歌队列核心操作 — addQueueItem、handleQueueAction、快照。
// 纯 music 域，不含 Bilibili 弹幕解析（弹幕→点歌在 bilibili/bilibili-message-handler.js）。
'use strict';

const {
  cleanText,
  now,
  timestampToIso,
  normalizeGuardLevel,
  normalizePositiveInteger
} = require('../shared/utils');

// ── 添加入队 ──

function addQueueItem(context, input) {
  const songName = cleanText(input.songName);
  if (!songName) {
    throw new Error('歌曲名不能为空。');
  }

  const settings = context.settings();
  const songDb = context.db.songDb;
  const defaults = context.settingsStore.getDefaultSettings();

  const activeCount = songDb.prepare(`
    SELECT COUNT(*) AS count FROM queue
    WHERE status IN ('current', 'waiting')
  `).get().count;
  if (activeCount >= Number(settings.queueLimit || defaults.queueLimit)) {
    throw new Error('点歌队列已达到上限。');
  }

  if (settings.allowDuplicate !== 'true') {
    const duplicate = songDb.prepare(`
      SELECT id FROM queue
      WHERE status IN ('current', 'waiting') AND song_name = ?
      LIMIT 1
    `).get(songName);
    if (duplicate) {
      throw new Error('队列里已经有这首歌。');
    }
  }

  const matchedSong = context.findSong
    ? context.findSong(songName, input.artist)
    : null;

  if (settings.onlyFromLibrary === 'true' && !matchedSong) {
    throw new Error('歌库里没有这首歌。');
  }

  const status = 'waiting';
  const createdAt = timestampToIso(input.messageTimestamp || input.createdAt) || now();
  const requesterGuardLevel = normalizeGuardLevel(input.requesterGuardLevel);
  const requesterMedalName = cleanText(input.requesterMedalName);
  const requesterMedalLevel = normalizePositiveInteger(input.requesterMedalLevel);
  const isPinned = input.isPinned === true || input.isPinned === 1 || input.isPinned === 'true' ? 1 : 0;
  const pinnedAt = isPinned ? createdAt : '';

  const result = songDb.prepare(`
    INSERT INTO queue (
      song_id, song_name, artist, category_name,
      requester_uid, requester_name,
      requester_guard_level, requester_medal_name, requester_medal_level,
      source, status, is_pinned, pinned_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    matchedSong ? matchedSong.id : null,
    matchedSong ? matchedSong.name : songName,
    cleanText(input.artist) || (matchedSong ? matchedSong.artist : ''),
    cleanText(input.categoryName) || (matchedSong ? matchedSong.category_name : ''),
    cleanText(input.requesterUid),
    cleanText(input.requesterName) || '观众',
    requesterGuardLevel,
    requesterMedalName,
    requesterMedalLevel,
    cleanText(input.source) || 'admin',
    status,
    isPinned,
    pinnedAt,
    createdAt,
    createdAt
  );

  const queueId = Number(result.lastInsertRowid);
  songDb.prepare(`
    INSERT INTO requests (
      queue_id, song_id, song_name, artist, category_name,
      requester_uid, requester_name,
      requester_guard_level, requester_medal_name, requester_medal_level,
      message, source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    queueId,
    matchedSong ? matchedSong.id : null,
    matchedSong ? matchedSong.name : songName,
    cleanText(input.artist) || (matchedSong ? matchedSong.artist : ''),
    cleanText(input.categoryName) || (matchedSong ? matchedSong.category_name : ''),
    cleanText(input.requesterUid),
    cleanText(input.requesterName) || '观众',
    requesterGuardLevel,
    requesterMedalName,
    requesterMedalLevel,
    cleanText(input.message),
    cleanText(input.source) || 'admin',
    createdAt
  );

  return normalizeQueueRow(songDb.prepare('SELECT * FROM queue WHERE id = ?').get(queueId));
}

// ── 队列操作（置顶、删除、切歌等） ──

function handleQueueAction(context, action, rawId) {
  const id = Number(rawId);
  const songDb = context.db.songDb;
  const updatedAt = now();

  if (action === 'next') {
    const first = songDb.prepare(`
      SELECT id FROM queue
      WHERE status IN ('current', 'waiting')
      ORDER BY is_pinned DESC, datetime(NULLIF(pinned_at, '')) ASC, datetime(created_at) ASC, id ASC
      LIMIT 1
    `).get();
    if (first) {
      songDb.prepare('UPDATE queue SET status = ?, updated_at = ? WHERE id = ?')
        .run('done', updatedAt, first.id);
    }
    return getQueueSnapshot(context);
  }

  if (action === 'clear') {
    songDb.prepare(`
      UPDATE queue SET status = 'deleted', updated_at = ?
      WHERE status IN ('current', 'waiting')
    `).run(updatedAt);
    return getQueueSnapshot(context);
  }

  if (!Number.isFinite(id)) {
    throw new Error('缺少队列 ID。');
  }

  if (action === 'pin' || action === 'unpin') {
    songDb.prepare('UPDATE queue SET is_pinned = ?, pinned_at = ?, updated_at = ? WHERE id = ?')
      .run(action === 'pin' ? 1 : 0, action === 'pin' ? updatedAt : '', updatedAt, id);
    return getQueueSnapshot(context);
  }

  if (action === 'delete' || action === 'done' || action === 'skip') {
    const status = action === 'delete' ? 'deleted' : (action === 'skip' ? 'skipped' : 'done');
    songDb.prepare('UPDATE queue SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, updatedAt, id);
    return getQueueSnapshot(context);
  }

  throw new Error('未知队列操作。');
}

// ── 快照与格式化 ──

function getQueueSnapshot(context) {
  const songDb = context.db.songDb;
  const waiting = songDb.prepare(`
    SELECT queue.*, requests.message AS request_message
    FROM queue
    LEFT JOIN requests ON requests.queue_id = queue.id
    WHERE status IN ('current', 'waiting')
    ORDER BY queue.is_pinned DESC, datetime(NULLIF(queue.pinned_at, '')) ASC, datetime(queue.created_at) ASC, queue.id ASC
  `).all();

  return {
    current: null,
    waiting: waiting.map(normalizeQueueRow)
  };
}

function normalizeQueueRow(row) {
  if (!row) return null;
  return {
    ...row,
    is_pinned: Boolean(row.is_pinned),
    requester_guard_level: normalizeGuardLevel(row.requester_guard_level),
    requester_medal_name: cleanText(row.requester_medal_name),
    requester_medal_level: normalizePositiveInteger(row.requester_medal_level)
  };
}

// ── 启动时清理 ──

function clearActiveQueueOnStartup(context) {
  const songDb = context.db.songDb;
  const updatedAt = now();
  const result = songDb.prepare(`
    UPDATE queue SET status = 'deleted', updated_at = ?
    WHERE status IN ('current', 'waiting')
  `).run(updatedAt);
  if (result.changes > 0) {
    console.log(`[Startup] cleared ${result.changes} old queue item(s).`);
  }
}

function ensureUnifiedQueue(context) {
  context.db.songDb.prepare(`
    UPDATE queue SET status = 'waiting', updated_at = ?
    WHERE status = 'current'
  `).run(now());
}

module.exports = {
  addQueueItem,
  handleQueueAction,
  getQueueSnapshot,
  normalizeQueueRow,
  clearActiveQueueOnStartup,
  ensureUnifiedQueue
};
