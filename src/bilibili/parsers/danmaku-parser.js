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

module.exports = {
  extractBilibiliDanmakuTimestamp
};
