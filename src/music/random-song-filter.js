// 编写人：Aurora
// 随机点歌的纯筛选规则：只处理普通歌曲对象，不依赖数据库、弹幕或队列状态。
'use strict';

const { cleanText } = require('../shared/utils');
const { matchesLibraryTag } = require('./tag-aliases');
const { splitSongArtists, splitSongLanguages, splitSongTags } = require('./song-field-utils');

const LANGUAGE_ALIAS_GROUPS = [
  ['日语', '日文', '日本语', '日语歌', '日文歌', 'ja', 'jp', 'japanese'],
  ['韩语', '韩文', '韩国语', '韩语歌', '韩文歌', 'ko', 'kr', 'korean'],
  ['英语', '英文', '英语歌', '英文歌', 'en', 'english'],
  ['粤语', '粤文', '粤语歌', '粤文歌', 'cantonese'],
  ['国语', '中文', '汉语', '普通话', '华语', '国语歌', '中文歌', 'mandarin', 'chinese'],
].map((group) => group.map(normalizeComparable));

const CATEGORY_ALIAS_GROUPS = [
  ['流行', '流行乐', 'pop'],
  ['R&B', 'RNB', 'R＆B', 'R & B'],
  ['说唱', '嘻哈', 'rap', 'hip-hop', 'hip hop'],
  ['摇滚', 'rock'],
  ['民谣', 'folk'],
  ['舞曲', 'dance'],
  ['影视原声', '影视'],
].map((group) => group.map(normalizeComparable));

/**
 * 把观众输入的组合条件拆成独立筛选词。
 * 加号表示 AND；空片段没有筛选意义，因此直接忽略。
 */
function parseRandomSongTerms(scopeText) {
  return cleanText(scopeText)
    .split(/[+＋]/)
    .map((term) => cleanText(term))
    .filter(Boolean);
}

/**
 * 返回同时满足全部筛选词的歌曲。每个词可以命中语言、歌手、分类或独立标签，
 * 但不同筛选词必须落在同一首歌曲上，不能由多首歌分别满足。
 */
function filterRandomSongCandidates(songs, scopeText) {
  const terms = parseRandomSongTerms(scopeText).map(compileScopeTerm);
  if (terms.length === 0) return songs.slice();
  return songs.filter((song) => {
    const fields = prepareSongFields(song);
    return terms.every((term) => songMatchesScopeTerm(fields, term));
  });
}

function describeRandomSongScope(songs, scopeText) {
  const terms = parseRandomSongTerms(scopeText);
  if (terms.length === 0) return { terms, unmatchedTerms: [], hasCandidates: songs.length > 0 };
  const compiled = terms.map(compileScopeTerm);
  const matched = terms.map(() => false);
  let hasCandidates = false;
  for (const song of songs) {
    const fields = prepareSongFields(song);
    let matchesAll = true;
    compiled.forEach((term, index) => {
      const matches = songMatchesScopeTerm(fields, term);
      matched[index] ||= matches;
      matchesAll &&= matches;
    });
    hasCandidates ||= matchesAll;
    if (hasCandidates) break;
  }
  return {
    terms,
    unmatchedTerms: terms.filter((_term, index) => !matched[index]),
    hasCandidates,
  };
}

function compileScopeTerm(term) {
  const parts = term.split(/\s+/).filter(Boolean);
  return { whole: compileTerm(term), parts: parts.length > 1 ? parts.map(compileTerm) : [] };
}

function compileTerm(term) {
  return {
    text: term,
    normalized: normalizeComparable(term),
    languages: randomLanguageAliases(term),
    categories: randomCategoryAliases(term),
  };
}

function prepareSongFields(song) {
  return {
    artist: normalizeComparable(song.artist),
    artists: splitSongArtists(song.artist, { preservePunctuation: true }).map(normalizeComparable),
    languages: splitSongLanguages(song.language).map(normalizeComparable),
    categories: song.category_is_enabled !== 0 ? splitSongCategories(song.category_name).map(normalizeComparable) : [],
    tags: splitSongTags(song.tags),
  };
}

/**
 * 空格输入先按完整条件匹配，未命中时再按 AND 条件拆分。
 * 这样“说唱 苦情”可以直接使用，同时保留“A1 TRIP”这类带空格的完整歌手名。
 */
function songMatchesScopeTerm(song, term) {
  if (songMatchesTerm(song, term.whole)) return true;
  return term.parts.length > 1 && term.parts.every((item) => songMatchesTerm(song, item));
}

function songMatchesTerm(song, term) {
  return !term.normalized || song.artist === term.normalized || song.artists.includes(term.normalized) ||
    song.languages.some((language) => term.languages.includes(language)) ||
    song.categories.some((category) => term.categories.includes(category)) ||
    song.tags.some((tag) => matchesLibraryTag(tag, term.text));
}

function splitSongCategories(value) {
  return splitSongValues(value, /\s*\/\s*/);
}

function splitSongValues(value, separator) {
  return String(value || '')
    .split(separator)
    .map((item) => cleanText(item))
    .filter(Boolean);
}

function randomLanguageAliases(scopeText) {
  const scope = normalizeComparable(scopeText);
  const matchedGroup = LANGUAGE_ALIAS_GROUPS.find((group) => group.includes(scope));
  return matchedGroup ? matchedGroup.slice() : [scope];
}

function randomCategoryAliases(scopeText) {
  const scope = normalizeComparable(scopeText);
  const matchedGroup = CATEGORY_ALIAS_GROUPS.find((group) => group.includes(scope));
  return matchedGroup ? matchedGroup.slice() : [scope];
}

function normalizeComparable(value) {
  return cleanText(value).toLocaleLowerCase('zh-Hans-CN');
}

module.exports = {
  filterRandomSongCandidates,
  describeRandomSongScope,
  parseRandomSongTerms,
  randomLanguageAliases,
  splitSongTags,
};
