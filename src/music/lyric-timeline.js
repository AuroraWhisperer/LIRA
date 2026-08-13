'use strict';

const MAX_TIME_MS = 24 * 60 * 60 * 1000;
const MAX_LINES = 500;
const MAX_TEXT_BUDGET = 48 * 1024;

function normalizeLyricTimeline(input) {
  const timeline = input && typeof input === 'object' ? input : {};
  const status = ['idle', 'loading', 'ready', 'empty'].includes(timeline.status)
    ? timeline.status
    : 'idle';
  const candidates = Array.isArray(timeline.lines)
    ? timeline.lines.map((line, index) => ({ ...normalizeLine(line), index }))
      .filter((line) => line.text)
      .sort((left, right) => left.startMs - right.startMs || left.index - right.index)
    : [];
  const lines = [];
  let remainingText = MAX_TEXT_BUDGET;

  for (const candidate of candidates) {
    if (lines.length >= MAX_LINES) break;
    const { index: _index, ...line } = candidate;
    const textSize = line.text.length + line.translation.length + line.roma.length;
    if (textSize > remainingText) break;
    lines.push(line);
    remainingText -= textSize;
  }

  return {
    trackTitle: cleanText(timeline.trackTitle, 120),
    artists: Array.isArray(timeline.artists)
      ? timeline.artists.map((artist) => cleanText(artist, 80)).filter(Boolean).slice(0, 8)
      : [],
    status,
    lines
  };
}

function normalizeLine(line) {
  const input = line && typeof line === 'object' ? line : {};
  const startMs = clampNumber(input.startMs, 0, MAX_TIME_MS);
  return {
    startMs,
    endMs: clampNumber(input.endMs, startMs, MAX_TIME_MS),
    text: cleanText(input.text, 240),
    translation: cleanText(input.translation, 240),
    roma: cleanText(input.roma, 240)
  };
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, maxLength);
}

function clampNumber(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : minimum;
}

module.exports = { normalizeLyricTimeline };
