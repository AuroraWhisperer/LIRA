'use strict';

const { normalizeTimestampMs } = require('../../shared/utils');

// ---------------------------------------------------------------------------
// Danmaku (bullet comment) parsing utilities
// ---------------------------------------------------------------------------

function extractBilibiliDanmakuTimestamp(info) {
  const metadata = Array.isArray(info) && Array.isArray(info[0]) ? info[0] : [];
  const candidates = [metadata[4], metadata[5], metadata[6]];
  const nowMs = Date.now();
  for (const candidate of candidates) {
    const timestamp = normalizeTimestampMs(candidate);
    if (timestamp && Math.abs(timestamp - nowMs) < 30 * 24 * 60 * 60 * 1000) {
      return timestamp;
    }
  }
  return nowMs;
}

function extractBilibiliDanmakuAvatarUrl(info) {
  const rawOptions =
    Array.isArray(info) && Array.isArray(info[0]) ? info[0][15] : null;
  const options = parseDanmakuOptions(rawOptions);
  const user = options && typeof options === 'object' ? options.user : null;
  const base = user && typeof user.base === 'object' ? user.base : null;
  const face =
    (user && (user.face || user.face_url || user.faceUrl)) ||
    (base && (base.face || base.face_url || base.faceUrl));
  return normalizeBilibiliAvatarUrl(face);
}

function extractBilibiliDanmakuEmotes(info) {
  const metadata = Array.isArray(info) && Array.isArray(info[0]) ? info[0] : [];
  const options = parseDanmakuOptions(metadata[15]) || {};
  const extra = parseDanmakuOptions(options.extra) || {};
  const message = String(Array.isArray(info) ? info[1] || '' : '');
  const records = [];
  const seen = new Set();

  appendEmoticon(records, seen, options.emoticon, message);
  appendEmoteMap(records, seen, options.emots);
  appendEmoticon(records, seen, extra.emoticon, message);
  appendEmoteMap(records, seen, extra.emots);
  return records;
}

function appendEmoticon(records, seen, value, fallbackText) {
  if (!value || typeof value !== 'object') return;
  appendEmote(records, seen, value.text || fallbackText, value);
}

function appendEmoteMap(records, seen, value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, emote] of Object.entries(value)) {
    if (!emote || typeof emote !== 'object') continue;
    appendEmote(
      records,
      seen,
      key || emote.text || emote.emoji || emote.descript,
      emote,
    );
  }
}

function appendEmote(records, seen, textValue, value) {
  const text = String(textValue || '').trim();
  const url = normalizeBilibiliImageUrl(value && value.url);
  if (!text || !url || seen.has(text)) return;
  seen.add(text);
  records.push({
    text,
    url,
    width: normalizeEmoteDimension(value.width),
    height: normalizeEmoteDimension(value.height),
  });
}

function normalizeEmoteDimension(value) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 ? Math.min(number, 512) : 0;
}

function parseDanmakuOptions(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function normalizeBilibiliAvatarUrl(value) {
  return normalizeBilibiliImageUrl(value);
}

function normalizeBilibiliImageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!url.hostname.endsWith('.hdslb.com')) return '';
    if (url.protocol === 'http:') url.protocol = 'https:';
    else if (url.protocol !== 'https:') return '';
    return url.toString();
  } catch (_) {
    return '';
  }
}

module.exports = {
  extractBilibiliDanmakuTimestamp,
  extractBilibiliDanmakuAvatarUrl,
  extractBilibiliDanmakuEmotes,
  normalizeBilibiliAvatarUrl,
  normalizeBilibiliImageUrl,
};
