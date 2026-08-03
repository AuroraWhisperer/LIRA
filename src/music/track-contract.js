'use strict';

const { cleanText } = require('../shared/utils');
const { normalizeMusicPlatform } = require('./provider-registry');

function normalizeMusicTrackForProvider(track) {
  if (!track || typeof track !== 'object') {
    throw new Error('缺少歌曲信息。');
  }

  const source = normalizeMusicPlatform(track.source);
  const id = cleanText(track.id || track.sourceTrackId);
  const sourceTrackId = cleanText(track.sourceTrackId || track.id);
  const title = cleanText(track.title);
  if (!id || !sourceTrackId || !title) {
    throw new Error('歌曲信息不完整。');
  }

  const artists = Array.isArray(track.artists)
    ? track.artists.map(cleanText).filter(Boolean).slice(0, 8)
    : [];

  return {
    id,
    source,
    title,
    artists,
    album: cleanText(track.album),
    durationMs: Math.max(0, Number(track.durationMs) || 0),
    coverUrl: cleanText(track.coverUrl),
    sourceTrackId,
    sourceSongId: Math.max(0, Number(track.sourceSongId || track.songId) || 0),
    sourceAlbumId: cleanText(track.sourceAlbumId),
    playable: track.playable !== false,
    vip: track.vip === true
  };
}

module.exports = { normalizeMusicTrackForProvider };
