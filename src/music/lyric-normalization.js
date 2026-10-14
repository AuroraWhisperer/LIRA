'use strict';

function cleanText(value, maxLength) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function clampNumber(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : minimum;
}

function normalizeLyricWords(words) {
  if (!Array.isArray(words)) return [];
  const maxTimeMs = 24 * 60 * 60 * 1000;
  return words.slice(0, 120).map((word) => {
    const input = word && typeof word === 'object' ? word : {};
    const startMs = clampNumber(input.startMs, 0, maxTimeMs);
    return {
      text: String(input.text || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 40),
      startMs,
      endMs: clampNumber(input.endMs, startMs, maxTimeMs),
    };
  }).filter((word) => word.text);
}

module.exports = { cleanText, clampNumber, normalizeLyricWords };
