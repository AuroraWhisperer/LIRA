// 编写人：Aurora
// 点歌队列领域规则；持久化由 storage/queue-store.js 实现。
'use strict';

const {
  cleanText,
  now,
  timestampToIso,
  normalizeGuardLevel,
  normalizePositiveInteger
} = require('../shared/utils');

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

  if (settings.allowDuplicate !== 'true' && store.findActiveBySongName(songName)) {
    throw new Error('队列里已经有这首歌。');
  }

  const matchedSong = context.findSong
    ? context.findSong(songName, input.artist)
    : null;
  if (settings.onlyFromLibrary === 'true' && !matchedSong) {
    throw new Error('歌库里没有这首歌。');
  }

  const createdAt = timestampToIso(input.messageTimestamp || input.createdAt) || now();
  const isPinned = input.isPinned === true || input.isPinned === 1 || input.isPinned === 'true' ? 1 : 0;
  return store.insertRequest({
    songId: matchedSong ? matchedSong.id : null,
    songName: matchedSong ? matchedSong.name : songName,
    artist: cleanText(input.artist) || (matchedSong ? matchedSong.artist : ''),
    categoryName: cleanText(input.categoryName) || (matchedSong ? matchedSong.category_name : ''),
    requesterUid: cleanText(input.requesterUid),
    requesterName: cleanText(input.requesterName) || '观众',
    requesterGuardLevel: normalizeGuardLevel(input.requesterGuardLevel),
    requesterMedalName: cleanText(input.requesterMedalName),
    requesterMedalLevel: normalizePositiveInteger(input.requesterMedalLevel),
    message: cleanText(input.message),
    source: cleanText(input.source) || 'admin',
    status: 'waiting',
    isPinned,
    pinnedAt: isPinned ? createdAt : '',
    createdAt
  });
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
    const status = action === 'delete' ? 'deleted' : (action === 'skip' ? 'skipped' : 'done');
    context.store.setStatus(id, status, updatedAt);
    return getQueueSnapshot(context);
  }

  throw new Error('未知队列操作。');
}

function getQueueSnapshot(context) {
  return { current: null, waiting: context.store.listActive() };
}

function clearActiveQueueOnStartup(context) {
  const changes = context.store.clearActive(now());
  if (changes > 0) {
    console.log(`[Startup] cleared ${changes} old queue item(s).`);
  }
}

function ensureUnifiedQueue(context) {
  context.store.normalizeCurrentToWaiting(now());
}

module.exports = {
  addQueueItem,
  handleQueueAction,
  getQueueSnapshot,
  clearActiveQueueOnStartup,
  ensureUnifiedQueue
};
