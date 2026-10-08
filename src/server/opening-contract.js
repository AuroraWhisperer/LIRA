// 开播动画公开参数的服务端契约。
'use strict';

const DEFAULT_OPENING_TRACK_MOTION = 'heart';
const OPENING_TRACK_MOTION_VALUES = new Set(['heart', 'barber', 'progress']);
const DEFAULT_OPENING_STYLE = 'classic';
const OPENING_STYLE_VALUES = new Set(['classic', 'pixel-cassette', 'moonlit-fan']);

const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.wma']);
const CHARACTER_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
const MAX_CHARACTER_UPLOAD_BYTES = 16 * 1024 * 1024;

function cleanOpeningText(value, maxLength) {
  return Array.from(
    String(value ?? '')
      .replace(/[\u0000-\u001f\u007f-\u009f]/gu, '')
      .trim(),
  )
    .slice(0, maxLength)
    .join('');
}

function normalizeOpeningStyle(value) {
  const candidate = String(value ?? '').trim();
  return OPENING_STYLE_VALUES.has(candidate) ? candidate : null;
}

function normalizeOpeningTrackMotion(value) {
  const candidate = String(value ?? '').trim();
  return OPENING_TRACK_MOTION_VALUES.has(candidate) ? candidate : null;
}

module.exports = {
  AUDIO_EXTENSIONS,
  CHARACTER_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  MAX_CHARACTER_UPLOAD_BYTES,
  cleanOpeningText,
  DEFAULT_OPENING_STYLE,
  normalizeOpeningStyle,
  DEFAULT_OPENING_TRACK_MOTION,
  OPENING_TRACK_MOTION_VALUES,
  normalizeOpeningTrackMotion,
};
