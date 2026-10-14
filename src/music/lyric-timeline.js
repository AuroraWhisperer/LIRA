'use strict';

const { cleanText, clampNumber, normalizeLyricWords } = require('./lyric-normalization');

const MAX_TIME_MS = 24 * 60 * 60 * 1000;
const MAX_LINES = 500;
const MAX_TEXT_BUDGET = 48 * 1024;
const MAX_WORD_BYTES = 512 * 1024;

function normalizeLyricTimeline(input) {
  const timeline = input && typeof input === 'object' ? input : {};
  const status = ['idle', 'loading', 'ready', 'empty'].includes(timeline.status) ? timeline.status : 'idle';
  const candidates = Array.isArray(timeline.lines)
    ? timeline.lines
        .map((line, index) => ({ ...normalizeLine(line), index }))
        .filter((line) => line.text)
        .sort((left, right) => left.startMs - right.startMs || left.index - right.index)
    : [];
  const lines = [];
  let remainingText = MAX_TEXT_BUDGET;
  let remainingWordBytes = MAX_WORD_BYTES;

  for (const candidate of candidates) {
    if (lines.length >= MAX_LINES) break;
    const { index: _index, ...line } = candidate;
    const textSize = line.text.length + line.translation.length + line.roma.length;
    if (textSize > remainingText) break;
    if (line.words) {
      const wordBytes = Buffer.byteLength(JSON.stringify(line.words), 'utf8');
      if (wordBytes <= remainingWordBytes) remainingWordBytes -= wordBytes;
      else delete line.words; // Preserve full text and the current-state timing fallback.
    }
    lines.push(line);
    remainingText -= textSize;
  }

  return {
    trackTitle: cleanText(timeline.trackTitle, 120),
    artists: Array.isArray(timeline.artists)
      ? timeline.artists
          .map((artist) => cleanText(artist, 80))
          .filter(Boolean)
          .slice(0, 8)
      : [],
    status,
    lines,
  };
}

function normalizeLine(line) {
  const input = line && typeof line === 'object' ? line : {};
  const startMs = clampNumber(input.startMs, 0, MAX_TIME_MS);
  const words = normalizeLyricWords(input.words);
  return {
    startMs,
    endMs: clampNumber(input.endMs, startMs, MAX_TIME_MS),
    text: cleanText(input.text, 240),
    translation: cleanText(input.translation, 240),
    roma: cleanText(input.roma, 240),
    ...(words.length ? { words } : {}),
  };
}

module.exports = { normalizeLyricTimeline };
