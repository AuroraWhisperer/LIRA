// 编写人：Aurora
// 点歌队列领域规则；持久化由 storage/queue-store.js 实现。
'use strict';

const { randomUUID } = require('node:crypto');
const { cleanText, now, timestampToIso, normalizePositiveInteger } = require('../shared/utils');
const { selectHistoricalCancellation } = require('./queue-history-cancellation');
const { toSimplifiedChinese } = require('../shared/chinese-text');
const { normalizeGuardLevel } = require('../shared/bilibili-value-contract');
const { songCooldownKey, songCooldownUntil, assertSongAvailable } = require('./song-cooldown');
const { requestRejection, requesterIdentity, userDailyLimit, assertSongRequesterAllowed } = require('./song-request-policy');

const REQUEST_REJECTION_CODES = new Set(['SONG_NAME_REQUIRED', 'QUEUE_FULL', 'SONG_NOT_IN_LIBRARY', 'SONG_ALREADY_QUEUED', 'SONG_COOLDOWN',
  'REQUESTER_IDENTITY_REQUIRED', 'REQUESTER_BLACKLISTED', 'REQUESTER_GUARD_REQUIRED', 'REQUESTER_MEDAL_REQUIRED', 'USER_QUEUE_FULL', 'USER_DAILY_LIMIT']);
const REQUEST_RESULT_RETENTION_MS = 60000;
const REQUEST_RESULT_LIMIT = 200;

function isQueueRequestRejection(error) {
  return REQUEST_REJECTION_CODES.has(error?.code);
}

function addQueueItem(context, input, resolvedSong) {
  const songName = cleanText(input.songName);
  if (!songName) throw requestRejection('SONG_NAME_REQUIRED', '歌曲名不能为空。');

  const settings = context.settings();
  const defaults = context.defaults();
  const store = context.store;
  const acceptedAt = Date.now();
  if (input.viewerRequest === true) assertSongRequesterAllowed(settings, input, acceptedAt);
  const identity = requesterIdentity(input);
  const userQueueLimit = input.viewerRequest === true ? Number(settings.userQueueLimit) || 0 : 0;
  const dailyLimit = input.viewerRequest === true ? userDailyLimit(settings, input) : 0;
  const queueLimit = Number(settings.queueLimit || defaults.queueLimit);
  if (Number.isFinite(queueLimit) && queueLimit > 0 && store.countActive() >= queueLimit) {
    throw requestRejection('QUEUE_FULL', '点歌队列已达到上限。');
  }

  const matchedSong = resolvedSong === undefined ? context.findSong?.(songName, input.artist) : resolvedSong;
  if (settings.onlyFromLibrary === 'true' && !matchedSong) {
    throw requestRejection('SONG_NOT_IN_LIBRARY', '歌库里没有这首歌。');
  }

  const createdAt = timestampToIso(input.messageTimestamp || input.createdAt) || now();
  const canonicalName = matchedSong ? matchedSong.name : songName;
  const canonicalArtist = matchedSong ? matchedSong.artist : input.artist;
  const cooldownKey = songCooldownKey(canonicalName, canonicalArtist);
  const cooldownEnabled = settings.songCooldownMode && settings.songCooldownMode !== 'off';
  const duplicate = settings.allowDuplicate !== 'true' && store.findActiveBySongName(songName);
  if (duplicate) {
    if (cooldownEnabled) assertSongAvailable(settings, store.getSongCooldown(cooldownKey, input.fanScope), canonicalName, acceptedAt);
    throw requestRejection('SONG_ALREADY_QUEUED', '队列里已经有这首歌。');
  }
  const isPinned = input.isPinned === true || input.isPinned === 1 || input.isPinned === 'true' ? 1 : 0;
  return store.insertRequest({
    cooldownKey,
    acceptedAt,
    requestDay: input.viewerRequest === true && identity
      ? new Date(acceptedAt + 8 * 60 * 60 * 1000).toISOString().slice(0, 10) : null,
    songId: matchedSong ? matchedSong.id : null,
    songName: matchedSong ? matchedSong.name : songName,
    artist: cleanText(input.artist) || (matchedSong ? matchedSong.artist : ''),
    categoryName: cleanText(input.categoryName) || (matchedSong ? matchedSong.category_name : ''),
    requesterUid: cleanText(input.requesterUid),
    fanScope: input.fanScope,
    identityType: identity?.type || null,
    requesterName: cleanText(input.requesterName) || '观众',
    requesterGuardLevel: normalizeGuardLevel(input.requesterGuardLevel),
    requesterMedalName: cleanText(input.requesterMedalName),
    requesterMedalLevel: normalizePositiveInteger(input.requesterMedalLevel),
    message: cleanText(input.message),
    source: cleanText(input.source) || 'admin',
    status: 'waiting',
    isPinned,
    pinnedAt: isPinned ? createdAt : '',
    createdAt,
  }, {
    checkCooldown: cooldownEnabled ? (lastAcceptedAt) => assertSongAvailable(settings, lastAcceptedAt, canonicalName, acceptedAt) : undefined,
    checkRequesterCount: userQueueLimit > 0 ? (count) => {
      if (count >= userQueueLimit) throw requestRejection('USER_QUEUE_FULL', `每人最多同时排队 ${userQueueLimit} 首，请等待已点歌曲完成后再点歌。`);
    } : undefined,
    checkDailyCount: dailyLimit > 0 ? (count) => {
      if (count >= dailyLimit) throw requestRejection('USER_DAILY_LIMIT', `你今天的点歌已达到 ${dailyLimit} 首上限，北京时间明天 00:00 后可再点。`);
    } : undefined,
  });
}

function filterSongsByCooldown(context, songs, fanScope) {
  const settings = context.settings();
  if (!settings.songCooldownMode || settings.songCooldownMode === 'off') return songs;
  const previous = new Map();
  for (const row of context.store.listSongCooldowns(fanScope)) {
    const key = toSimplifiedChinese(row.song_key);
    previous.set(key, Math.max(previous.get(key) || 0, row.accepted_at_ms));
  }
  const at = Date.now();
  return songs.filter((song) => songCooldownUntil(settings,
    previous.get(toSimplifiedChinese(songCooldownKey(song.name, song.artist)))) <= at);
}

function cancelQueueItem(context, input) {
  const identity = requesterIdentity(input);
  if (!identity) return null;

  const songName = toSimplifiedChinese(cleanText(input.songName));
  const matchesTitle = row => !songName || toSimplifiedChinese(row.song_name) === songName;
  const rows = context.store.listActive()
    .filter((row) => row.requester_uid === identity.uid && row.requester_identity_type === identity.type)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
  const timing = input.historyCancellation || (input.messageTimestamp != null && { timeline: input.messageTimestamp });
  const item = timing ? selectHistoricalCancellation(rows, timing, matchesTitle) : rows.find(matchesTitle);
  if (!item) return null;

  context.store.setStatus(item.id, 'deleted', now());
  return item;
}

function handleQueueAction(context, action, rawId) {
  const id = Number(rawId);
  const updatedAt = now();

  if (action === 'next') {
    context.store.completeNext(updatedAt, context.settings().guardPriorityEnabled === 'true');
    return getQueueSnapshot(context);
  }
  if (action === 'clear') {
    context.store.clearActive(updatedAt);
    return getQueueSnapshot(context);
  }
  if (action === 'live' || action === 'unlive') {
    if (!['number', 'string'].includes(typeof rawId) || !Number.isSafeInteger(id) || id <= 0
      || getQueueSnapshot(context).waiting[0]?.id !== id) {
      throw Object.assign(new Error('队首已变化，请刷新后重新标记 LIVE。'), { code: 'QUEUE_LIVE_NOT_FIRST' });
    }
    context.store.setLive(id, action === 'live', updatedAt);
    return getQueueSnapshot(context);
  }
  if (!Number.isFinite(id)) throw new Error('缺少队列 ID。');

  if (action === 'pin' || action === 'unpin') {
    context.store.setPinned(id, action === 'pin', updatedAt);
    return getQueueSnapshot(context);
  }
  if (action === 'delete' || action === 'done' || action === 'skip') {
    const status = action === 'delete' ? 'deleted' : action === 'skip' ? 'skipped' : 'done';
    context.store.setStatus(id, status, updatedAt);
    return getQueueSnapshot(context);
  }

  throw new Error('未知队列操作。');
}

function getQueueSnapshot(context) {
  const timestamp = Date.now();
  const requestResult = context.requestResult;
  const requestResults = (context.requestResults || []).filter((result) => result.expiresAt > timestamp);
  return { current: null, waiting: context.store.listActive(context.settings().guardPriorityEnabled === 'true'),
    ...(requestResult?.expiresAt > timestamp ? { requestResult: { ...requestResult } } : {}),
    ...(requestResults.length ? { requestResults: requestResults.map((result) => ({ ...result })) } : {}) };
}

function recordQueueRequestResult(context, { accepted, requesterName, songName, reason }) {
  const timestamp = Date.now();
  const failureReason = accepted === true ? '' : cleanText(reason);
  context.requestResult = {
    id: randomUUID(),
    accepted: accepted === true,
    requesterName: cleanText(requesterName) || '观众',
    songName: cleanText(songName) || '随机歌曲',
    ...(failureReason ? { reason: failureReason } : {}),
    expiresAt: timestamp + 4000,
  };
  context.requestResults = (context.requestResults || []).filter((result) => result.expiresAt > timestamp);
  context.requestResults.push({ ...context.requestResult, expiresAt: timestamp + REQUEST_RESULT_RETENTION_MS });
  if (context.requestResults.length > REQUEST_RESULT_LIMIT) context.requestResults.shift();
}

function ensureUnifiedQueue(context) {
  context.store.normalizeCurrentToWaiting(now());
}

module.exports = {
  isQueueRequestRejection,
  addQueueItem,
  filterSongsByCooldown,
  cancelQueueItem,
  handleQueueAction,
  getQueueSnapshot,
  recordQueueRequestResult,
  ensureUnifiedQueue,
};
