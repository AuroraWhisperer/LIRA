'use strict';

const { cleanText, clampNumber, normalizeLyricWords } = require('./lyric-normalization');

const MAX_TIME_MS = 24 * 60 * 60 * 1000;

function normalizeLyricState(input) {
  const state = input && typeof input === 'object' ? input : {};
  const status = ['idle', 'loading', 'ready', 'empty'].includes(state.status) ? state.status : 'idle';

  return {
    trackTitle: cleanText(state.trackTitle, 120),
    artists: Array.isArray(state.artists)
      ? state.artists
          .map((artist) => cleanText(artist, 80))
          .filter(Boolean)
          .slice(0, 8)
      : [],
    lineText: cleanText(state.lineText, 240),
    translation: cleanText(state.translation, 240),
    words: normalizeLyricWords(state.words),
    currentMs: clampNumber(state.currentMs, 0, MAX_TIME_MS),
    durationMs: clampNumber(state.durationMs, 0, MAX_TIME_MS),
    progress: clampNumber(state.progress, 0, 1),
    playing: state.playing === true,
    locked: state.locked === true,
    generation: clampInteger(state.generation, 0),
    sequence: clampInteger(state.sequence, 0),
    status,
  };
}

function clampInteger(value, minimum) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? Math.max(minimum, number) : minimum;
}

module.exports = { normalizeLyricState };
