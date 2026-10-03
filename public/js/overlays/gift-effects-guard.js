// 礼物特效地址里的大航海感谢：按事件去重，依次播放；有积压时缩短停留以追上进度。
'use strict';

import { GUARD_TIERS, createGuardThanksPlayer, isGuardThanksPayload } from '../shared/guard-thanks-card.js';

const MAX_PENDING = 12;
const MAX_EVENT_AGE_MS = 90000;
const SEEN_LIMIT = 200;
const TIER_RANK = Object.freeze(Object.fromEntries(Object.keys(GUARD_TIERS).map((tier, index) => [tier, index])));

export function createGuardThanksQueue({ root, resolveMotion, onError }) {
  const player = createGuardThanksPlayer({ root });
  const pending = [];
  const seen = new Set();
  let playing = false;
  let disposed = false;

  function isValid(payload) {
    return (
      payload?.type === 'gift:guard-thanks' &&
      typeof payload.eventId === 'string' &&
      payload.eventId.length <= 160 &&
      isGuardThanksPayload(payload)
    );
  }

  // 队列已满时舍弃最早的最低等级感谢；新事件等级最低时舍弃新事件。
  function makeRoom(payload) {
    if (pending.length < MAX_PENDING) return true;
    let lowest = -1;
    pending.forEach((item, index) => {
      if (lowest < 0 || TIER_RANK[item.payload.tier] < TIER_RANK[pending[lowest].payload.tier]) lowest = index;
    });
    if (TIER_RANK[payload.tier] <= TIER_RANK[pending[lowest].payload.tier]) return false;
    pending.splice(lowest, 1);
    return true;
  }

  function enqueue(payload) {
    if (disposed || !isValid(payload)) return false;
    if (payload.preview !== true) {
      if (seen.has(payload.eventId)) return false;
      seen.add(payload.eventId);
      if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value);
    }
    if (!makeRoom(payload)) return false;
    pending.push({ payload, queuedAt: Date.now() });
    playNext();
    return true;
  }

  async function playNext() {
    if (playing || disposed) return;
    let item = null;
    while (pending.length > 0) {
      const candidate = pending.shift();
      if (Date.now() - candidate.queuedAt <= MAX_EVENT_AGE_MS) {
        item = candidate;
        break;
      }
    }
    if (!item) return;
    playing = true;
    try {
      await player.play(item.payload, { motion: resolveMotion(), compressed: pending.length > 0 });
    } catch (error) {
      onError?.(error);
    } finally {
      playing = false;
      playNext();
    }
  }

  return {
    enqueue,
    dispose() {
      disposed = true;
      pending.length = 0;
      player.dispose();
    },
  };
}
