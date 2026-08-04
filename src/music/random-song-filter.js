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
  return songs.filter((song) => terms.every((term) => songMatchesTerm(song, term)));
}

function songMatchesTerm(song, term) {
  const normalizedTerm = normalizeComparable(term);
  if (!normalizedTerm) return true;

  const artistMatches = normalizeComparable(song.artist) === normalizedTerm;
  const languageMatches = randomLanguageAliases(term)
    .includes(normalizeComparable(song.language));
  // 分类沿用旧版单条件的包含匹配，保证“影视”仍可命中“影视原声”。
  const categoryMatches = song.category_is_enabled !== 0
    && normalizeComparable(song.category_name).includes(normalizedTerm);
  const tagMatches = splitSongTags(song.tags)
    .some((tag) => matchesLibraryTag(tag, term));

  return artistMatches || languageMatches || categoryMatches || tagMatches;
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

function normalizeComparable(value) {
  return cleanText(value).toLocaleLowerCase('zh-Hans-CN');
}

module.exports = {
  filterRandomSongCandidates,
  parseRandomSongTerms,
  randomLanguageAliases,
  splitSongTags
};
