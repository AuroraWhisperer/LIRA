// 开播动画公开参数的服务端契约。
'use strict';

const DEFAULT_OPENING_TRACK_MOTION = 'heart';
const OPENING_TRACK_MOTION_VALUES = new Set(['heart', 'barber', 'progress']);
const DEFAULT_OPENING_STYLE = 'classic';
const OPENING_STYLE_VALUES = new Set(['classic', 'pixel-cassette', 'moonlit-fan']);

function normalizeOpeningStyle(value) {
  const candidate = String(value ?? '').trim();
  return OPENING_STYLE_VALUES.has(candidate) ? candidate : null;
}

function normalizeOpeningTrackMotion(value) {
  const candidate = String(value ?? '').trim();
  return OPENING_TRACK_MOTION_VALUES.has(candidate) ? candidate : null;
}

module.exports = {
  DEFAULT_OPENING_STYLE,
  normalizeOpeningStyle,
  DEFAULT_OPENING_TRACK_MOTION,
  OPENING_TRACK_MOTION_VALUES,
  normalizeOpeningTrackMotion,
};
