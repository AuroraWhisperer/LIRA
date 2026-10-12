// 编写人：Aurora
// 点歌队列领域规则；持久化由 storage/queue-store.js 实现。
'use strict';

const { cleanText, now, timestampToIso, normalizePositiveInteger } = require('../shared/utils');
const { normalizeGuardLevel } = require('../shared/bilibili-value-contract');
const { songCooldownKey, songCooldownUntil, assertSongAvailable } = require('./song-cooldown');

function addQueueItem(context, input) {
  const songName = cleanText(input.songName);
  if (!songName) throw new Error('歌曲名不能为空。');

  const settings = context.settings();
  const defaults = context.defaults();
  const store = context.store;
  const queueLimit = Number(settings.queueLimit || defaults.queueLimit);
  if (Number.isFinite(queueLimit) && queueLimit > 0 && store.countActive() >= queueLimit) {
    throw new Error('点歌队列已达到上限。');
  }

  const matchedSong = context.findSong ? context.findSong(songName, input.artist) : null;
  if (settings.onlyFromLibrary === 'true' && !matchedSong) {
    throw new Error('歌库里没有这首歌。');
  }

  const createdAt = timestampToIso(input.messageTimestamp || input.createdAt) || now();
  const acceptedAt = Date.now();
  const canonicalName = matchedSong ? matchedSong.name : songName;
  const canonicalArtist = matchedSong ? matchedSong.artist : input.artist;
  const cooldownKey = songCooldownKey(canonicalName, canonicalArtist);
  if (settings.songCooldownMode && settings.songCooldownMode !== 'off') {
    assertSongAvailable(settings, store.getSongCooldown(cooldownKey), canonicalName, acceptedAt);
  }
  if (settings.allowDuplicate !== 'true' && store.findActiveBySongName(songName)) {
    throw new Error('队列里已经有这首歌。');
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
    identityType:
      input.requesterIdentityType === 'open_id'
        ? 'open_id'
        : input.requesterIdentityType === 'uid' && /^[1-9]\d{0,24}$/.test(cleanText(input.requesterUid))
          ? 'uid'
          : null,
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
    context.store.completeNext(updatedAt);
    return getQueueSnapshot(context);
  }
  if (action === 'clear') {
    context.store.clearActive(updatedAt);
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
  return { current: null, waiting: context.store.listActive() };
}

function ensureUnifiedQueue(context) {
  context.store.normalizeCurrentToWaiting(now());
}

module.exports = {
  addQueueItem,
  filterSongsByCooldown,
  handleQueueAction,
  getQueueSnapshot,
  ensureUnifiedQueue,
};
