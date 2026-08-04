// 观众叫法到歌库标准标签的单向映射，不依赖点歌、数据库或队列状态。
'use strict';

const LIBRARY_TAG_ALIASES = {
  '抒情': ['情歌', '抒情歌', '抒情歌曲', '慢情歌'],
  '治愈': ['治愈系', '治愈向', '治愈歌曲', '暖心'],
  '怀旧': ['怀旧歌', '怀旧歌曲', '回忆杀', '经典老歌', '老歌']
};

const LIBRARY_TAG_BY_VIEWER_ALIAS = new Map();
for (const [libraryTag, aliases] of Object.entries(LIBRARY_TAG_ALIASES)) {
  for (const alias of aliases) {
    LIBRARY_TAG_BY_VIEWER_ALIAS.set(normalizeTag(alias), normalizeTag(libraryTag));
  }
}

/**
 * 判断歌库中的完整标签是否满足观众输入。
 * 别名只解析到歌库标准标签，不把非标准歌库标签反向扩展成标准标签。
 */
function matchesLibraryTag(libraryTag, viewerTerm) {
  const normalizedLibraryTag = normalizeTag(libraryTag);
  const normalizedViewerTerm = normalizeTag(viewerTerm);
  if (!normalizedLibraryTag || !normalizedViewerTerm) return false;
  if (normalizedLibraryTag === normalizedViewerTerm) return true;
  return LIBRARY_TAG_BY_VIEWER_ALIAS.get(normalizedViewerTerm) === normalizedLibraryTag;
}

function normalizeTag(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('zh-Hans-CN');
}

module.exports = { matchesLibraryTag };
