'use strict';

function mapNeteaseSong(song, searchCoverUrl) {
  if (!song || !song.id || !song.name) return null;
  const album = song.album || song.al || {};
  const artists = Array.isArray(song.artists)
    ? song.artists
    : Array.isArray(song.ar)
      ? song.ar
      : [];
  const sourceTrackId = String(song.id);

  // 封面来源优先级：
  // 1. 搜索详情中的专辑 picUrl
  // 2. 当前歌曲中的专辑 picUrl（歌单/推荐等接口有）
  // 3. 第一位艺术家的头像（搜索详情缺失或请求失败时的回退）
  let coverUrl = String(searchCoverUrl || '').trim();
  if (!coverUrl)
    coverUrl = String((album && (album.picUrl || album.pic_url)) || '');
  if (!coverUrl && artists.length > 0) {
    coverUrl = String(artists[0].img1v1Url || '');
  }

  return {
    id: `netease:${sourceTrackId}`,
    source: 'netease',
    sourceTrackId,
    sourceAlbumId: album && album.id ? String(album.id) : '',
    title: String(song.name || '').trim(),
    artists: artists
      .map((artist) => String((artist && artist.name) || '').trim())
      .filter(Boolean),
    album: String((album && album.name) || '').trim(),
    durationMs: Math.max(0, Number(song.duration || song.dt || 0)),
    coverUrl,
    playable: song.status !== -1,
    vip: Number(song.fee) === 1 || Number(song.fee) === 4,
  };
}

function mapNeteasePlaylist(playlist) {
  if (!playlist || !playlist.id || !playlist.name) return null;
  return {
    id: String(playlist.id),
    source: 'netease',
    title: String(playlist.name || '').trim(),
    description: String(
      playlist.copywriter || playlist.description || '',
    ).trim(),
    coverUrl: String(playlist.picUrl || playlist.coverImgUrl || ''),
    trackCount: Math.max(0, Number(playlist.trackCount || 0)),
    playCount: Math.max(0, Number(playlist.playCount || 0)),
    creatorUserId:
      playlist.creator && playlist.creator.userId
        ? String(playlist.creator.userId)
        : '',
  };
}

function extractSourceTrackId(track) {
  const sourceTrackId = String(
    (track && (track.sourceTrackId || track.id)) || '',
  )
    .replace(/^netease:/, '')
    .trim();
  if (!sourceTrackId) throw new Error('缺少网易云歌曲 ID。');
  return sourceTrackId;
}

function normalizeNeteasePlaylistTrackIds(tracks) {
  const trackIds = (Array.isArray(tracks) ? tracks : []).map((track) =>
    extractSourceTrackId(track),
  );
  if (trackIds.length === 0) throw new Error('缺少网易云歌曲 ID。');
  if (trackIds.some((id) => !/^\d+$/.test(id)))
    throw new Error('网易云歌曲 ID 必须是正整数。');
  return trackIds;
}

function normalizeTrialTimeMs(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.round(seconds * 1000)
    : 0;
}

function extractCookieValue(cookieHeader, name) {
  const pair = String(cookieHeader || '')
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`));
  return pair ? pair.slice(name.length + 1) : '';
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

// 从固定长度的列表里按页取一段，超出末尾就绕回开头，保证永远有内容返回。
function sliceByPage(list, limit, page) {
  const items = Array.isArray(list) ? list : [];
  if (items.length === 0) return [];
  if (items.length <= limit) return items.slice(0, limit);
  const start = ((page - 1) * limit) % items.length;
  const window = items.slice(start, start + limit);
  if (window.length >= limit) return window;
  return window.concat(items.slice(0, limit - window.length));
}

function sanitizeAuthState(auth) {
  return {
    loggedIn: Boolean(auth && auth.loggedIn),
    cookieCount: Number(auth && auth.cookieCount) || 0,
    keyCookieNames: Array.isArray(auth && auth.keyCookieNames)
      ? auth.keyCookieNames
      : [],
    encryptedSnapshotExists: Boolean(auth && auth.encryptedSnapshotExists),
    lastSavedAt: auth && auth.lastSavedAt ? auth.lastSavedAt : '',
  };
}

module.exports = {
  clampInteger,
  extractCookieValue,
  extractSourceTrackId,
  mapNeteasePlaylist,
  mapNeteaseSong,
  normalizeNeteasePlaylistTrackIds,
  normalizeTrialTimeMs,
  sanitizeAuthState,
  sliceByPage,
};
