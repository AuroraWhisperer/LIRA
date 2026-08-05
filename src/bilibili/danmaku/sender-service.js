'use strict';

const { cleanText } = require('../../shared/utils');

const DANMAKU_MESSAGE_LIMIT = 40;
const DISPLAY_CACHE_TTL_MS = 10 * 60 * 1000;

function createDanmakuSenderService(dependencies) {
  const {
    getAuth,
    getRoom,
    getLiveStatus,
    getMentionTarget,
    getAutoReplyEnabled = () => false,
    getCheckinBotEnabled = () => false,
    getFortuneBotEnabled = () => false,
    createClient,
    minIntervalMs = 1500,
    now = Date.now,
    log = console.log
  } = dependencies;
  let lastSentAt = 0;
  let displayCache = {
    account: { key: '', name: '', expiresAt: 0 },
    room: { key: '', name: '', expiresAt: 0 }
  };

  async function getState() {
    const [auth, room, target] = await Promise.all([getAuth(), getRoom(), getMentionTarget()]);
    const live = getLiveStatus();
    const loggedIn = Boolean(auth && auth.loggedIn && auth.cookieHeader);
    const roomId = String(room && room.roomId || '');
    const state = {
      loggedIn,
      accountUid: Number(auth && auth.uid) || 0,
      accountName: '',
      roomId,
      roomName: cleanText(live && live.ownerName),
      connected: Boolean(live && live.connected),
      liveMessage: String(live && live.message || ''),
      autoReplyEnabled: Boolean(getAutoReplyEnabled()),
      checkinBotEnabled: Boolean(getCheckinBotEnabled()),
      fortuneBotEnabled: Boolean(getFortuneBotEnabled()),
      canSend: Boolean(loggedIn && roomId),
      unavailableReason: !loggedIn ? '请先登录 Bilibili 账号。' : (!roomId ? '请先设置直播间号。' : ''),
      requester: target || emptyTarget()
    };
    await enrichDisplayNames(state, auth || {}, roomId, live || {});
    return state;
  }

  async function enrichDisplayNames(state, auth, roomId, live) {
    if (!state.loggedIn) return;
    const client = createClient(roomId || '0', auth);
    await Promise.all([
      resolveAccountName(state, auth, client).catch(() => {}),
      resolveRoomName(state, roomId, live, client).catch(() => {})
    ]);
  }

  async function resolveAccountName(state, auth, client) {
    const accountKey = String(Number(auth && auth.uid) || state.accountUid || '');
    if (!state.loggedIn || !accountKey || typeof client.fetchCurrentUserName !== 'function') return;
    const cached = getCachedDisplayName(displayCache.account, accountKey);
    if (cached) {
      state.accountName = cached;
      return;
    }
    const name = cleanText(await client.fetchCurrentUserName());
    if (name) {
      state.accountName = name;
      displayCache.account = createDisplayCacheEntry(accountKey, name);
    }
  }

  async function resolveRoomName(state, roomId, live, client) {
    if (!roomId) return;
    const liveOwnerName = cleanText(live && live.ownerName);
    if (liveOwnerName) {
      state.roomName = liveOwnerName;
      displayCache.room = createDisplayCacheEntry(roomId, liveOwnerName);
      return;
    }
    const cached = getCachedDisplayName(displayCache.room, roomId);
    if (cached) {
      state.roomName = cached;
      return;
    }
    if (typeof client.resolveRoomInfo !== 'function') return;
    const roomInfo = await client.resolveRoomInfo();
    const ownerName = cleanText(roomInfo && roomInfo.ownerName);
    if (ownerName) {
      state.roomName = ownerName;
      displayCache.room = createDisplayCacheEntry(roomId, ownerName);
    }
  }

  async function send({ message, mentionRequester = false, mentionTarget = null }) {
    const nowMs = now();
    if (lastSentAt && nowMs - lastSentAt < minIntervalMs) throw new Error('发送过于频繁，请稍后再试。');
    const [auth, room] = await Promise.all([getAuth(), getRoom()]);
    if (!auth || !auth.loggedIn || !auth.cookieHeader) throw new Error('请先登录 Bilibili 账号。');
    if (!room || !room.roomId) throw new Error('请先设置 Bilibili 直播间号。');

    const target = normalizeReplyTarget(
      mentionTarget || (mentionRequester ? await getMentionTarget() : null)
    );
    const messages = splitDanmakuReplyMessage(message, target);
    const client = createClient(room.roomId, auth);
    const roomInfo = await client.resolveRoomInfo();
    const results = [];
    for (let index = 0; index < messages.length; index += 1) {
      const replyTarget = index === 0 ? target : emptyTarget();
      results.push(await client.sendDanmaku(roomInfo.roomId, messages[index], replyTarget));
    }
    const result = {
      message: results.map((item) => item.message).join(''),
      messages: results.map((item) => item.message),
      count: results.length,
      replyMid: results[0] && results[0].replyMid || '',
      replyUname: results[0] && results[0].replyUname || ''
    };
    lastSentAt = now();
    log(`[Bilibili][DanmakuSend] status=sent roomId=${roomInfo.roomId} accountUid=${auth.uid || 0} count=${result.count} replyUid=${JSON.stringify(result.replyMid)}`);
    return result;
  }

  return { getState, send };
}

function emptyTarget() {
  return { uid: '', name: '', source: '', createdAt: '' };
}

function splitDanmakuMessage(message, limit = DANMAKU_MESSAGE_LIMIT) {
  const chars = Array.from(String(message || ''));
  const chunks = [];
  for (let index = 0; index < chars.length; index += limit) {
    chunks.push(chars.slice(index, index + limit).join(''));
  }
  return chunks;
}

function splitDanmakuReplyMessage(message, target, limit = DANMAKU_MESSAGE_LIMIT) {
  const name = cleanText(target && target.name);
  if (!name) return splitDanmakuMessage(message, limit);

  const chars = Array.from(String(message || ''));
  const mentionLength = Array.from(`@${name} `).length;
  const firstLimit = Math.max(1, limit - mentionLength);
  const chunks = [chars.slice(0, firstLimit).join('')];
  for (let index = firstLimit; index < chars.length; index += limit) {
    chunks.push(chars.slice(index, index + limit).join(''));
  }
  return chunks.filter(Boolean);
}

function normalizeReplyTarget(target) {
  if (!target) return emptyTarget();
  return {
    uid: cleanText(target.uid),
    name: cleanText(target.name),
    source: cleanText(target.source),
    createdAt: cleanText(target.createdAt)
  };
}

function getCachedDisplayName(entry, key) {
  if (!entry || entry.key !== key || entry.expiresAt <= Date.now()) return '';
  return entry.name;
}

function createDisplayCacheEntry(key, name) {
  return {
    key,
    name,
    expiresAt: Date.now() + DISPLAY_CACHE_TTL_MS
  };
}

module.exports = {
  createDanmakuSenderService,
  emptyTarget,
  splitDanmakuMessage,
  splitDanmakuReplyMessage,
  DANMAKU_MESSAGE_LIMIT
};
