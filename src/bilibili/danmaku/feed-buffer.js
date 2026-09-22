'use strict';

const { normalizeBilibiliImageUrl } = require('../parsers/danmaku-parser');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function createDanmakuFeedBuffer(options = {}) {
  const requestedLimit = Math.trunc(Number(options.limit));
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, MAX_LIMIT) : DEFAULT_LIMIT;
  let activeRoomId = '';
  let nextId = 1;
  let items = [];

  function setRoom(roomId) {
    const normalized = String(roomId || '').trim();
    if (normalized === activeRoomId) return false;
    activeRoomId = normalized;
    items = [];
    return true;
  }

  function push(danmaku = {}) {
    const message = String(danmaku.message || '').trim();
    if (!message) return null;
    const item = {
      id: nextId,
      uid: String(danmaku.uid || '').trim(),
      name: String(danmaku.userName || danmaku.name || '观众').trim() || '观众',
      message,
      avatarUrl: normalizeBilibiliImageUrl(danmaku.avatarUrl),
      guardLevel: normalizeGuardLevel(danmaku.requesterGuardLevel ?? danmaku.guardLevel),
      medalName: String(danmaku.requesterMedalName || danmaku.medalName || '').trim(),
      medalLevel: normalizeNonNegativeInteger(danmaku.requesterMedalLevel ?? danmaku.medalLevel),
      timestamp: normalizeTimestamp(danmaku.messageTimestamp ?? danmaku.timestamp),
      emotes: normalizeEmotes(danmaku.emotes),
      ...(danmaku.isStreamer === true ? { isStreamer: true } : {}),
    };
    return appendItem(item);
  }

  function pushGift(gift = {}) {
    const giftCount = Number(gift.num);
    if (gift.detection_status !== 'final' || !Number.isSafeInteger(giftCount) || giftCount <= 0) return null;
    const giftName = String(gift.gift_name || '礼物').trim() || '礼物';
    return appendItem({
      id: nextId,
      uid: String(gift.uid || '').trim(),
      name: String(gift.user_name || '观众').trim() || '观众',
      message: `送出 ${giftName} × ${giftCount}`,
      avatarUrl: '',
      guardLevel: 0,
      medalName: '',
      medalLevel: 0,
      timestamp: normalizeTimestamp(gift.finalized_at_ms),
      emotes: [],
      kind: 'gift',
      giftName,
      giftCount,
      ...(Number.isFinite(gift.total_price) && gift.total_price >= 0 ? { giftTotalPrice: gift.total_price } : {}),
    });
  }

  function appendItem(item) {
    nextId += 1;
    items.push(item);
    if (items.length > limit) items = items.slice(-limit);
    return cloneItem(item);
  }

  function getSnapshot() {
    return items.map(cloneItem);
  }

  function clear() {
    items = [];
  }

  return { setRoom, push, pushGift, getSnapshot, clear };
}

function normalizeEmotes(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const emote of value) {
    const text = String((emote && emote.text) || '').trim();
    const url = normalizeBilibiliImageUrl(emote && emote.url);
    if (!text || !url || seen.has(text)) continue;
    seen.add(text);
    result.push({
      text,
      url,
      ...(emote.kind === 'inline' || emote.kind === 'sticker' ? { kind: emote.kind } : {}),
      width: normalizeNonNegativeInteger(emote.width),
      height: normalizeNonNegativeInteger(emote.height),
    });
  }
  return result;
}

function normalizeGuardLevel(value) {
  const level = normalizeNonNegativeInteger(value);
  return level >= 1 && level <= 3 ? level : 0;
}

function normalizeNonNegativeInteger(value) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function normalizeTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : Date.now();
}

function cloneItem(item) {
  return {
    ...item,
    emotes: item.emotes.map((emote) => ({ ...emote })),
  };
}

module.exports = { createDanmakuFeedBuffer };
