'use strict';

const { cleanText, splitTextIntoCharacters } = require('../../shared/utils');
const { DANMAKU_MESSAGE_LIMIT } = require('./contract');

const DISPLAY_CACHE_TTL_MS = 10 * 60 * 1000;
const ROOM_MAPPING_TTL_MS = 5 * 60 * 1000;

function createDanmakuSenderService(dependencies) {
  const {
    getAuth,
    getRoom,
    getSessionKey = () => '',
    getLiveStatus,
    getMentionTarget,
    getAutoReplyEnabled = () => false,
    getCheckinBotEnabled = () => false,
    getFortuneBotEnabled = () => false,
    getCustomReplyBotEnabled = () => false,
    createClient,
    minIntervalMs = 1500,
    now = Date.now,
    delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log = console.log,
  } = dependencies;
  let lastSentAt = 0;
  let sendChain = Promise.resolve();
  let roomMapping = null;
  const displayCache = {
    account: { key: '', name: '', avatarUrl: '', expiresAt: 0 },
    room: { key: '', name: '', avatarUrl: '', expiresAt: 0 },
  };

  async function getState() {
    const sendSession = getSessionKey();
    const [auth, room, target] = await Promise.all([getAuth(), getRoom(), getMentionTarget()]);
    const live = getLiveStatus() || {};
    const loggedIn = Boolean(auth && auth.loggedIn && auth.cookieHeader);
    const roomId = String((room && room.roomId) || '');
    const liveMatchesRoom = Boolean(roomId && (!live.roomId || String(live.roomId) === roomId));
    const state = {
      loggedIn,
      accountUid: Number(auth && auth.uid) || 0,
      accountName: '',
      accountAvatarUrl: '',
      roomId,
      sendSession,
      roomName: liveMatchesRoom ? cleanText(live.ownerName) : '',
      roomAvatarUrl: liveMatchesRoom ? cleanText(live.ownerAvatarUrl) : '',
      connected: Boolean(live.connected),
      liveMessage: String(live.message || ''),
      autoReplyEnabled: Boolean(getAutoReplyEnabled()),
      checkinBotEnabled: Boolean(getCheckinBotEnabled()),
      fortuneBotEnabled: Boolean(getFortuneBotEnabled()),
      customReplyBotEnabled: Boolean(getCustomReplyBotEnabled()),
      canSend: Boolean(loggedIn && roomId),
      unavailableReason: !loggedIn ? '请先登录直播账号。' : !roomId ? '请先设置直播间号。' : '',
      requester: target || emptyTarget(),
    };
    await enrichDisplayProfiles(state, auth || {}, roomId, live, liveMatchesRoom);
    return state;
  }

  async function enrichDisplayProfiles(state, auth, roomId, live, liveMatchesRoom) {
    if (!state.loggedIn && !roomId) return;
    const client = typeof createClient === 'function' ? createClient(roomId || '0', auth) : null;
    if (!client) return;
    await Promise.all([
      resolveAccountProfile(state, auth, client).catch(() => {}),
      resolveRoomProfile(state, roomId, live, liveMatchesRoom, client).catch(() => {}),
    ]);
  }

  async function resolveAccountProfile(state, auth, client) {
    const accountKey = String(Number(auth && auth.uid) || state.accountUid || '');
    if (!state.loggedIn || !accountKey) return;
    const cached = getCachedDisplayProfile(displayCache.account, accountKey);
    if (cached) {
      state.accountName = cached.name;
      state.accountAvatarUrl = cached.avatarUrl;
      return;
    }
    let profile = null;
    if (typeof client.fetchCurrentUserProfile === 'function') {
      try {
        profile = await client.fetchCurrentUserProfile();
      } catch (_) {
        if (typeof client.fetchUserProfile === 'function') {
          profile = await client.fetchUserProfile(accountKey).catch(() => null);
        }
      }
    }
    if (!profile && typeof client.fetchCurrentUserName === 'function') {
      profile = { name: cleanText(await client.fetchCurrentUserName()), avatarUrl: '' };
    }
    const name = cleanText(profile && profile.name);
    const avatarUrl = cleanText(profile && profile.avatarUrl);
    if (name || avatarUrl) {
      state.accountName = name;
      state.accountAvatarUrl = avatarUrl;
      displayCache.account = createDisplayCacheEntry(accountKey, name, avatarUrl);
    }
  }

  async function resolveRoomProfile(state, roomId, live, liveMatchesRoom, client) {
    if (!roomId) return;
    const liveOwnerName = liveMatchesRoom ? cleanText(live.ownerName) : '';
    const liveOwnerAvatarUrl = liveMatchesRoom ? cleanText(live.ownerAvatarUrl) : '';
    const cached = getCachedDisplayProfile(displayCache.room, roomId);
    const name = liveOwnerName || (cached && cached.name) || '';
    const avatarUrl = liveOwnerAvatarUrl || (cached && cached.avatarUrl) || '';
    if (name) state.roomName = name;
    if (avatarUrl) state.roomAvatarUrl = avatarUrl;
    if (liveOwnerName && liveOwnerAvatarUrl) {
      displayCache.room = createDisplayCacheEntry(roomId, name, avatarUrl);
      return;
    }
    if (cached) {
      // Keep the original lookup deadline for the other field.
      if (liveOwnerName) displayCache.room.name = liveOwnerName;
      if (liveOwnerAvatarUrl) displayCache.room.avatarUrl = liveOwnerAvatarUrl;
      return;
    }
    if (typeof client.resolveRoomInfo !== 'function') return;
    const roomInfo = await client.resolveRoomInfo();
    const resolvedName = cleanText(roomInfo && roomInfo.ownerName) || name;
    const resolvedAvatarUrl = cleanText(roomInfo && roomInfo.ownerAvatarUrl) || avatarUrl;
    if (resolvedName || resolvedAvatarUrl) {
      state.roomName = resolvedName;
      state.roomAvatarUrl = resolvedAvatarUrl;
      displayCache.room = createDisplayCacheEntry(roomId, resolvedName, resolvedAvatarUrl);
    }
  }

  function send(input) {
    if (input.sendSession !== undefined) {
      const expectedSession = input.sendSession;
      const assertCurrent = input.assertSessionCurrent;
      input = { ...input, assertSessionCurrent(auth) {
        if (typeof expectedSession !== 'string' || !expectedSession || expectedSession !== getSessionKey()) {
          throw Object.assign(new Error('直播账号或房间已变更，已取消本次自动发送。'), { code: 'DANMAKU_SESSION_CHANGED' });
        }
        assertCurrent?.(auth);
      } };
    }
    // Rate checks and every chunk belong to the same serialized operation.
    const operation = sendChain.then(() => sendNow(input));
    sendChain = operation.catch(() => {});
    return operation;
  }

  async function sendNow({
    message,
    mentionRequester = false,
    mentionTarget = null,
    mentionEveryChunk = false,
    intervalMs = 0,
    rateLimitIntervalMs = minIntervalMs,
    waitForRateLimit = false,
    assertSessionCurrent,
    onBeforeSend,
  }) {
    assertSessionCurrent?.();
    const nowMs = now();
    const remainingWait = lastSentAt ? rateLimitIntervalMs - (nowMs - lastSentAt) : 0;
    if (remainingWait > 0 && waitForRateLimit) await delay(remainingWait);
    else if (remainingWait > 0) throw new Error('发送过于频繁，请稍后再试。');
    assertSessionCurrent?.();
    const [auth, room] = await Promise.all([getAuth(), getRoom()]);
    assertSessionCurrent?.(auth);
    if (!auth || !auth.loggedIn || !auth.cookieHeader) throw new Error('请先登录直播账号。');
    if (!room || !room.roomId) throw new Error('请先设置直播间号。');

    const target = normalizeReplyTarget(mentionTarget || (mentionRequester ? await getMentionTarget() : null));
    if (mentionEveryChunk && (!target.uid || !target.name)) {
      throw new Error('缺少弹幕发送者信息，无法 @ 回复。');
    }
    assertSessionCurrent?.(auth);
    const messages = mentionEveryChunk
      ? splitDanmakuEveryMentionMessage(message, target)
      : splitDanmakuReplyMessage(message, target);
    const client = createClient(room.roomId, auth);
    const mappingKey = JSON.stringify([String(room.roomId), String(auth.uid), auth.cookieHeader]);
    if (!roomMapping || roomMapping.key !== mappingKey || roomMapping.expiresAt <= now()) {
      roomMapping = null;
      const resolved = await client.resolveRoomInfo({ includeOwner: false });
      // Only the stable room mapping is reusable; live status and owner data stay fresh.
      roomMapping = { key: mappingKey, roomId: resolved.roomId, expiresAt: now() + ROOM_MAPPING_TTL_MS };
    }
    const roomInfo = roomMapping;
    const results = [];
    const sentAfter = now();
    for (let index = 0; index < messages.length; index += 1) {
      if (index > 0 && intervalMs > 0) await delay(intervalMs);
      assertSessionCurrent?.(auth);
      // Account changes can happen while resolving the room or waiting between chunks.
      if (assertSessionCurrent) assertSessionCurrent(await getAuth());
      const replyTarget = mentionEveryChunk || index === 0 ? target : emptyTarget();
      onBeforeSend?.({ accountUid: String(auth.uid), message: messages[index], mentionName: replyTarget.name });
      results.push(await client.sendDanmaku(roomInfo.roomId, messages[index], replyTarget));
      assertSessionCurrent?.(auth);
    }
    const result = {
      message: results.map((item) => item.message).join(''),
      messages: results.map((item) => item.message),
      count: results.length,
      accountUid: String(Number(auth.uid) || ''),
      sentAfter,
      replyMid: (results[0] && results[0].replyMid) || '',
      replyUname: (results[0] && results[0].replyUname) || '',
    };
    lastSentAt = now();
    log(
      `[Bilibili][DanmakuSend] status=sent roomId=${roomInfo.roomId} accountUid=${auth.uid || 0} count=${result.count} replyUid=${JSON.stringify(result.replyMid)}`,
    );
    return result;
  }

  return { getState, send };
}

function emptyTarget() {
  return { uid: '', name: '', source: '', createdAt: '' };
}

function splitDanmakuMessage(message, limit = DANMAKU_MESSAGE_LIMIT) {
  const chars = splitTextIntoCharacters(message);
  const chunks = [];
  for (let index = 0; index < chars.length; index += limit) {
    chunks.push(chars.slice(index, index + limit).join(''));
  }
  return chunks;
}

function splitDanmakuReplyMessage(message, target, limit = DANMAKU_MESSAGE_LIMIT) {
  const name = cleanText(target && target.name);
  if (!name) return splitDanmakuMessage(message, limit);

  const chars = splitTextIntoCharacters(message);
  const mentionLength = splitTextIntoCharacters(`@${name} `).length;
  const firstLimit = Math.max(1, limit - mentionLength);
  const chunks = [chars.slice(0, firstLimit).join('')];
  for (let index = firstLimit; index < chars.length; index += limit) {
    chunks.push(chars.slice(index, index + limit).join(''));
  }
  return chunks.filter(Boolean);
}

/** Split every chunk after reserving space for the visible `@name ` prefix. */
function splitDanmakuEveryMentionMessage(message, target, limit = DANMAKU_MESSAGE_LIMIT) {
  const name = cleanText(target && target.name);
  if (!name) return splitDanmakuMessage(message, limit);
  const mentionLength = splitTextIntoCharacters(`@${name} `).length;
  const contentLimit = Math.max(1, limit - mentionLength);
  return splitDanmakuNaturally(message, contentLimit);
}

function splitDanmakuNaturally(message, limit) {
  const remaining = splitTextIntoCharacters(message);
  const chunks = [];
  while (remaining.length > limit) {
    const breakAt = findNaturalBreak(remaining, limit);
    chunks.push(remaining.splice(0, breakAt).join(''));
  }
  if (remaining.length) chunks.push(remaining.join(''));
  return chunks;
}

function findNaturalBreak(chars, limit) {
  const minimumChunkCount = Math.ceil(chars.length / limit);
  const capacitySafeMinimum = chars.length - (minimumChunkCount - 1) * limit;
  const emoticonStart = findSplitEmoticonStart(chars, limit);
  if (emoticonStart >= Math.max(1, capacitySafeMinimum)) return emoticonStart;

  const minimum = Math.max(1, limit - 8, capacitySafeMinimum);
  for (let index = limit - 1; index >= minimum; index -= 1) {
    if (/[。！？!?；;，,、～~]/u.test(chars[index])) return index + 1;
  }
  return limit;
}

function findSplitEmoticonStart(chars, limit) {
  const sample = chars.slice(0, limit + 16).join('');
  const pattern = /(?:\([^()\r\n]{1,16}\)|（[^（）\r\n]{1,16}）)/gu;
  for (const match of sample.matchAll(pattern)) {
    const start = splitTextIntoCharacters(sample.slice(0, match.index)).length;
    const end = start + splitTextIntoCharacters(match[0]).length;
    if (start < limit && end > limit && end - start <= limit) return start;
  }
  return -1;
}

function normalizeReplyTarget(target) {
  if (!target) return emptyTarget();
  return {
    uid: cleanText(target.uid),
    name: cleanText(target.name),
    source: cleanText(target.source),
    createdAt: cleanText(target.createdAt),
  };
}

function getCachedDisplayProfile(entry, key) {
  if (!entry || entry.key !== key || entry.expiresAt <= Date.now()) return null;
  if (!entry.name && !entry.avatarUrl) return null;
  return { name: entry.name, avatarUrl: entry.avatarUrl };
}

function createDisplayCacheEntry(key, name, avatarUrl = '') {
  return {
    key,
    name,
    avatarUrl,
    expiresAt: Date.now() + DISPLAY_CACHE_TTL_MS,
  };
}

module.exports = {
  createDanmakuSenderService,
  emptyTarget,
  splitDanmakuMessage,
  splitDanmakuReplyMessage,
  splitDanmakuEveryMentionMessage,
  DANMAKU_MESSAGE_LIMIT,
};
