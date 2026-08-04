'use strict';

const MAX_TIME_MS = 24 * 60 * 60 * 1000;

function normalizeLyricState(input) {
  const state = input && typeof input === 'object' ? input : {};
  const status = ['idle', 'loading', 'ready', 'empty'].includes(state.status)
    ? state.status
    : 'idle';

  return {
    trackTitle: cleanText(state.trackTitle, 120),
    artists: Array.isArray(state.artists)
      ? state.artists.map((artist) => cleanText(artist, 80)).filter(Boolean).slice(0, 8)
      : [],
    lineText: cleanText(state.lineText, 240),
    translation: cleanText(state.translation, 240),
    words: Array.isArray(state.words)
      ? state.words.slice(0, 120).map(normalizeWord).filter((word) => word.text)
      : [],
    currentMs: clampNumber(state.currentMs, 0, MAX_TIME_MS),
    progress: clampNumber(state.progress, 0, 1),
    playing: state.playing === true,
    locked: state.locked === true,
    status
  };
}

function normalizeWord(word) {
  const input = word && typeof word === 'object' ? word : {};
  const startMs = clampNumber(input.startMs, 0, MAX_TIME_MS);
  return {
    text: cleanWordText(input.text, 40),
    startMs,
    endMs: clampNumber(input.endMs, startMs, MAX_TIME_MS)
  };
}

function cleanWordText(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, maxLength);
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, maxLength);
}

function clampNumber(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : minimum;
}

module.exports = { normalizeLyricState };
