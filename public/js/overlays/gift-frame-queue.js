// 自定义礼物特效按触发顺序串行播放；各特效的画面和参数由自己的播放器负责。
'use strict';

const MAX_PENDING = 50;
const SEEN_LIMIT = 200;
const THEME_IDS = new Set(['woodland-bloom']);

export function createGiftFrameQueue({ player, onError, canPlay = () => true }) {
  const pending = [];
  const seen = new Set();
  let activeId = null;
  let disposed = false;

  function enqueue(payload) {
    if (disposed || !isValidFramePayload(payload)) return false;
    if (seen.has(payload.eventId) || activeId === payload.eventId || pending.some((item) => item.payload.eventId === payload.eventId)) return false;
    if (pending.length >= MAX_PENDING) return false;
    seen.add(payload.eventId);
    if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value);
    pending.push({ payload });
    playNext();
    return true;
  }

  async function playNext() {
    if (activeId !== null || disposed || !canPlay()) return;
    const item = pending.shift();
    if (!item) return;
    activeId = item.payload.eventId;
    try {
      await player.play(item.payload);
    } catch (error) {
      onError?.(error);
    } finally {
      activeId = null;
      playNext();
    }
  }

  return {
    enqueue,
    resume: playNext,
    dispose() {
      disposed = true;
      pending.length = 0;
      seen.clear();
      player.dispose();
    },
  };
}

function isValidFramePayload(payload) {
  return payload?.type === 'gift:frame' &&
    typeof payload.eventId === 'string' && payload.eventId.length > 0 && payload.eventId.length <= 160 &&
    typeof payload.giftName === 'string' && typeof payload.userName === 'string' &&
    Number.isSafeInteger(Number(payload.num)) && Number(payload.num) > 0 &&
    Number.isSafeInteger(Number(payload.totalPriceCents)) && Number(payload.totalPriceCents) > 0 &&
    THEME_IDS.has(payload.themeId || 'woodland-bloom');
}
