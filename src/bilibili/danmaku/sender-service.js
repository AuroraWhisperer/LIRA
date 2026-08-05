'use strict';

function createDanmakuSenderService(dependencies) {
  const {
    getAuth,
    getRoom,
    getLiveStatus,
    getMentionTarget,
    createClient,
    minIntervalMs = 1500,
    now = Date.now,
    log = console.log
  } = dependencies;
  let lastSentAt = 0;

  async function getState() {
    const [auth, room, target] = await Promise.all([getAuth(), getRoom(), getMentionTarget()]);
    const live = getLiveStatus();
    const loggedIn = Boolean(auth && auth.loggedIn && auth.cookieHeader);
    const roomId = String(room && room.roomId || '');
    return {
      loggedIn,
      accountUid: Number(auth && auth.uid) || 0,
      roomId,
      connected: Boolean(live && live.connected),
      liveMessage: String(live && live.message || ''),
      canSend: Boolean(loggedIn && roomId),
      unavailableReason: !loggedIn ? '请先登录 Bilibili 账号。' : (!roomId ? '请先设置直播间号。' : ''),
      requester: target || emptyTarget()
    };
  }

  async function send({ message, mentionRequester = false }) {
    const nowMs = now();
    if (lastSentAt && nowMs - lastSentAt < minIntervalMs) throw new Error('发送过于频繁，请稍后再试。');
    const [auth, room] = await Promise.all([getAuth(), getRoom()]);
    if (!auth || !auth.loggedIn || !auth.cookieHeader) throw new Error('请先登录 Bilibili 账号。');
    if (!room || !room.roomId) throw new Error('请先设置 Bilibili 直播间号。');

    const target = mentionRequester ? await getMentionTarget() : null;
    const client = createClient(room.roomId, auth);
    const roomInfo = await client.resolveRoomInfo();
    const result = await client.sendDanmaku(roomInfo.roomId, message, target || emptyTarget());
    lastSentAt = now();
    log(`[Bilibili][DanmakuSend] status=sent roomId=${roomInfo.roomId} accountUid=${auth.uid || 0} replyUid=${JSON.stringify(result.replyMid)}`);
    return result;
  }

  return { getState, send };
}

function emptyTarget() {
  return { uid: '', name: '', source: '', createdAt: '' };
}

module.exports = { createDanmakuSenderService, emptyTarget };
