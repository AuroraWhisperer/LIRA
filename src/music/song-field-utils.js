'use strict';

const { cleanText } = require('../shared/utils');

function splitSongLanguages(value) {
  return String(value || '')
    .split(/\s*(?:\/|／|、|,|，)\s*/)
    .map((language) => cleanText(language))
    .filter(Boolean);
}

function splitSongArtists(value) {
  return String(value || '')
    .split(/\s*(?:\/|／|&|＆|、|,|，)\s*/)
    .map((artist) => cleanText(artist))
    .filter(Boolean);
}

function splitSongTags(value) {
  return String(value || '')
    .split(/[,，]/)
    .map((tag) => cleanText(tag))
    .filter(Boolean);
}

function escapeLikePattern(value) {
  return value.replace(/[\\%_]/g, '\\$&');
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
  escapeLikePattern,
  normalizeRandomScopeText,
  randomSourceValue,
};
