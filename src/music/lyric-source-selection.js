'use strict';

const LYRIC_SOURCES = ['internal', 'qq-client', 'netease-client', 'wesing'];

function chooseLyricSource(selection, current, candidates) {
  const playingSources = LYRIC_SOURCES.filter((source) => candidates[source].playing);
  if (playingSources.length === 1) return playingSources[0];
  if (playingSources.length > 1) {
    if (playingSources.includes(selection)) return selection;
    if (playingSources.includes(current)) return current;
    return playingSources[0];
  }
  if (selection !== 'auto') return selection;
  if (candidates[current].available) return current;
  return LYRIC_SOURCES.find((source) => candidates[source].available) || 'internal';
}

module.exports = { LYRIC_SOURCES, chooseLyricSource };
