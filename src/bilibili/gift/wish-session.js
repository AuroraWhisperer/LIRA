'use strict';

const { BilibiliApiClient } = require('../danmaku/api-client');

async function readLiveRoom(roomId) {
  const { payload } = await new BilibiliApiClient(roomId).fetchJson(
    'gift_wish_live',
    `https://api.live.bilibili.com/room/v1/Room/room_init?id=${encodeURIComponent(roomId)}`,
    { signal: AbortSignal.timeout(5000) },
  );
  if (payload?.code !== 0 || !payload.data?.room_id)
    throw new Error('直播状态暂时无法确认');
  return payload.data;
}

function createGiftWishSession({
  store,
  readRoom = readLiveRoom,
  now = Date.now,
}) {
  let cached = null;
  let pending = null;

  function get(sourceId, roomId) {
    const key = `${sourceId}:${roomId}`;
    if (cached?.key === key && now() - cached.at < 30000)
      return Promise.resolve(cached.value);
    if (pending?.key === key) return pending.promise;
    const promise = refresh(sourceId, roomId)
      .then((value) => {
        cached = { key, at: now(), value };
        return value;
      })
      .finally(() => {
        if (pending?.promise === promise) pending = null;
      });
    pending = { key, promise };
    return promise;
  }

  async function refresh(sourceId, roomId) {
    const previous = store.readSession(sourceId, roomId);
    try {
      if (!/^[1-9]\d*$/.test(roomId)) throw new Error('尚未配置直播间');
      const room = await readRoom(roomId);
      const checkedAt = new Date(now()).toISOString();
      if (Number(room.live_status) === 1) {
        const start = Number(room.live_time) * 1000;
        if (!Number.isSafeInteger(start) || start <= 0 || start > now())
          throw new Error('开播时间暂时无法确认');
        const value = {
          started_at: new Date(start).toISOString(),
          ended_at: null,
          checked_at: checkedAt,
        };
        store.saveSession(sourceId, roomId, value);
        return { ...value, state: 'live', stale: false };
      }
      if (![0, 2].includes(Number(room.live_status)))
        throw new Error('直播状态暂时无法确认');
      if (previous) {
        const value = {
          ...previous,
          // The next visit is not the time the broadcast ended.
          ended_at: previous.ended_at || previous.checked_at,
          checked_at: checkedAt,
        };
        store.saveSession(sourceId, roomId, value);
        return { ...value, state: 'offline', stale: false };
      }
      return {
        state: 'offline',
        stale: false,
        started_at: null,
        ended_at: null,
      };
    } catch {
      // A failed check is never evidence of a new stream or of a stream ending.
      return { ...previous, state: 'unknown', stale: true };
    }
  }

  return { get };
}

module.exports = { createGiftWishSession };
