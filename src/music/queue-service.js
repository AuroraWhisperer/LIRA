// 编写人：Aurora
// 点歌队列领域规则；持久化由 storage/queue-store.js 实现。
'use strict';

const { cleanText, now, timestampToIso, normalizePositiveInteger } = require('../shared/utils');
const { normalizeGuardLevel } = require('../shared/bilibili-value-contract');
const { songCooldownKey, songCooldownUntil, assertSongAvailable } = require('./song-cooldown');
const { requestRejection, requesterIdentity, assertSongRequesterAllowed } = require('./song-request-policy');

const REQUEST_REJECTION_CODES = new Set(['SONG_NAME_REQUIRED', 'QUEUE_FULL', 'SONG_NOT_IN_LIBRARY', 'SONG_ALREADY_QUEUED', 'SONG_COOLDOWN',
  'REQUESTER_IDENTITY_REQUIRED', 'REQUESTER_BLACKLISTED', 'REQUESTER_GUARD_REQUIRED', 'REQUESTER_MEDAL_REQUIRED', 'USER_QUEUE_FULL']);

function isQueueRequestRejection(error) {
  return REQUEST_REJECTION_CODES.has(error?.code);
}

function addQueueItem(context, input) {
  const songName = cleanText(input.songName);
  if (!songName) throw requestRejection('SONG_NAME_REQUIRED', '歌曲名不能为空。');

  const settings = context.settings();
  const defaults = context.defaults();
  const store = context.store;
  const acceptedAt = Date.now();
  if (input.viewerRequest === true) assertSongRequesterAllowed(settings, input, acceptedAt);
  const identity = requesterIdentity(input);
  const userQueueLimit = input.viewerRequest === true ? Number(settings.userQueueLimit) || 0 : 0;
  const queueLimit = Number(settings.queueLimit || defaults.queueLimit);
  if (Number.isFinite(queueLimit) && queueLimit > 0 && store.countActive() >= queueLimit) {
    throw requestRejection('QUEUE_FULL', '点歌队列已达到上限。');
  }

  const matchedSong = context.findSong ? context.findSong(songName, input.artist) : null;
  if (settings.onlyFromLibrary === 'true' && !matchedSong) {
    throw requestRejection('SONG_NOT_IN_LIBRARY', '歌库里没有这首歌。');
  }

  const createdAt = timestampToIso(input.messageTimestamp || input.createdAt) || now();
  const canonicalName = matchedSong ? matchedSong.name : songName;
  const canonicalArtist = matchedSong ? matchedSong.artist : input.artist;
  const cooldownKey = songCooldownKey(canonicalName, canonicalArtist);
  if (settings.songCooldownMode && settings.songCooldownMode !== 'off') {
    assertSongAvailable(settings, store.getSongCooldown(cooldownKey), canonicalName, acceptedAt);
  }
  if (settings.allowDuplicate !== 'true' && store.findActiveBySongName(songName)) {
    throw requestRejection('SONG_ALREADY_QUEUED', '队列里已经有这首歌。');
  }
  const isPinned = input.isPinned === true || input.isPinned === 1 || input.isPinned === 'true' ? 1 : 0;
  return store.insertRequest({
    cooldownKey,
    acceptedAt,
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
    checkCooldown: (lastAcceptedAt) => assertSongAvailable(settings, lastAcceptedAt, canonicalName, acceptedAt),
    checkRequesterCount: userQueueLimit > 0 ? (count) => {
      if (count >= userQueueLimit) throw requestRejection('USER_QUEUE_FULL', `每人最多同时排队 ${userQueueLimit} 首，请等待已点歌曲完成后再点歌。`);
    } : undefined,
  });
}

function filterSongsByCooldown(context, songs) {
  const settings = context.settings();
  if (!settings.songCooldownMode || settings.songCooldownMode === 'off') return songs;
  const previous = new Map(context.store.listSongCooldowns().map((row) => [row.song_key, row.accepted_at_ms]));
  const at = Date.now();
  return songs.filter((song) => songCooldownUntil(settings, previous.get(songCooldownKey(song.name, song.artist))) <= at);
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
  return { current: null, waiting: context.store.listActive(context.settings().guardPriorityEnabled === 'true') };
}

function ensureUnifiedQueue(context) {
  context.store.normalizeCurrentToWaiting(now());
}

module.exports = {
  isQueueRequestRejection,
  addQueueItem,
  filterSongsByCooldown,
  handleQueueAction,
  getQueueSnapshot,
  ensureUnifiedQueue,
};
