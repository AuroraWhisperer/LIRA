'use strict';

const { cleanText } = require('../shared/utils');

function splitSongLanguages(value) {
  return String(value || '')
    .split(/\s*(?:\/|／|、|,|，)\s*/)
    .map((language) => cleanText(language))
    .filter(Boolean);
}

function splitSongArtists(value, { preservePunctuation = false } = {}) {
  // Random requests preserve punctuation inside artist names; library filters
  // retain the legacy comma-separated import format.
  const separator = preservePunctuation
    ? /\s*(?:\/|／|&|＆)\s*/
    : /\s*(?:\/|／|&|＆|、|,|，)\s*/;
  return String(value || '')
    .split(separator)
    .map((artist) => cleanText(artist))
    .filter(Boolean);
}

function splitSongTags(value) {
  return String(value || '')
    .split(/[,，、;；|]/)
    .map((tag) => cleanText(tag))
    .filter(Boolean);
}

function normalizeRandomScopeText(value) {
  let text = cleanText(value);
  while (text && '+＋:：-—'.includes(text[0])) {
    text = cleanText(text.slice(1));
  }
  return text;
}

function randomSourceValue(scopeText) {
  const scope = normalizeRandomScopeText(scopeText);
  return scope ? `random:${scope}` : 'random';
}

module.exports = {
  splitSongLanguages,
  splitSongArtists,
  splitSongTags,
  normalizeRandomScopeText,
  randomSourceValue,
};
