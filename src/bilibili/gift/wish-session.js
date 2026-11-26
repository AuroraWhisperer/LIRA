'use strict';

const { BilibiliApiClient } = require('../danmaku/api-client');
const { queryError } = require('./history-filters');

async function readLiveRoom(roomId) {
  const { payload } = await new BilibiliApiClient(roomId).fetchJson(
    'gift_wish_live',
    `https://api.live.bilibili.com/room/v1/Room/room_init?id=${encodeURIComponent(roomId)}`,
    { signal: AbortSignal.timeout(5000) },
  );
  if (payload?.code !== 0 || !payload.data?.room_id) throw new Error('直播状态暂时无法确认');
  return payload.data;
}

function createGiftWishSession({ store, getRoomId, readRoom = readLiveRoom, now = Date.now }) {
  let cached = null;
  let pending = null;

  function get(sourceId) {
    const roomId = String(getRoomId() || '');
    const key = `${sourceId}:${roomId}`;
    if (pending && pending.key !== key) pending = null;
    if (cached?.key === key && now() - cached.at < 30000) return Promise.resolve(cached.value);
    if (pending?.key === key) return pending.promise;
    const request = { key };
    pending = request;
    request.promise = refresh(sourceId, roomId, request).finally(() => {
      if (pending === request) pending = null;
    });
    return request.promise;
  }

  async function refresh(sourceId, roomId, request) {
    const previous = store.readSession(sourceId, roomId);
    const fallback = { ...previous, state: 'unknown', stale: true };
    let value = await readWindow(roomId, previous).catch(() => fallback);
    if (pending !== request || String(getRoomId() || '') !== roomId) {
      throw queryError('GIFT_VIEW_STALE', '直播间已切换，请刷新许愿列表。');
    }
    if (!value.stale && value.started_at) {
      try {
        store.saveSession(sourceId, roomId, value);
      } catch {
        value = fallback;
      }
    }
    cached = { key: request.key, at: now(), value };
    return value;
  }

  async function readWindow(roomId, previous) {
    if (!/^[1-9]\d*$/.test(roomId)) throw new Error('尚未配置直播间');
    const room = await readRoom(roomId);
    const checkedAt = new Date(now()).toISOString();
    if (Number(room.live_status) === 1) {
      const start = Number(room.live_time) * 1000;
      if (!Number.isSafeInteger(start) || start <= 0 || start > now()) throw new Error('开播时间暂时无法确认');
      return { started_at: new Date(start).toISOString(), ended_at: null, checked_at: checkedAt, state: 'live', stale: false };
    }
    if (![0, 2].includes(Number(room.live_status))) throw new Error('直播状态暂时无法确认');
    if (!previous) return { state: 'offline', stale: false, started_at: null, ended_at: null };
    // The next visit is not the time the broadcast ended.
    return { ...previous, ended_at: previous.ended_at || previous.checked_at, checked_at: checkedAt, state: 'offline', stale: false };
  }

  return { get };
}

module.exports = { createGiftWishSession };
