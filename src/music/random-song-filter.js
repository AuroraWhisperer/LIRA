// 编写人：Aurora
// 随机点歌的纯筛选规则：只处理普通歌曲对象，不依赖数据库、弹幕或队列状态。
'use strict';

const { cleanText } = require('../shared/utils');
const { matchesLibraryTag } = require('./tag-aliases');

const LANGUAGE_ALIAS_GROUPS = [
  ['日语', '日文', '日本语', '日语歌', '日文歌', 'ja', 'jp', 'japanese'],
  ['韩语', '韩文', '韩国语', '韩语歌', '韩文歌', 'ko', 'kr', 'korean'],
  ['英语', '英文', '英语歌', '英文歌', 'en', 'english'],
  ['粤语', '粤文', '粤语歌', '粤文歌', 'cantonese'],
  ['国语', '中文', '汉语', '普通话', '华语', '国语歌', '中文歌', 'mandarin', 'chinese']
];

const CATEGORY_ALIAS_GROUPS = [
  ['流行', '流行乐', 'pop'],
  ['R&B', 'RNB', 'R＆B', 'R & B'],
  ['说唱', '嘻哈', 'rap', 'hip-hop', 'hip hop'],
  ['摇滚', 'rock'],
  ['民谣', 'folk'],
  ['舞曲', 'dance'],
  ['影视原声', '影视']
];

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
  const terms = parseRandomSongTerms(scopeText);
  if (terms.length === 0) return songs.slice();
  return songs.filter((song) => terms.every((term) => songMatchesScopeTerm(song, term)));
}

/**
 * 空格输入先按完整条件匹配，未命中时再按 AND 条件拆分。
 * 这样“说唱 苦情”可以直接使用，同时保留“A1 TRIP”这类带空格的完整歌手名。
 */
function songMatchesScopeTerm(song, term) {
  if (songMatchesTerm(song, term)) return true;
  const spaceSeparatedTerms = cleanText(term).split(/\s+/).filter(Boolean);
  return spaceSeparatedTerms.length > 1
    && spaceSeparatedTerms.every((item) => songMatchesTerm(song, item));
}

function songMatchesTerm(song, term) {
  const normalizedTerm = normalizeComparable(term);
  if (!normalizedTerm) return true;

  const artistMatches = normalizeComparable(song.artist) === normalizedTerm
    || splitSongArtists(song.artist)
      .some((artist) => normalizeComparable(artist) === normalizedTerm);
  const languageAliases = randomLanguageAliases(term);
  const languageMatches = splitSongLanguages(song.language)
    .some((language) => languageAliases.includes(normalizeComparable(language)));
  const categoryMatches = song.category_is_enabled !== 0
    && splitSongCategories(song.category_name)
      .some((category) => randomCategoryAliases(term).includes(normalizeComparable(category)));
  const tagMatches = splitSongTags(song.tags)
    .some((tag) => matchesLibraryTag(tag, term));

  return artistMatches || languageMatches || categoryMatches || tagMatches;
}

function splitSongArtists(value) {
  return splitSongValues(value, /\s*(?:\/|&|＆)\s*/);
}

function splitSongLanguages(value) {
  return splitSongValues(value, /\s*(?:\/|、|，|,)\s*/);
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

/**
 * 标签必须按完整项匹配，避免输入“情”误命中“抒情”。兼容导入文件常见分隔符。
 */
function splitSongTags(value) {
  return String(value || '')
    .split(/[,，、;；|]/)
    .map((tag) => cleanText(tag))
    .filter(Boolean);
}

function randomLanguageAliases(scopeText) {
  const scope = normalizeComparable(scopeText);
  const matchedGroup = LANGUAGE_ALIAS_GROUPS.find((group) =>
    group.some((alias) => normalizeComparable(alias) === scope)
  );
  return (matchedGroup || [scopeText]).map((item) => normalizeComparable(item));
}

function randomCategoryAliases(scopeText) {
  const scope = normalizeComparable(scopeText);
  const matchedGroup = CATEGORY_ALIAS_GROUPS.find((group) =>
    group.some((alias) => normalizeComparable(alias) === scope)
  );
  return (matchedGroup || [scopeText]).map((item) => normalizeComparable(item));
}

function normalizeComparable(value) {
  return cleanText(value).toLocaleLowerCase('zh-Hans-CN');
}

module.exports = {
  filterRandomSongCandidates,
  parseRandomSongTerms,
  randomLanguageAliases,
  splitSongTags
};
