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
  const options = Array.isArray(info) && Array.isArray(info[0]) ? info[0][15] : null;
  const user = options && typeof options === 'object' ? options.user : null;
  const base = user && typeof user.base === 'object' ? user.base : null;
  const face = (user && (user.face || user.face_url || user.faceUrl))
    || (base && (base.face || base.face_url || base.faceUrl));
  try {
    const url = new URL(String(face || ''));
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.hdslb.com')) return '';
    return url.toString();
  } catch (_) {
    return '';
  }
}

module.exports = {
  extractBilibiliDanmakuTimestamp,
  extractBilibiliDanmakuAvatarUrl
};
